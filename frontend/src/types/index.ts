export type UserRole = 'viewer' | 'member' | 'lead' | 'admin';

export interface Membership {
  teamId: string;
  teamName: string;
  role: UserRole;
}

export interface User {
  id: string;
  email: string;
  name: string;
  memberships: Membership[];
}

export type ItemType = 'incident' | 'customer_issue' | 'payment' | 'compliance' | 'task';
export type ItemPriority = 'low' | 'medium' | 'high' | 'urgent';
export type ItemStatus = 'open' | 'in_progress' | 'awaiting_approval' | 'resolved' | 'closed';

export interface AllowedActions {
  edit: boolean;
  comment: boolean;
  claim: boolean;
  assign: boolean;
  transitions: string[];
}

export interface WorkItem {
  id: string;
  title: string;
  description: string;
  type: ItemType;
  priority: ItemPriority;
  status: ItemStatus;
  team_id: string;
  team_name?: string;
  assignee_id: string | null;
  assignee_name?: string | null;
  created_by: string;
  created_by_name?: string;
  due_date: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  allowedActions: AllowedActions;
}

export interface ActivityEvent {
  id: string;
  item_id: string;
  actor_id: string | null;
  actor_name?: string | null;
  event_type: string;
  payload: Record<string, any>;
  created_at: string;
}

export interface CommentRecord {
  id: string;
  item_id: string;
  author_id: string;
  author_name?: string;
  body: string;
  created_at: string;
}

export interface NotificationRecord {
  id: string;
  user_id: string;
  item_id: string;
  job_id: string;
  message: string;
  read_at: string | null;
  created_at: string;
}

export interface DashboardCounts {
  assignedToMe: number;
  unassignedUrgent: number;
  awaitingMyApproval: number;
  assigned_to_me?: number;
  unassigned_urgent?: number;
  awaiting_my_approval?: number;
}

export interface PaginatedResponse<T> {
  items?: T[];
  events?: T[];
  nextCursor: string | null;
}

export interface TeamMember {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

export interface Team {
  id: string;
  name: string;
  role: UserRole;
}
