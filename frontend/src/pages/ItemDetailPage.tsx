import { useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  UserPlus,
  Edit3,
  CheckCircle,
  Play,
  FileCheck,
  RotateCcw,
  XCircle,
  MessageSquare,
  History,
  Send,
  AlertCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiFetch, ApiError } from '../api/client';
import {
  WorkItem,
  ActivityEvent,
  CommentRecord,
  TeamMember,
  ItemPriority,
  PaginatedResponse,
} from '../types';
import { WorkflowStepper } from '../components/items/WorkflowStepper';
import { StatusBadge, PriorityBadge, TypeBadge, OverdueBadge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Modal } from '../components/ui/Modal';
import { ErrorState } from '../components/ui/ErrorState';

export function ItemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<'activity' | 'comments'>('activity');
  const [isEditing, setIsEditing] = useState(false);
  const [conflictBanner, setConflictBanner] = useState<string | null>(null);

  // Edit form state
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPriority, setEditPriority] = useState<ItemPriority>('medium');
  const [editDueDate, setEditDueDate] = useState('');

  // Comment input state
  const [commentText, setCommentText] = useState('');
  const commentIdempotencyKeyRef = useRef(crypto.randomUUID());

  // Reason dialog state for rejection or reopening
  const [reasonModalOpen, setReasonModalOpen] = useState(false);
  const [targetStatusForReason, setTargetStatusForReason] = useState<string>('');
  const [reasonTitle, setReasonTitle] = useState('');
  const [reasonText, setReasonText] = useState('');

  // Idempotency keys for action retries
  const claimKeyRef = useRef(crypto.randomUUID());
  const assignKeyRef = useRef(crypto.randomUUID());
  const transitionKeyRef = useRef(crypto.randomUUID());

  // Query item details - refetches every 15s and on window focus
  const {
    data: item,
    isLoading: isItemLoading,
    isError: isItemError,
    error: itemError,
    refetch: refetchItem,
  } = useQuery({
    queryKey: ['item', id],
    queryFn: async () => {
      const data = await apiFetch<WorkItem>(`/api/items/${id}`);
      return data;
    },
    enabled: Boolean(id),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  // Query team members for assignment (only if caller has assign rights)
  const { data: teamMembers } = useQuery({
    queryKey: ['teamMembers', item?.team_id],
    queryFn: async () => {
      return await apiFetch<TeamMember[]>(`/api/teams/${item!.team_id}/members`);
    },
    enabled: Boolean(item?.team_id && item?.allowedActions?.assign),
  });

  // Keyset paginated activity events
  const {
    data: activityData,
    isLoading: isActivityLoading,
    fetchNextPage: fetchNextActivity,
    hasNextPage: hasNextActivity,
    isFetchingNextPage: isFetchingNextActivity,
  } = useInfiniteQuery({
    queryKey: ['activity', id],
    queryFn: async ({ pageParam }) => {
      const cursorParam = pageParam ? `&cursor=${encodeURIComponent(pageParam as string)}` : '';
      return await apiFetch<PaginatedResponse<ActivityEvent>>(
        `/api/items/${id}/activity?limit=25${cursorParam}`
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor || null,
    enabled: Boolean(id),
  });

  // Comments query
  const { data: comments, refetch: refetchComments } = useQuery({
    queryKey: ['comments', id],
    queryFn: async () => {
      return await apiFetch<CommentRecord[]>(`/api/items/${id}/comments`);
    },
    enabled: Boolean(id && activeTab === 'comments'),
  });

  // Initialize edit form when opening edit mode
  const startEditing = () => {
    if (!item) return;
    setEditTitle(item.title);
    setEditDescription(item.description || '');
    setEditPriority(item.priority);
    setEditDueDate(item.due_date ? new Date(item.due_date).toISOString().slice(0, 16) : '');
    setIsEditing(true);
    setConflictBanner(null);
  };

  // -------------------------------------------------------------
  // STATE RECONCILIATION: Optimistic Claim Mutation (Part D)
  // -------------------------------------------------------------
  const claimMutation = useMutation({
    mutationFn: async () => {
      return await apiFetch<WorkItem>(`/api/items/${id}/claim`, {
        method: 'POST',
        idempotencyKey: claimKeyRef.current,
      });
    },
    onMutate: async () => {
      // 1. Cancel outgoing queries so they do not overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['item', id] });

      // 2. Snapshot the current cache
      const previousItem = queryClient.getQueryData<WorkItem>(['item', id]);

      // 3. Optimistically update the UI to claimed state immediately
      if (previousItem) {
        queryClient.setQueryData<WorkItem>(['item', id], {
          ...previousItem,
          assignee_id: user?.id || null,
          assignee_name: user?.name || null,
          status: previousItem.status === 'open' ? 'in_progress' : previousItem.status,
          version: previousItem.version + 1,
        });
      }

      return { previousItem };
    },
    onError: (err: ApiError, _variables, context) => {
      // 1. Roll back to snapshot on error
      if (context?.previousItem) {
        queryClient.setQueryData(['item', id], context.previousItem);
      }

      // 2. On 409 (ALREADY_CLAIMED), apply server's latest version and show conflict banner
      if (err.status === 409) {
        if (err.current) {
          queryClient.setQueryData(['item', id], err.current);
        }
        setConflictBanner('This item was changed by someone else. Showing the latest version.');
        const claimant = err.current?.assignee_name || 'Another team member';
        toastError(`${claimant} already claimed this item.`);
      } else {
        toastError(err.message || 'Failed to claim item');
      }
    },
    onSuccess: (updated) => {
      success('Item successfully claimed!');
      setConflictBanner(null);
      claimKeyRef.current = crypto.randomUUID(); // Fresh idempotency key for next action
      queryClient.setQueryData(['item', id], updated);
    },
    onSettled: () => {
      // Always revalidate cache with server truth
      queryClient.invalidateQueries({ queryKey: ['item', id] });
      queryClient.invalidateQueries({ queryKey: ['activity', id] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  // -------------------------------------------------------------
  // STATE RECONCILIATION: Optimistic Transition Mutation (Part D)
  // -------------------------------------------------------------
  const transitionMutation = useMutation({
    mutationFn: async ({ to, reason }: { to: string; reason?: string }) => {
      return await apiFetch<WorkItem>(`/api/items/${id}/transition`, {
        method: 'POST',
        idempotencyKey: transitionKeyRef.current,
        body: JSON.stringify({
          to,
          version: item!.version,
          reason: reason || undefined,
        }),
      });
    },
    onMutate: async ({ to }) => {
      await queryClient.cancelQueries({ queryKey: ['item', id] });
      const previousItem = queryClient.getQueryData<WorkItem>(['item', id]);

      // Optimistically advance the state machine stepper & badge
      if (previousItem) {
        queryClient.setQueryData<WorkItem>(['item', id], {
          ...previousItem,
          status: to as any,
          version: previousItem.version + 1,
        });
      }

      return { previousItem };
    },
    onError: (err: ApiError, _variables, context) => {
      // Roll back to previous snapshot
      if (context?.previousItem) {
        queryClient.setQueryData(['item', id], context.previousItem);
      }

      if (err.status === 409) {
        if (err.current) {
          queryClient.setQueryData(['item', id], err.current);
        }
        setConflictBanner('This item was changed by someone else. Showing the latest version.');
        toastError('Conflict: This item was updated by someone else.');
      } else if (err.status === 403 || err.status === 422) {
        toastError(err.message);
      } else {
        toastError(err.message || 'Status transition failed');
      }
    },
    onSuccess: (updated) => {
      success(`Status updated to ${updated.status}`);
      setConflictBanner(null);
      transitionKeyRef.current = crypto.randomUUID();
      queryClient.setQueryData(['item', id], updated);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['item', id] });
      queryClient.invalidateQueries({ queryKey: ['activity', id] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  // -------------------------------------------------------------
  // Assignment Mutation (Lead / Admin only)
  // -------------------------------------------------------------
  const assignMutation = useMutation({
    mutationFn: async (assigneeId: string | null) => {
      return await apiFetch<WorkItem>(`/api/items/${id}/assign`, {
        method: 'POST',
        idempotencyKey: assignKeyRef.current,
        body: JSON.stringify({
          assigneeId,
          version: item!.version,
        }),
      });
    },
    onSuccess: (updated) => {
      success(updated.assignee_id ? `Assigned to ${updated.assignee_name}` : 'Item unassigned');
      setConflictBanner(null);
      assignKeyRef.current = crypto.randomUUID();
      queryClient.setQueryData(['item', id], updated);
    },
    onError: (err: ApiError) => {
      if (err.status === 409) {
        if (err.current) queryClient.setQueryData(['item', id], err.current);
        setConflictBanner('This item was changed by someone else. Showing the latest version.');
        toastError('Assignment conflict: Item was modified concurrently.');
      } else {
        toastError(err.message || 'Failed to update assignment');
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['item', id] });
      queryClient.invalidateQueries({ queryKey: ['activity', id] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });

  // -------------------------------------------------------------
  // STATE RECONCILIATION: Edit Mutation (Part D)
  // On 409 keeps draft visible and offers "Reload latest" button
  // -------------------------------------------------------------
  const editMutation = useMutation({
    mutationFn: async () => {
      return await apiFetch<WorkItem>(`/api/items/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          version: item!.version,
          title: editTitle.trim(),
          description: editDescription.trim(),
          priority: editPriority,
          dueDate: editDueDate ? new Date(editDueDate).toISOString() : null,
        }),
      });
    },
    onSuccess: (updated) => {
      success('Work item updated successfully');
      setIsEditing(false);
      setConflictBanner(null);
      queryClient.setQueryData(['item', id], updated);
    },
    onError: (err: ApiError) => {
      if (err.status === 409) {
        // Spec: On 409 keep the user's draft visible, show the banner with a "Reload latest" button
        setConflictBanner('This item was changed by someone else. Your draft is preserved below.');
        toastError('Version conflict: The item has been modified by someone else.');
        // Store the server's current state in cache so Reload Latest can access it
        if (err.current) {
          queryClient.setQueryData(['item', id], err.current);
        }
      } else {
        toastError(err.message || 'Failed to update item');
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['activity', id] });
      queryClient.invalidateQueries({ queryKey: ['items'] });
    },
  });

  // Replaces the user's draft values with the server version on conflict
  const handleReloadLatest = () => {
    const latest = queryClient.getQueryData<WorkItem>(['item', id]);
    if (latest) {
      setEditTitle(latest.title);
      setEditDescription(latest.description || '');
      setEditPriority(latest.priority);
      setEditDueDate(latest.due_date ? new Date(latest.due_date).toISOString().slice(0, 16) : '');
      setConflictBanner(null);
    }
  };

  // Add Comment Mutation
  const commentMutation = useMutation({
    mutationFn: async () => {
      return await apiFetch<CommentRecord>(`/api/items/${id}/comments`, {
        method: 'POST',
        idempotencyKey: commentIdempotencyKeyRef.current,
        body: JSON.stringify({ body: commentText.trim() }),
      });
    },
    onSuccess: () => {
      success('Comment added');
      setCommentText('');
      commentIdempotencyKeyRef.current = crypto.randomUUID();
      refetchComments();
      queryClient.invalidateQueries({ queryKey: ['activity', id] });
    },
    onError: (err: ApiError) => {
      toastError(err.message || 'Failed to post comment');
    },
  });

  if (isItemLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-slate-200 rounded w-1/3" />
        <div className="h-24 bg-white rounded-xl border border-slate-200 p-6" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 h-96 bg-white rounded-xl border border-slate-200" />
          <div className="h-96 bg-white rounded-xl border border-slate-200" />
        </div>
      </div>
    );
  }

  if (isItemError || !item) {
    return (
      <div className="max-w-xl mx-auto py-12">
        <ErrorState
          title="Could not load work item"
          message={(itemError as Error)?.message || 'Item not found or access denied.'}
          onRetry={() => refetchItem()}
        />
        <div className="mt-4 text-center">
          <button
            onClick={() => navigate('/items')}
            className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
          >
            ← Back to all items
          </button>
        </div>
      </div>
    );
  }

  const allowed = item.allowedActions || {
    edit: false,
    comment: false,
    claim: false,
    assign: false,
    transitions: [],
  };

  const isOverdue =
    item.due_date &&
    !['resolved', 'closed'].includes(item.status) &&
    new Date(item.due_date).getTime() < Date.now();

  const allActivity = activityData ? activityData.pages.flatMap((p) => p.events || []) : [];

  return (
    <div className="space-y-6">
      {/* Top Navigation & Back Link */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center text-xs font-semibold text-slate-500 hover:text-indigo-600 transition-colors"
        >
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back
        </button>
        <span className="text-xs text-slate-400 font-mono">v{item.version}</span>
      </div>

      {/* State Reconciliation Conflict Banner (Part D) */}
      {conflictBanner && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-amber-900 text-sm">
          <div className="flex items-center space-x-2.5">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
            <p className="font-medium">{conflictBanner}</p>
          </div>
          {isEditing && (
            <button
              onClick={handleReloadLatest}
              className="px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-lg transition-colors shrink-0"
            >
              Reload latest version
            </button>
          )}
        </div>
      )}

      {/* Horizontal Workflow Stepper */}
      <WorkflowStepper currentStatus={item.status} />

      {/* Action Bar Driven by allowedActions */}
      <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Claim Action */}
          {allowed.claim ? (
            <button
              onClick={() => claimMutation.mutate()}
              disabled={claimMutation.isPending}
              className="inline-flex items-center px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg shadow-xs transition-colors disabled:opacity-50"
            >
              <UserPlus className="w-4 h-4 mr-1.5" />
              {claimMutation.isPending ? 'Claiming...' : 'Claim Item'}
            </button>
          ) : (
            <div className="group relative inline-block">
              <button
                disabled
                className="inline-flex items-center px-3.5 py-1.5 text-xs font-medium text-slate-400 bg-slate-100 rounded-lg border border-slate-200 cursor-not-allowed opacity-60"
              >
                <UserPlus className="w-4 h-4 mr-1.5" />
                Claim Item
              </button>
              <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover:block w-48 p-2 bg-slate-900 text-white text-[11px] rounded-lg shadow-xl z-20 pointer-events-none">
                Item is already assigned or status is not open.
              </div>
            </div>
          )}

          {/* Assign Action (Lead / Admin only) */}
          {allowed.assign ? (
            <div className="flex items-center space-x-1.5">
              <span className="text-xs font-semibold text-slate-500">Assign:</span>
              <select
                value={item.assignee_id || ''}
                onChange={(e) => assignMutation.mutate(e.target.value || null)}
                disabled={assignMutation.isPending}
                aria-label="Assign to team member"
                className="px-2.5 py-1 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              >
                <option value="">Unassign</option>
                {teamMembers?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.role})
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* Edit Inline Form Toggle */}
          {allowed.edit && !isEditing && (
            <button
              onClick={startEditing}
              className="inline-flex items-center px-3 py-1.5 text-xs font-medium text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg transition-colors shadow-2xs"
            >
              <Edit3 className="w-3.5 h-3.5 mr-1.5 text-slate-500" />
              Edit Details
            </button>
          )}
        </div>

        {/* Workflow State Machine Transition Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Start Work (open -> in_progress) */}
          {allowed.transitions.includes('in_progress') && item.status === 'open' && (
            <button
              onClick={() => transitionMutation.mutate({ to: 'in_progress' })}
              disabled={transitionMutation.isPending}
              className="inline-flex items-center px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 mr-1.5" />
              Start Work
            </button>
          )}

          {/* Request Approval (in_progress -> awaiting_approval) */}
          {allowed.transitions.includes('awaiting_approval') && (
            <button
              onClick={() => transitionMutation.mutate({ to: 'awaiting_approval' })}
              disabled={transitionMutation.isPending}
              className="inline-flex items-center px-3.5 py-1.5 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-xs transition-colors disabled:opacity-50"
            >
              <FileCheck className="w-3.5 h-3.5 mr-1.5" />
              Request Approval
            </button>
          )}

          {/* Approve (awaiting_approval -> resolved) */}
          {allowed.transitions.includes('resolved') && (
            <button
              onClick={() => transitionMutation.mutate({ to: 'resolved' })}
              disabled={transitionMutation.isPending}
              className="inline-flex items-center px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-xs transition-colors disabled:opacity-50"
            >
              <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
              Approve
            </button>
          )}

          {/* Reject (awaiting_approval -> in_progress, requires reason) */}
          {item.status === 'awaiting_approval' && allowed.transitions.includes('in_progress') && (
            <button
              onClick={() => {
                setTargetStatusForReason('in_progress');
                setReasonTitle('Reject Work Item');
                setReasonText('');
                setReasonModalOpen(true);
              }}
              disabled={transitionMutation.isPending}
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5 mr-1.5" />
              Reject with Reason
            </button>
          )}

          {/* Close (resolved -> closed) */}
          {allowed.transitions.includes('closed') && (
            <button
              onClick={() => transitionMutation.mutate({ to: 'closed' })}
              disabled={transitionMutation.isPending}
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors disabled:opacity-50"
            >
              <CheckCircle className="w-3.5 h-3.5 mr-1.5" />
              Close Item
            </button>
          )}

          {/* Reopen (resolved -> in_progress, requires reason) */}
          {item.status === 'resolved' && allowed.transitions.includes('in_progress') && (
            <button
              onClick={() => {
                setTargetStatusForReason('in_progress');
                setReasonTitle('Reopen Work Item');
                setReasonText('');
                setReasonModalOpen(true);
              }}
              disabled={transitionMutation.isPending}
              className="inline-flex items-center px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-lg transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
              Reopen
            </button>
          )}
        </div>
      </div>

      {/* Two-Column Grid: Main Details & Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Main Card: Title & Description (or Edit Form) */}
          <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-xs space-y-4">
            {isEditing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  editMutation.mutate();
                }}
                className="space-y-4"
              >
                <div>
                  <label htmlFor="edit-title" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Title
                  </label>
                  <input
                    id="edit-title"
                    type="text"
                    required
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="edit-priority" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Priority
                    </label>
                    <select
                      id="edit-priority"
                      value={editPriority}
                      onChange={(e) => setEditPriority(e.target.value as ItemPriority)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>

                  <div>
                    <label htmlFor="edit-due-date" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                      Due Date
                    </label>
                    <input
                      id="edit-due-date"
                      type="datetime-local"
                      value={editDueDate}
                      onChange={(e) => setEditDueDate(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="edit-desc" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                    Description
                  </label>
                  <textarea
                    id="edit-desc"
                    rows={4}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 resize-y"
                  />
                </div>

                <div className="flex items-center justify-end space-x-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditing(false);
                      setConflictBanner(null);
                    }}
                    className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={editMutation.isPending}
                    className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs disabled:opacity-50"
                  >
                    {editMutation.isPending ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight leading-snug">
                  {item.title}
                </h1>
                <div className="mt-4 prose prose-slate text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
                  {item.description ? item.description : <span className="italic text-slate-400">No description provided.</span>}
                </div>
              </div>
            )}
          </div>

          {/* Activity & Comments Tabs */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
            <div className="flex border-b border-slate-200">
              <button
                onClick={() => setActiveTab('activity')}
                className={clsx(
                  'flex items-center px-6 py-3.5 text-xs font-semibold border-b-2 transition-all',
                  activeTab === 'activity'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                )}
              >
                <History className="w-4 h-4 mr-2" />
                Activity Timeline
              </button>
              <button
                onClick={() => setActiveTab('comments')}
                className={clsx(
                  'flex items-center px-6 py-3.5 text-xs font-semibold border-b-2 transition-all',
                  activeTab === 'comments'
                    ? 'border-indigo-600 text-indigo-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                )}
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                Comments
              </button>
            </div>

            <div className="p-6">
              {activeTab === 'activity' ? (
                /* Activity Timeline Tab */
                isActivityLoading ? (
                  <div className="space-y-4 animate-pulse">
                    <div className="h-4 bg-slate-200 rounded w-1/3" />
                    <div className="h-10 bg-slate-100 rounded" />
                    <div className="h-10 bg-slate-100 rounded" />
                  </div>
                ) : allActivity.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">No activity recorded yet.</p>
                ) : (
                  <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200">
                    {allActivity.map((event) => (
                      <div key={event.id} className="relative flex items-start space-x-3 text-xs">
                        <div className="absolute -left-6 mt-1 w-2.5 h-2.5 rounded-full bg-indigo-600 ring-4 ring-white" />
                        <div className="flex-1 bg-slate-50 p-3 rounded-lg border border-slate-100">
                          <div className="flex items-center justify-between font-semibold text-slate-900">
                            <span>{event.actor_name || 'System / Auto'}</span>
                            <span className="text-[10px] text-slate-400 font-normal">
                              {new Date(event.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="mt-1 text-slate-600">
                            <span className="font-semibold text-indigo-600 mr-1">{event.event_type}</span>
                            {event.event_type === 'STATUS_CHANGED' && (
                              <span>
                                Changed status from <span className="font-semibold">{event.payload.from}</span> to{' '}
                                <span className="font-semibold">{event.payload.to}</span>
                                {event.payload.reason && (
                                  <span className="block mt-1 italic text-slate-500">
                                    Reason: "{event.payload.reason}"
                                  </span>
                                )}
                              </span>
                            )}
                            {event.event_type === 'PRIORITY_CHANGED' && (
                              <span>
                                Changed priority from <span className="font-semibold">{event.payload.from}</span> to{' '}
                                <span className="font-semibold">{event.payload.to}</span>
                              </span>
                            )}
                            {event.event_type === 'TITLE_CHANGED' && (
                              <span>Updated title</span>
                            )}
                            {event.event_type === 'DESCRIPTION_CHANGED' && (
                              <span>Updated description</span>
                            )}
                            {event.event_type === 'ASSIGNED' && (
                              <span>Assigned item</span>
                            )}
                            {event.event_type === 'CLAIMED' && (
                              <span>Claimed work item</span>
                            )}
                            {event.event_type === 'CREATED' && (
                              <span>Item created</span>
                            )}
                          </p>
                        </div>
                      </div>
                    ))}

                    {hasNextActivity && (
                      <div className="pt-2">
                        <button
                          onClick={() => fetchNextActivity()}
                          disabled={isFetchingNextActivity}
                          className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50"
                        >
                          {isFetchingNextActivity ? 'Loading...' : 'Load older events'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              ) : (
                /* Comments Tab */
                <div className="space-y-6">
                  {/* Add Comment Form */}
                  {allowed.comment ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (commentText.trim()) commentMutation.mutate();
                      }}
                      className="space-y-3"
                    >
                      <textarea
                        rows={3}
                        required
                        placeholder="Add an update or internal operational comment..."
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                      />
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={commentMutation.isPending || !commentText.trim()}
                          className="inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs disabled:opacity-50"
                        >
                          <Send className="w-3.5 h-3.5 mr-1.5" />
                          {commentMutation.isPending ? 'Posting...' : 'Post Comment'}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <p className="text-xs text-slate-400 italic">
                      You do not have permission to comment on this item.
                    </p>
                  )}

                  {/* Comments Stream */}
                  <div className="divide-y divide-slate-100">
                    {!comments || comments.length === 0 ? (
                      <p className="py-4 text-xs text-slate-400 italic">No comments yet.</p>
                    ) : (
                      comments.map((comment) => (
                        <div key={comment.id} className="py-4 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-slate-900">{comment.author_name}</span>
                            <span className="text-[10px] text-slate-400">
                              {new Date(comment.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                            {comment.body}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Side Column: Details Card */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-xs space-y-4">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Item Details
            </h3>

            <div className="space-y-3.5 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Status</span>
                <StatusBadge status={item.status} />
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Priority</span>
                <PriorityBadge priority={item.priority} />
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Type</span>
                <TypeBadge type={item.type} />
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Team</span>
                <span className="font-semibold text-slate-800">{item.team_name || 'Team'}</span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Assignee</span>
                <div className="flex items-center space-x-1.5">
                  <Avatar name={item.assignee_name} size="sm" />
                  <span className="font-semibold text-slate-800">
                    {item.assignee_name || <span className="text-slate-400 italic">Unassigned</span>}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Due Date</span>
                <div>
                  {item.due_date ? (
                    <div className="text-right">
                      <span className={clsx('font-medium', isOverdue ? 'text-red-600 font-bold' : 'text-slate-700')}>
                        {new Date(item.due_date).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                      {isOverdue && <div className="mt-0.5"><OverdueBadge /></div>}
                    </div>
                  ) : (
                    <span className="text-slate-400">None</span>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Created By</span>
                <span className="text-slate-700">{item.created_by_name || 'User'}</span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-slate-100">
                <span className="text-slate-500">Created</span>
                <span className="text-slate-700">{new Date(item.created_at).toLocaleDateString()}</span>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-slate-500">Version</span>
                <span className="font-mono text-slate-700">v{item.version}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Rejection / Reopening Reason Dialog Modal */}
      <Modal
        isOpen={reasonModalOpen}
        onClose={() => setReasonModalOpen(false)}
        title={reasonTitle}
        description="A clear operational reason is required for this workflow transition."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reasonText.trim()) {
              setReasonModalOpen(false);
              transitionMutation.mutate({
                to: targetStatusForReason,
                reason: reasonText.trim(),
              });
            }
          }}
          className="space-y-4"
        >
          <div>
            <label htmlFor="reason-input" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Reason <span className="text-red-500">*</span>
            </label>
            <textarea
              id="reason-input"
              required
              rows={4}
              placeholder="Explain why this item is being rejected or reopened..."
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex justify-end space-x-3 pt-2">
            <button
              type="button"
              onClick={() => setReasonModalOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!reasonText.trim() || transitionMutation.isPending}
              className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg shadow-xs disabled:opacity-50"
            >
              Submit Transition
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
