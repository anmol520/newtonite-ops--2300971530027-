// Workflow state transitions definition
// The allowed-transitions map lives in this ONE place.

export const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  open: ['in_progress'],
  in_progress: ['awaiting_approval'],
  awaiting_approval: ['resolved', 'in_progress'],
  resolved: ['closed', 'in_progress'],
  closed: [],
};

/**
 * Checks if a transition from one status to another is architecturally valid according to the state machine.
 */
export function isValidTransition(from: string, to: string): boolean {
  const allowed = ALLOWED_TRANSITIONS[from];
  return Boolean(allowed && allowed.includes(to));
}

/**
 * Checks if a transition requires an explicit reason.
 * Rejection (awaiting_approval -> in_progress) and reopen (resolved -> in_progress) require a reason.
 */
export function requiresReason(from: string, to: string): boolean {
  if (from === 'awaiting_approval' && to === 'in_progress') {
    return true;
  }
  if (from === 'resolved' && to === 'in_progress') {
    return true;
  }
  return false;
}

/**
 * Returns the notification outbox job type to enqueue for a given status transition, if any.
 */
export function getTransitionOutboxJobType(from: string, to: string): 'NOTIFY_APPROVERS' | 'NOTIFY_ASSIGNEE' | null {
  if (from === 'in_progress' && to === 'awaiting_approval') {
    return 'NOTIFY_APPROVERS';
  }
  if (from === 'awaiting_approval' && (to === 'resolved' || to === 'in_progress')) {
    return 'NOTIFY_ASSIGNEE';
  }
  return null;
}
