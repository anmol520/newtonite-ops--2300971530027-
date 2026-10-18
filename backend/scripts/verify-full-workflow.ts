import { config } from '../src/config';

async function verifyFullWorkflow() {
  const baseUrl = `http://localhost:${config.port}/api`;
  console.log(`Running Scenario 5 Full Workflow Verification...`);

  // 1. Login as Member
  const memberLogin = await (await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'member.payments@demo.dev', password: 'Demo@12345' }),
  })).json() as { token: string };
  const memberToken = memberLogin.token;

  const me = await (await fetch(`${baseUrl}/me`, {
    headers: { Authorization: `Bearer ${memberToken}` },
  })).json() as any;
  const teamId = me.memberships[0].teamId;

  // 2. Member creates item
  const createRes = await (await fetch(`${baseUrl}/items`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberToken}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      teamId,
      title: 'Workflow Lifecycle Incident',
      description: 'Verifying rejection and re-approval',
      type: 'incident',
      priority: 'high',
    }),
  })).json() as any;
  console.log(`1. Member created item: ${createRes.id} (Status: ${createRes.status}, v${createRes.version})`);

  // 3. Member claims item
  const claimRes = await (await fetch(`${baseUrl}/items/${createRes.id}/claim`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${memberToken}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
  })).json() as any;
  console.log(`2. Member claimed item: (Status: ${claimRes.status}, Assignee: ${claimRes.assignee_name}, v${claimRes.version})`);

  // 4. Member requests approval
  const reqApprovalRes = await (await fetch(`${baseUrl}/items/${createRes.id}/transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberToken}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ to: 'awaiting_approval', version: claimRes.version }),
  })).json() as any;
  console.log(`3. Member requested approval: (Status: ${reqApprovalRes.status}, v${reqApprovalRes.version})`);

  // 5. Login as Lead
  const leadLogin = await (await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'lead.payments@demo.dev', password: 'Demo@12345' }),
  })).json() as { token: string };
  const leadToken = leadLogin.token;

  // 6. Lead rejects with reason
  const rejectRes = await (await fetch(`${baseUrl}/items/${createRes.id}/transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${leadToken}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({
      to: 'in_progress',
      version: reqApprovalRes.version,
      reason: 'Missing test verification logs on staging',
    }),
  })).json() as any;
  console.log(`4. Lead rejected item: (Status: ${rejectRes.status}, v${rejectRes.version})`);

  // 7. Member comments and re-requests approval
  await fetch(`${baseUrl}/items/${createRes.id}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberToken}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ body: 'Attached test verification logs. Ready for re-review.' }),
  });

  const reReqApprovalRes = await (await fetch(`${baseUrl}/items/${createRes.id}/transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${memberToken}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ to: 'awaiting_approval', version: rejectRes.version }),
  })).json() as any;
  console.log(`5. Member re-requested approval: (Status: ${reReqApprovalRes.status}, v${reReqApprovalRes.version})`);

  // 8. Lead approves
  const approveRes = await (await fetch(`${baseUrl}/items/${createRes.id}/transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${leadToken}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ to: 'resolved', version: reReqApprovalRes.version }),
  })).json() as any;
  console.log(`6. Lead approved item: (Status: ${approveRes.status}, v${approveRes.version})`);

  // 9. Lead closes item
  const closeRes = await (await fetch(`${baseUrl}/items/${createRes.id}/transition`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${leadToken}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ to: 'closed', version: approveRes.version }),
  })).json() as any;
  console.log(`7. Lead closed item: (Status: ${closeRes.status}, v${closeRes.version})`);

  // 10. Verify activity timeline
  const activity = await (await fetch(`${baseUrl}/items/${createRes.id}/activity`, {
    headers: { Authorization: `Bearer ${leadToken}` },
  })).json() as any;
  console.log(`8. Activity timeline contains ${activity.events.length} events:`);
  for (const e of activity.events) {
    console.log(`   - [${e.event_type}] by ${e.actor_name} ${e.payload?.reason ? `(Reason: "${e.payload.reason}")` : ''}`);
  }

  // 11. Viewer check: Viewer token gets 403 on mutation
  const viewerLogin = await (await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'viewer@demo.dev', password: 'Demo@12345' }),
  })).json() as { token: string };
  const viewerToken = viewerLogin.token;

  const viewerAttempt = await fetch(`${baseUrl}/items/${createRes.id}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${viewerToken}`,
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ body: 'Viewer trying to write' }),
  });
  console.log(`9. Viewer write attempt status: HTTP ${viewerAttempt.status} (Expected 403)`);

  if (viewerAttempt.status === 403 && activity.events.length >= 6) {
    console.log(`\n✓ SCENARIO 5 & 6 FULL WORKFLOW AND VIEWER RESTRICTIONS VERIFIED!\n`);
  } else {
    throw new Error('Workflow verification failed');
  }
}

verifyFullWorkflow().catch((err) => {
  console.error(err);
  process.exit(1);
});
