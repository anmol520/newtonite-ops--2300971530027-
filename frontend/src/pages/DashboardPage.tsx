import { useState } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { UserCheck, AlertTriangle, ClockAlert, ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../api/client';
import { DashboardCounts, WorkItem, PaginatedResponse } from '../types';
import { SkeletonCard } from '../components/ui/Skeleton';
import { ItemTable } from '../components/items/ItemTable';
import { EmptyState } from '../components/ui/EmptyState';
import { ErrorState } from '../components/ui/ErrorState';

type DashboardView = 'assigned_to_me' | 'unassigned_urgent' | 'awaiting_my_approval';

export function DashboardPage() {
  const { user } = useAuth();
  const [selectedView, setSelectedView] = useState<DashboardView>('assigned_to_me');

  // Query live dashboard counts every 15 seconds as per spec
  const {
    data: counts,
    isLoading: isCountsLoading,
    isError: isCountsError,
    refetch: refetchCounts,
  } = useQuery({
    queryKey: ['dashboard'],
    queryFn: async () => {
      return await apiFetch<DashboardCounts>('/api/dashboard');
    },
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  // Query paginated items for the selected view
  const {
    data: itemsData,
    isLoading: isItemsLoading,
    isError: isItemsError,
    error: itemsError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    refetch: refetchItems,
  } = useInfiniteQuery({
    queryKey: ['items', { view: selectedView }],
    queryFn: async ({ pageParam }) => {
      const cursorParam = pageParam ? `&cursor=${encodeURIComponent(pageParam as string)}` : '';
      return await apiFetch<PaginatedResponse<WorkItem>>(
        `/api/items?view=${selectedView}&limit=25${cursorParam}`
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor || null,
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
  });

  const assignedToMeCount = counts?.assignedToMe ?? counts?.assigned_to_me ?? 0;
  const unassignedUrgentCount = counts?.unassignedUrgent ?? counts?.unassigned_urgent ?? 0;
  const awaitingMyApprovalCount = counts?.awaitingMyApproval ?? counts?.awaiting_my_approval ?? 0;

  const allItems = itemsData ? itemsData.pages.flatMap((page) => page.items || []) : [];

  const cards = [
    {
      id: 'assigned_to_me' as DashboardView,
      title: 'Assigned to me',
      count: assignedToMeCount,
      icon: <UserCheck className="w-5 h-5 text-indigo-600" />,
      description: 'Active items requiring your direct execution',
      activeBorder: 'border-indigo-500 ring-2 ring-indigo-500/20',
      badgeColor: 'bg-indigo-50 text-indigo-700',
    },
    {
      id: 'unassigned_urgent' as DashboardView,
      title: 'Unassigned urgent',
      count: unassignedUrgentCount,
      icon: <AlertTriangle className="w-5 h-5 text-red-600" />,
      description: 'Critical items ready for claiming',
      activeBorder: 'border-red-500 ring-2 ring-red-500/20',
      badgeColor: 'bg-red-50 text-red-700',
    },
    {
      id: 'awaiting_my_approval' as DashboardView,
      title: 'Awaiting my approval',
      count: awaitingMyApprovalCount,
      icon: <ClockAlert className="w-5 h-5 text-amber-600" />,
      description: 'Items awaiting lead/admin review',
      activeBorder: 'border-amber-500 ring-2 ring-amber-500/20',
      badgeColor: 'bg-amber-50 text-amber-700',
    },
  ];

  return (
    <div className="space-y-8">
      {/* Greeting Header */}
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">
          Welcome back, {user?.name || 'Operator'}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Monitor your operational workload and high-priority bottlenecks across your teams.
        </p>
      </div>

      {/* Attention Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        {isCountsLoading ? (
          <>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </>
        ) : isCountsError ? (
          <div className="col-span-3">
            <ErrorState
              title="Failed to load dashboard metrics"
              message="Could not retrieve queue metrics from the server."
              onRetry={() => refetchCounts()}
            />
          </div>
        ) : (
          cards.map((card) => {
            const isSelected = selectedView === card.id;
            return (
              <div
                key={card.id}
                onClick={() => setSelectedView(card.id)}
                className={clsx(
                  'p-6 bg-white rounded-xl border shadow-xs cursor-pointer transition-all duration-200 group flex flex-col justify-between',
                  isSelected
                    ? `${card.activeBorder} shadow-md`
                    : 'border-slate-200/80 hover:border-slate-300 hover:shadow-sm'
                )}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                      {card.title}
                    </span>
                    <div className="p-2 rounded-lg bg-slate-50 border border-slate-100">
                      {card.icon}
                    </div>
                  </div>
                  <div className="mt-3 flex items-baseline space-x-2">
                    <span className="text-3xl font-extrabold text-slate-900 tracking-tight">
                      {card.count}
                    </span>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">{card.description}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-medium">
                  <span className={clsx(isSelected ? 'text-indigo-600 font-semibold' : 'text-slate-400 group-hover:text-slate-600')}>
                    {isSelected ? 'Viewing items' : 'Filter by this view'}
                  </span>
                  <ArrowRight className={clsx('w-3.5 h-3.5 transition-transform', isSelected ? 'text-indigo-600 translate-x-1' : 'text-slate-300 group-hover:translate-x-0.5')} />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Selected View Work Items List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900 tracking-tight">
            {cards.find((c) => c.id === selectedView)?.title}
          </h3>
          <span className="text-xs text-slate-500">
            Auto-refreshes every 15s
          </span>
        </div>

        {isItemsLoading ? (
          <div className="bg-white rounded-xl border border-slate-200/80 p-6 space-y-4">
            <div className="animate-pulse space-y-3">
              <div className="h-6 bg-slate-200 rounded w-1/4" />
              <div className="h-10 bg-slate-100 rounded" />
              <div className="h-10 bg-slate-100 rounded" />
              <div className="h-10 bg-slate-100 rounded" />
            </div>
          </div>
        ) : isItemsError ? (
          <ErrorState
            title="Unable to load items for this view"
            message={(itemsError as Error)?.message || 'Failed to fetch items'}
            onRetry={() => refetchItems()}
          />
        ) : allItems.length === 0 ? (
          <EmptyState
            title="No items in this queue"
            message="There are currently no items matching this criteria in your authorized teams."
          />
        ) : (
          <div className="space-y-4">
            <ItemTable items={allItems} />

            {/* Load More Button (Keyset Infinite Scroll) */}
            {hasNextPage && (
              <div className="flex justify-center pt-2">
                <button
                  onClick={() => fetchNextPage()}
                  disabled={isFetchingNextPage}
                  className="px-5 py-2.5 text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl shadow-xs focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors disabled:opacity-50"
                >
                  {isFetchingNextPage ? 'Loading more items...' : 'Load more items'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
