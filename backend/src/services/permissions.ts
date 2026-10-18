import { UserContext, UserRole } from '../middleware/auth';
import { ALLOWED_TRANSITIONS, isValidTransition } from './workflow';

export type PermissionAction =
  | 'read'
  | 'create'
  | 'edit'
  | 'comment'
  | 'claim'
  | 'assign'
  | 'transition';

export interface ItemContext {
  id?: string;
  team_id: string;
  status?: string;
  assignee_id?: string | null;
  created_by?: string;
}

export interface TransitionContext {
  to?: string;
  targetMembershipRole?: UserRole | null;
}

/**
 * Single authorization enforcement point across the system.
 * Routes and services never perform ad-hoc role comparisons; all authorization
 * decisions must route through this function.
 */
export function can(
  user: UserContext,
  action: PermissionAction,
  item?: ItemContext,
  context?: TransitionContext
): boolean {
  if (!item || !item.team_id) {
    return false;
  }

  // Authorization check: Prevents horizontal privilege escalation.
  // A user who is not a member of the item's team has zero read/write access.
  const membership = user.memberships.find((m) => m.teamId === item.team_id);
  if (!membership) {
    return false;
  }

  const role = membership.role;
  const status = item.status || 'open';

  switch (action) {
    case 'read':
      // Any assigned role in the item's team (viewer, member, lead, admin) can read.
      return true;

    case 'create':
      // Authorization check: Prevents unauthorized creation.
      // Viewers are read-only; only members, leads, and admins may create items.
      return role === 'member' || role === 'lead' || role === 'admin';

    case 'edit': {
      // Authorization check: Prevents tampering with finalized items.
      // Work items in 'resolved' or 'closed' status are immutable.
      if (status === 'resolved' || status === 'closed') {
        return false;
      }
      if (role === 'admin' || role === 'lead') {
        return true;
      }
      if (role === 'member') {
        // Members may only edit items they created or are currently assigned to.
        return item.assignee_id === user.id || item.created_by === user.id;
      }
      return false; // Viewer never
    }

    case 'comment':
      // Authorization check: Prevents unauthorized commenting by viewers.
      // Members, leads, and admins can comment (even on closed items).
      return role === 'member' || role === 'lead' || role === 'admin';

    case 'claim': {
      // Authorization check: Prevents unauthorized or invalid claims.
      // Only members, leads, and admins can claim, and the item must be unassigned
      // and in open or in_progress status.
      const isRoleAllowed = role === 'member' || role === 'lead' || role === 'admin';
      const isUnassigned = !item.assignee_id;
      const isStatusAllowed = status === 'open' || status === 'in_progress';
      return isRoleAllowed && isUnassigned && isStatusAllowed;
    }

    case 'assign': {
      // Authorization check: Prevents unauthorized assignment.
      // Only leads and admins can assign or unassign items.
      if (role !== 'lead' && role !== 'admin') {
        return false;
      }
      // If a target assignee role is provided in context, verify target eligibility.
      // Target assignee must be a member, lead, or admin of the item's team (never viewer).
      if (context && context.targetMembershipRole !== undefined && context.targetMembershipRole !== null) {
        return ['member', 'lead', 'admin'].includes(context.targetMembershipRole);
      }
      return true;
    }

    case 'transition': {
      // If a specific target transition status is given, evaluate it.
      if (context?.to) {
        const targetStatus = context.to;
        if (!isValidTransition(status, targetStatus)) {
          return false;
        }

        // open -> in_progress: assignee or lead/admin. Item must have an assignee.
        if (status === 'open' && targetStatus === 'in_progress') {
          if (!item.assignee_id) {
            return false;
          }
          return item.assignee_id === user.id || role === 'lead' || role === 'admin';
        }

        // in_progress -> awaiting_approval: assignee or lead/admin.
        if (status === 'in_progress' && targetStatus === 'awaiting_approval') {
          return item.assignee_id === user.id || role === 'lead' || role === 'admin';
        }

        // awaiting_approval -> resolved: approval step.
        // Authorization check: Prevents conflict of interest self-approval.
        // Lead or admin only; a lead cannot approve an item assigned to themselves (admin can).
        if (status === 'awaiting_approval' && targetStatus === 'resolved') {
          if (role === 'admin') {
            return true;
          }
          if (role === 'lead') {
            return item.assignee_id !== user.id;
          }
          return false;
        }

        // awaiting_approval -> in_progress (rejection): lead or admin only.
        if (status === 'awaiting_approval' && targetStatus === 'in_progress') {
          return role === 'lead' || role === 'admin';
        }

        // resolved -> closed: lead or admin only.
        if (status === 'resolved' && targetStatus === 'closed') {
          return role === 'lead' || role === 'admin';
        }

        // resolved -> in_progress (reopen): lead or admin only.
        if (status === 'resolved' && targetStatus === 'in_progress') {
          return role === 'lead' || role === 'admin';
        }

        return false;
      }

      // If no specific target status provided, check if any valid transition is allowed
      const nextCandidates = ALLOWED_TRANSITIONS[status] || [];
      return nextCandidates.some((nextStatus) =>
        can(user, 'transition', item, { to: nextStatus })
      );
    }

    default:
      return false;
  }
}

/**
 * Computes all allowed transitions for a given work item and user.
 */
export function getAllowedTransitions(user: UserContext, item: ItemContext): string[] {
  const status = item.status || 'open';
  const candidates = ALLOWED_TRANSITIONS[status] || [];
  return candidates.filter((targetStatus) =>
    can(user, 'transition', item, { to: targetStatus })
  );
}

/**
 * Computes the allowedActions UI hint object required in all item responses.
 * Uses the exact same can() rules to ensure server-client consistency.
 */
export function getAllowedActions(user: UserContext, item: ItemContext) {
  return {
    edit: can(user, 'edit', item),
    comment: can(user, 'comment', item),
    claim: can(user, 'claim', item),
    assign: can(user, 'assign', item),
    transitions: getAllowedTransitions(user, item),
  };
}
