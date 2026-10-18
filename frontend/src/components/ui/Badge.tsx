import clsx from 'clsx';
import { ItemStatus, ItemPriority, ItemType } from '../../types';

interface BadgeProps {
  className?: string;
}

export function StatusBadge({ status, className }: { status: ItemStatus } & BadgeProps) {
  const styles: Record<ItemStatus, { label: string; classes: string }> = {
    open: {
      label: 'Open',
      classes: 'bg-slate-100 text-slate-700 border-slate-300',
    },
    in_progress: {
      label: 'In Progress',
      classes: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    awaiting_approval: {
      label: 'Awaiting Approval',
      classes: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    resolved: {
      label: 'Resolved',
      classes: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    closed: {
      label: 'Closed',
      classes: 'bg-gray-100 text-gray-600 border-gray-200',
    },
  };

  const config = styles[status] || { label: status, classes: 'bg-slate-100 text-slate-700 border-slate-200' };

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border shadow-xs transition-colors',
        config.classes,
        className
      )}
    >
      {config.label}
    </span>
  );
}

export function PriorityBadge({ priority, className }: { priority: ItemPriority } & BadgeProps) {
  const styles: Record<ItemPriority, { label: string; classes: string }> = {
    urgent: {
      label: 'Urgent',
      classes: 'bg-red-50 text-red-700 border-red-200 font-semibold',
    },
    high: {
      label: 'High',
      classes: 'bg-orange-50 text-orange-700 border-orange-200',
    },
    medium: {
      label: 'Medium',
      classes: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    },
    low: {
      label: 'Low',
      classes: 'bg-slate-100 text-slate-600 border-slate-200',
    },
  };

  const config = styles[priority] || { label: priority, classes: 'bg-slate-100 text-slate-600 border-slate-200' };

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border shadow-xs',
        config.classes,
        className
      )}
    >
      {config.label}
    </span>
  );
}

export function TypeBadge({ type, className }: { type: ItemType } & BadgeProps) {
  const labels: Record<ItemType, string> = {
    incident: 'Incident',
    customer_issue: 'Customer Issue',
    payment: 'Payment',
    compliance: 'Compliance',
    task: 'Task',
  };

  return (
    <span
      className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200/80',
        className
      )}
    >
      {labels[type] || type}
    </span>
  );
}

export function OverdueBadge({ className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-red-100 text-red-800 border border-red-200',
        className
      )}
    >
      Overdue
    </span>
  );
}
