import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Search, RotateCcw } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../api/client';
import { WorkItem, PaginatedResponse } from '../types';
import { ItemTable } from '../components/items/ItemTable';
import { SkeletonTableRow } from '../components/ui/Skeleton';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';

export function AllItemsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  // Extract filter parameters from URL query string
  const qParam = searchParams.get('q') || '';
  const statusParam = searchParams.get('status') || '';
  const priorityParam = searchParams.get('priority') || '';
  const typeParam = searchParams.get('type') || '';
  const teamIdParam = searchParams.get('teamId') || '';
  const assigneeParam = searchParams.get('assignee') || '';

  // Local state for debounced search input
  const [searchInput, setSearchInput] = useState(qParam);

  // 300ms search input debounce updating searchParams
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (searchInput.trim()) {
          next.set('q', searchInput.trim());
        } else {
          next.delete('q');
        }
        return next;
      });
    }, 300);

    return () => clearTimeout(timer);
  }, [searchInput, setSearchParams]);

  // Keep searchInput in sync if URL changes externally
  useEffect(() => {
    setSearchInput(qParam);
  }, [qParam]);

  const updateFilter = (key: string, value: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) {
        next.set(key, value);
      } else {
        next.delete(key);
      }
      return next;
    });
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearchParams(new URLSearchParams());
  };

  // Build query string for API request
  const buildQueryString = (cursor?: string | null) => {
    const params = new URLSearchParams();
    if (qParam) params.set('q', qParam);
    if (statusParam) params.set('status', statusParam);
    if (priorityParam) params.set('priority', priorityParam);
    if (typeParam) params.set('type', typeParam);
    if (teamIdParam) params.set('teamId', teamIdParam);
    if (assigneeParam) params.set('assignee', assigneeParam);
    if (cursor) params.set('cursor', cursor);
    params.set('limit', '25');
    return params.toString();
  };

  // TanStack Infinite Query with server-side keyset pagination
  const {
    data,
    isLoading,
    isError,
    error,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery({
    queryKey: ['items', { qParam, statusParam, priorityParam, typeParam, teamIdParam, assigneeParam }],
    queryFn: async ({ pageParam }) => {
      const queryString = buildQueryString(pageParam as string | null);
      return await apiFetch<PaginatedResponse<WorkItem>>(`/api/items?${queryString}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage?.nextCursor || null,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const allItems = data ? data.pages.flatMap((page) => page.items || []) : [];
  const hasActiveFilters = Boolean(
    qParam || statusParam || priorityParam || typeParam || teamIdParam || assigneeParam
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">All Work Items</h2>
        <p className="mt-1 text-sm text-slate-500">
          Server-side filtered and keyset paginated view of items across your authorized teams.
        </p>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
          {/* Search with 300ms debounce */}
          <div className="sm:col-span-2 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Search title, description..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            />
          </div>

          {/* Status */}
          <div>
            <select
              value={statusParam}
              onChange={(e) => updateFilter('status', e.target.value)}
              aria-label="Filter by status"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            >
              <option value="">All Statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In Progress</option>
              <option value="awaiting_approval">Awaiting Approval</option>
              <option value="resolved">Resolved</option>
              <option value="closed">Closed</option>
            </select>
          </div>

          {/* Priority */}
          <div>
            <select
              value={priorityParam}
              onChange={(e) => updateFilter('priority', e.target.value)}
              aria-label="Filter by priority"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            >
              <option value="">All Priorities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          {/* Type */}
          <div>
            <select
              value={typeParam}
              onChange={(e) => updateFilter('type', e.target.value)}
              aria-label="Filter by type"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            >
              <option value="">All Types</option>
              <option value="incident">Incident</option>
              <option value="customer_issue">Customer Issue</option>
              <option value="payment">Payment</option>
              <option value="compliance">Compliance</option>
              <option value="task">Task</option>
            </select>
          </div>

          {/* Assignee */}
          <div>
            <select
              value={assigneeParam}
              onChange={(e) => updateFilter('assignee', e.target.value)}
              aria-label="Filter by assignee"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            >
              <option value="">Assignee: Anyone</option>
              <option value="me">Assigned to Me</option>
              <option value="unassigned">Unassigned</option>
            </select>
          </div>
        </div>

        {/* Second row: Team filter & Reset */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-semibold text-slate-500">Team:</span>
            <select
              value={teamIdParam}
              onChange={(e) => updateFilter('teamId', e.target.value)}
              aria-label="Filter by team"
              className="px-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-md focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All My Teams</option>
              {user?.memberships.map((m) => (
                <option key={m.teamId} value={m.teamId}>
                  {m.teamName} ({m.role})
                </option>
              ))}
            </select>
          </div>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="inline-flex items-center text-xs font-medium text-slate-600 hover:text-indigo-600 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Reset all filters
            </button>
          )}
        </div>
      </div>

      {/* Main Results Table */}
      {isLoading ? (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs overflow-hidden">
          <table className="min-w-full divide-y divide-slate-200 text-left">
            <tbody className="divide-y divide-slate-100">
              <SkeletonTableRow />
              <SkeletonTableRow />
              <SkeletonTableRow />
              <SkeletonTableRow />
              <SkeletonTableRow />
            </tbody>
          </table>
        </div>
      ) : isError ? (
        <ErrorState
          title="Failed to retrieve work items"
          message={(error as Error)?.message || 'An error occurred while loading work items.'}
          onRetry={() => refetch()}
        />
      ) : allItems.length === 0 ? (
        <EmptyState
          title="No work items match your criteria"
          message="Try adjusting your search keywords, clearing status filters, or selecting another team."
          action={
            hasActiveFilters ? (
              <button
                onClick={clearFilters}
                className="px-4 py-2 text-xs font-semibold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
              >
                Clear all filters
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4">
          <ItemTable items={allItems} />

          {/* Load More Button for Keyset Pagination */}
          {hasNextPage && (
            <div className="flex justify-center pt-2">
              <button
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="px-6 py-2.5 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl shadow-xs focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors disabled:opacity-50"
              >
                {isFetchingNextPage ? 'Loading more items...' : 'Load more items'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
