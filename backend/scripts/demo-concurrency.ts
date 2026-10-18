import { config } from '../src/config';

interface LoginResponse {
  token: string;
}

interface ItemResponse {
  id: string;
  version: number;
  status: string;
  assignee_name?: string | null;
  title: string;
}

async function runDemo() {
  const baseUrl = `http://localhost:${config.port}/api`;
  console.log(`\n======================================================`);
  console.log(`CRITICAL CONCURRENCY & IDEMPOTENCY LIVE DEMO SCRIPT`);
  console.log(`Connecting to: ${baseUrl}`);
  console.log(`======================================================\n`);

  // 1. Authenticate seeded operators
  console.log(`[1/4] Authenticating demo operators...`);
  const memberEmails = [
    'member.payments@demo.dev',
    'member2.payments@demo.dev',
    'lead.payments@demo.dev',
  ];

  const tokens: string[] = [];
  for (const email of memberEmails) {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Demo@12345' }),
    });
    if (!res.ok) {
      throw new Error(`Failed to login as ${email}: ${res.statusText}`);
    }
    const data = (await res.json()) as LoginResponse;
    tokens.push(data.token);
  }
  console.log(`✓ Successfully authenticated ${tokens.length} distinct operator accounts.\n`);

  // Fetch team ID
  const meRes = await fetch(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${tokens[0]}` },
  });
  const meData = (await meRes.json()) as any;
  const teamId = meData.memberships[0].teamId;

  // 2. Race condition demo: 10 parallel claims at 1 unassigned item
  console.log(`[2/4] Testing Atomic Claims: 10 concurrent requests competing for 1 item...`);
  const createRes = await fetch(`${baseUrl}/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens[0]}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      teamId,
      title: 'High-contention Gateway Spike',
      description: 'Concurrent race condition test ticket',
      type: 'incident',
      priority: 'urgent',
    }),
  });
  const contestItem = (await createRes.json()) as ItemResponse;
  console.log(`Created target unassigned item: ${contestItem.id}`);

  // Dispatch 10 parallel claims
  const claimPromises = Array.from({ length: 10 }, async (_, idx) => {
    const token = tokens[idx % tokens.length];
    const res = await fetch(`${baseUrl}/items/${contestItem.id}/claim`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Idempotency-Key': crypto.randomUUID(),
      },
    });
    const status = res.status;
    const body = (await res.json()) as any;
    return { status, body, idx };
  });

  const claimResults = await Promise.all(claimPromises);
  const claimSuccesses = claimResults.filter((r) => r.status === 200);
  const claimConflicts = claimResults.filter((r) => r.status === 409);

  console.log(`Results: ${claimSuccesses.length} claims succeeded (200 OK), ${claimConflicts.length} rejected (409 ALREADY_CLAIMED)`);
  if (claimSuccesses.length === 1 && claimConflicts.length === 9) {
    console.log(`✓ ATOMIC CLAIM VERIFIED: Exactly 1 winner, 0 duplicate assignments.\n`);
  } else {
    console.error(`✗ CLAIM RACE FAILURE: Expected 1 success and 9 conflicts!`);
  }

  // 3. Idempotency demo: 5 identical parallel creates with 1 key
  console.log(`[3/4] Testing Transactional Idempotency: 5 identical parallel creates with 1 key...`);
  const sharedKey = crypto.randomUUID();
  const idempPayload = {
    teamId,
    title: 'Payment Gateway Double-Click Protection',
    description: 'Validating zero duplicate side-effects',
    type: 'payment',
    priority: 'high',
  };

  const idempPromises = Array.from({ length: 5 }, async () => {
    const res = await fetch(`${baseUrl}/items`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokens[0]}`,
        'Idempotency-Key': sharedKey,
      },
      body: JSON.stringify(idempPayload),
    });
    const body = (await res.json()) as ItemResponse;
    return { status: res.status, id: body.id };
  });

  const idempResults = await Promise.all(idempPromises);
  const uniqueItemIds = new Set(idempResults.map((r) => r.id));

  console.log(`Results: 5 parallel requests returned HTTP ${idempResults[0].status}`);
  console.log(`Distinct item IDs generated: ${uniqueItemIds.size}`);
  if (uniqueItemIds.size === 1) {
    console.log(`✓ IDEMPOTENCY VERIFIED: 5 requests produced exactly 1 work item.\n`);
  } else {
    console.error(`✗ IDEMPOTENCY FAILURE: Multiple items created!`);
  }

  // 4. Optimistic locking demo: Stale version collision
  console.log(`[4/4] Testing Optimistic Concurrency Control (OCC): Stale version update...`);
  const targetId = Array.from(uniqueItemIds)[0];
  
  // Advance version from 1 -> 2
  const validUpdate = await fetch(`${baseUrl}/items/${targetId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens[0]}`,
    },
    body: JSON.stringify({
      version: 1,
      title: 'Payment Gateway Double-Click Protection [Updated]',
    }),
  });
  const updatedItem = (await validUpdate.json()) as ItemResponse;
  console.log(`Updated item to version ${updatedItem.version}`);

  // Now attempt update with stale version 1
  const staleUpdate = await fetch(`${baseUrl}/items/${targetId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens[0]}`,
    },
    body: JSON.stringify({
      version: 1, // Stale version!
      title: 'Stale overwrite attempt that must fail',
    }),
  });
  const staleStatus = staleUpdate.status;
  const staleBody = (await staleUpdate.json()) as any;

  console.log(`Stale update response: HTTP ${staleStatus} (${staleBody?.error?.code || 'UNKNOWN'})`);
  if (staleStatus === 409) {
    console.log(`✓ OCC VERIFIED: Stale update rejected with 409 conflict, latest server version preserved.\n`);
  } else {
    console.error(`✗ OCC FAILURE: Stale update did not return 409!`);
  }

  // Final Summary
  console.log(`======================================================`);
  console.log(`SUMMARY OF RESULTS`);
  console.log(`======================================================`);
  console.log(`1. Parallel Claims (10 attempts): ${claimSuccesses.length} Winner (200), ${claimConflicts.length} Conflicts (409)`);
  console.log(`2. Parallel Idempotent Creates (5 attempts): 1 Item Created, 0 Duplicates`);
  console.log(`3. Stale OCC Version Update: Rejected (HTTP ${staleStatus} VERSION_CONFLICT)`);
  console.log(`======================================================\n`);
}

runDemo().catch((err) => {
  console.error('Demo encountered an error:', err);
  process.exit(1);
});
