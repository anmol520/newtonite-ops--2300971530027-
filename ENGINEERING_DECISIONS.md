# Engineering Decisions: Operations Under Pressure

Written by the Candidate for Newtonite.

---

## Assumptions

When building this platform, I grounded my design choices in the following concrete assumptions:
- **Work Items**: A work item is a discrete operational task or incident (`incident`, `customer_issue`, `payment`, `compliance`, `task`) belonging to exactly one operational team.
- **Workflow States**: An item moves through five deterministic states: `open` -> `in_progress` -> `awaiting_approval` -> `resolved` -> `closed` (with reopen permitted to `in_progress`).
- **Role Hierarchy**: Roles are strictly scoped per team (`viewer`, `member`, `lead`, `admin`). A user can have different roles across different teams (e.g. `lead` in Payments Ops, but `member` in Compliance).
- **Approval Policy**: Only a team `lead` or `admin` can approve a work item in `awaiting_approval`. Crucially, an operator cannot approve their own work item even if they hold a `lead` role.
- **What I Would Confirm with a Product Manager First**:
  1. Escalation & SLA Breaches: Should overdue items trigger automated reassignment to leads if unclaimed after a defined duration?
  2. Cross-team Collaboration: Can an incident be shared across teams, or should dependencies be tracked as parent/child work items?
  3. Notification Channels: What is the preferred alerting medium (Slack webhook, PagerDuty, email) for urgent unassigned tickets?

---

## Decision 1: PostgreSQL with Hand-Written SQL and Transactional Audit History

### Context
Every mutation on a work item must produce an accountable, tamper-proof history. If an update succeeds but the audit trail fails, or vice versa, the system is left in an un-auditable or corrupted state.

### Options Considered
1. **ORM with lifecycle hooks (e.g., Prisma or TypeORM)**: Hooks like `afterUpdate` execute in a separate database round-trip outside the transaction. A server crash between the update and the hook drops the audit entry.
2. **Event Sourcing**: Reconstructing state entirely from event logs. While powerful, it introduces substantial operational complexity, slower point queries, and complex schema evolution for an operational dashboard.
3. **PostgreSQL with hand-written SQL and atomic transactions**: Explicit SQL transactions (`BEGIN ... COMMIT`) wrapping the item update and the `activity_events` insert simultaneously.

### Decision
I chose hand-written parameterized SQL using the `pg` driver wrapped in a robust `withTransaction` helper. Every item mutation writes the new state and inserts an audit record into `activity_events` inside the exact same database transaction. Furthermore, I added a PostgreSQL database trigger on `activity_events` that raises an exception on any `UPDATE` or `DELETE`, ensuring the table is physically append-only even against accidental queries.

### Trade-off
I wrote explicit SQL queries and manual mapping rather than relying on automatic ORM abstractions. This required more upfront code but eliminated query generation ambiguity, avoided N+1 query patterns, and gave me deterministic control over transactional boundaries and database locks.

---

## Decision 2: Concurrency: Conditional UPDATE for Claims and Optimistic Locking for Edits

### Context
Operational incidents are subject to high contention. When a high-severity ticket appears, multiple operators may attempt to claim it at the same second. Similarly, two operators reviewing an item might submit conflicting edits simultaneously.

### Options Considered
1. **Pessimistic Locking (`SELECT FOR UPDATE`)**: Locking the row upon opening the detail view. This requires stateful WebSocket sessions or arbitrary lock timeouts, holds open database transactions, and risks deadlock or locks abandoned by closing tabs.
2. **Distributed Locks (Redis/Redlock)**: Adds an external dependency, introducing network overhead and failure modes when Redis and PostgreSQL diverge.
3. **Atomic Conditional UPDATE for claims, OCC `version` column for edits**: Using PostgreSQL row-level locks natively within single atomic statements.

### Decision
I chose conditional SQL updates for claims and an integer `version` column for optimistic concurrency control (OCC):
- **Claim Race Resolution**:
  ```sql
  UPDATE work_items 
  SET assignee_id = $1, status = 'in_progress', version = version + 1, updated_at = now()
  WHERE id = $2 AND assignee_id IS NULL AND status IN ('open', 'in_progress')
  RETURNING *;
  ```
  PostgreSQL evaluates rows atomically. The first query updates the row; all subsequent concurrent queries match zero rows. If zero rows match, the code inspects the current assignee and immediately returns `409 ALREADY_CLAIMED` containing the winning assignee's name.
- **Edits and Transitions**:
  Every update includes `WHERE id = $1 AND version = $version`. If another user modified the item in the interim, the version mismatch returns zero updated rows, triggering `409 VERSION_CONFLICT` with the latest record snapshot (`error.current`).

### Trade-off
Under extreme contention, optimistic locking requires the losing client to reload the latest version and retry. For human operations (where ticket collision is intermittent rather than high-frequency machine trading), this is significantly more scalable, resilient, and non-blocking than holding pessimistic row locks.

---

## Decision 3: Transactional Idempotency Keys with Deduplicated Caching

### Context
Flaky mobile connections or impatient operators double-clicking action buttons cause repeated POST requests. Re-executing mutations could double-assign tickets, duplicate comments, or advance workflow states incorrectly.

### Options Considered
1. **Client-side debouncing only**: Easily bypassed by page refreshes, network drops, or multiple browser windows.
2. **Redis-backed key-value store**: Stores keys in memory with a TTL. However, if Redis writes succeed but PostgreSQL fails, or if Redis restarts, duplicate operations can slip through.
3. **Transactional database table `idempotency_keys`**: Storing the key, user ID, status code, and response body inside PostgreSQL.

### Decision
I implemented transactional idempotency using an `idempotency_keys` table. The unique constraint `UNIQUE (user_id, key)` ensures that concurrent duplicate requests hit a unique constraint violation. The service catches this, waits for the in-flight transaction to finish, and returns the exact cached HTTP status code and response payload. If the initial attempt fails or is retried, the same key is honored without duplicating side effects.

### Trade-off
Storing response bodies in `idempotency_keys` consumes relational database storage. To keep table size bounded, records can be pruned via a retention job (e.g. 7 days). The guarantee of zero duplicate operations within the primary database transaction outweighs the storage cost.

---

## Decision 4: Single Server-Side Authorization Function with Per-Team Role Scoping

### Context
Authorization bugs are the leading cause of privilege escalation in multi-tenant systems. If authorization rules are duplicated across different Express middleware, controller functions, and UI helpers, inconsistencies inevitably emerge.

### Options Considered
1. **Scattered controller checks**: Checking `if (req.user.role === 'admin')` inside each route handler. Prone to copy-paste omissions and drift.
2. **Complex declarative ABAC/PBAC engine (e.g., Casbin or OPA)**: Adds steep runtime overhead, external configuration parsing, and excessive abstraction for a 4-tier role hierarchy.
3. **Single pure authorization function `can(user, action, item, context)`**: A centralized, deterministic policy module.

### Decision
I designed a single authorization engine in `backend/src/services/permissions.ts`. Every route and service invokes `can(user, action, item, context)`:
- It checks that the user belongs to the target team (`membership = user.memberships.find(m => m.teamId === item.team_id)`).
- It verifies role privileges: Viewers cannot create, edit, claim, or transition; Members can only edit items they created or are assigned to; Leads can assign and approve; Admins have full administrative authority.
- **403 vs 404 Choice**: If an item does not exist, the API returns `404 NOT_FOUND`. If an item exists but belongs to a team the user is not a member of, the API returns `403 FORBIDDEN`. This ensures clear security audit logging while isolating tenants.
- **`allowedActions` UI Hints**: The backend computes boolean flags (`claim`, `edit`, `assign`, `comment`, `transitions`) and attaches them to `GET /api/items/:id`. The frontend uses these to disable buttons and display tooltips, but the backend re-validates `can()` on every incoming request; UI hints are strictly non-authoritative.

### Trade-off
Every API route must pass the full item context to `can()`. This slight coupling guarantees that no route can inadvertently mutate an item without validating team boundaries first.

---

## Decision 5: Transactional Outbox with PostgreSQL-Polling Worker

### Context
When a ticket is assigned or status changes, notifications must be dispatched to users and logged for audit. If the API sends emails or pushes directly inside the HTTP request handler, an external network timeout blocks the user, and an API crash after the database write results in lost notifications.

### Options Considered
1. **In-memory queue (e.g. EventEmitter or local memory queue)**: Lost immediately if the Node.js process crashes or restarts.
2. **External message broker (RabbitMQ or Redis BullMQ)**: Introduces the "dual-write" problem: writing to PostgreSQL and publishing to Redis cannot be executed atomically across two different data stores without two-phase commit.
3. **Transactional Outbox in PostgreSQL**: Writing the job to an `outbox_jobs` table inside the same transaction as the item update, processed by an independent polling worker daemon.

### Decision
I implemented the Transactional Outbox pattern:
- The API transaction that modifies `work_items` also inserts into `outbox_jobs`. If the transaction rolls back, no spurious notification is queued.
- A separate background worker daemon polls `outbox_jobs` using:
  ```sql
  UPDATE outbox_jobs
  SET status = 'processing',
      locked_at = now(),
      attempts = attempts + 1
  WHERE id IN (
    SELECT id
    FROM outbox_jobs
    WHERE (status = 'pending' AND run_at <= now())
       OR (status = 'processing' AND locked_at < now() - interval '60 seconds')
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT 10
  )
  RETURNING *;
  ```
- `FOR UPDATE SKIP LOCKED` ensures multiple worker processes never process the same job concurrently.
- Handlers are written idempotently (e.g. notifications using `ON CONFLICT (job_id, user_id) DO NOTHING`). Failures increment `attempts` and calculate exponential backoff (`run_at = now() + (power(2, attempts) * interval '2 seconds')`).

### Trade-off
Polling PostgreSQL introduces periodic read queries (every 1500ms). However, by indexing `(run_at, id) WHERE status = 'pending'` via `idx_outbox_jobs_pending`, the query executes in sub-millisecond time on an index scan. It completely eliminates external broker dependencies while guaranteeing zero lost events.

---

## Decision 6: Keyset Pagination, Partial Indexes, and Server-Side Search

### Context
The database is seeded with 5,000+ items and must scale to hundreds of thousands of records without degrading API response times or freezing client browsers.

### Options Considered
1. **Offset Pagination (`OFFSET 1000 LIMIT 50`)**: PostgreSQL must scan and discard the first 1,000 rows. At page 500, response times degrade noticeably, and concurrent inserts cause page drift (duplicate or skipped items).
2. **Client-side filtering and pagination**: Fetching thousands of rows into the browser memory. This wastes network bandwidth and freezes mobile browser threads.
3. **Server-side Keyset Pagination with specialized PostgreSQL indexes**:

### Decision
I implemented server-side keyset pagination using a composite cursor `(created_at, id)`:
- Queries fetch items with `WHERE (wi.created_at < $cursorCreatedAt OR (wi.created_at = $cursorCreatedAt AND wi.id < $cursorId)) ORDER BY wi.created_at DESC, wi.id DESC LIMIT 50`.
- The cursor is encoded as a URL-safe base64 string containing both values. Because the database jumps directly to the index position, fetching page 100 takes the exact same sub-millisecond execution time as page 1.
- **Targeted Partial Indexes**:
  - `idx_work_items_unassigned_urgent`: Partial index on `(team_id, created_at DESC, id DESC) WHERE assignee_id IS NULL AND priority = 'urgent' AND status NOT IN ('resolved', 'closed')`. The dashboard's "Unassigned urgent" counter queries an index with only a handful of active rows rather than scanning thousands of closed tickets.
  - `idx_work_items_search_vector`: GIN index on generated column `search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || description)) STORED`. Full-text search executes through an inverted index rather than expensive table scans (`LIKE %...%`).

### Trade-off
Keyset pagination does not allow jumping arbitrarily to "Page 47", only "Next" and "Previous" sequential navigation. For operational feeds and incident queues where operators work newest-to-oldest, keyset pagination provides vastly superior stability and performance.

---

## Failure Modes Analysis

| Failure Scenario | Immediate System Behaviour | Recovery Mechanism |
| :--- | :--- | :--- |
| **PostgreSQL Unavailable** | Express catches connection errors and returns 500 `INTERNAL_SERVER_ERROR`. API `/api/health` returns failure. Worker poll errors logged. | Connection pool reconnects automatically with exponential retry backoff. Frontend displays inline Retry state without crash. |
| **Worker Crashes Mid-Job** | Row remains marked with `status = 'processing'` and `locked_at = crash_timestamp`. | Lock expires after 60 seconds (`locked_at < now() - interval '60 seconds'`). The next worker iteration re-claims the job with `SKIP LOCKED` and safely re-executes. |
| **Duplicate Network Request** | Caught by `UNIQUE (user_id, key)` on `idempotency_keys`. | Wait lock resolves, reads cached status code and payload, and returns the original response without re-executing logic. |
| **Concurrent Item Claim Race** | Single row conditional update succeeds for first query. Remaining 9 queries update 0 rows. | First operator receives 200 OK. Other 9 operators receive `409 ALREADY_CLAIMED` with the winning operator's name. |
| **Stale Edit Submission** | SQL `WHERE version = $version` matches 0 rows. | API returns `409 VERSION_CONFLICT` with latest server record. Frontend keeps user draft intact and offers "Reload latest". |

---

## What Changes at 10x Scale

If the workload increased from 5,000 items to 500,000 active tickets and 500 concurrent operators:

1. **PostgreSQL Read Replicas**:
   Separate read traffic from write transactions. Direct `GET /api/items` (keyset pagination and full-text search) and dashboard metric aggregation to read replicas using pgpool or AWS Aurora reader endpoints, reserving the primary writer instance strictly for transactional mutations.
2. **Table Partitioning for Audit History**:
   Partition `activity_events` by month (`PARTITION BY RANGE (created_at)`). Historical audit records older than 6 months move to read-only partitions or cold storage, keeping index trees compact and memory-resident.
3. **Dedicated Queue Broker**:
   Transition `outbox_jobs` from table polling to a high-throughput broker like Redis Streams or Apache Kafka for sub-second event delivery across geographically distributed microservices.
4. **Dedicated Search Engine**:
   Offload `tsvector` full-text search to Meilisearch or Elasticsearch to provide typo tolerance, faceted filtering, and multi-language stemmers without imposing CPU load on the core relational database.
5. **Real-time Server-Sent Events (SSE)**:
   Replace client-side TanStack Query polling (15s) with a lightweight Redis Pub/Sub backplane broadcasting Server-Sent Events to connected browsers for instantaneous status stepper and notification updates.

---

## Known Limitations

1. **Email Integration**: The current worker implementation logs outgoing notifications to the console and inserts user notifications into the database table, rather than integrating an external SMTP transport.
2. **Single Primary Database**: The architecture runs on a single PostgreSQL primary node; high availability requires configuring streaming replication with automatic failover (Patroni or managed RDS).
3. **English Stemming Only**: The full-text search index uses PostgreSQL's `english` configuration; non-English search terms rely on exact substring matching.

---

## Next Week Roadmap

If given an additional week to iterate on this codebase, I would prioritize:
1. **Server-Sent Events (SSE)**: Live streaming of state machine stepper advancements and notification toasts without periodic polling.
2. **Bulk Actions API**: Transactional endpoint allowing leads to batch-assign or bulk-close multiple related operational incidents simultaneously.
3. **Custom Saved Filters**: Storing user-defined query views in the database to allow operators to pin personalized operational queues to their dashboard.
4. **Rich Text & Mentions**: Markdown editor support for incident comments with `@mention` notifications to alert specific team members.
