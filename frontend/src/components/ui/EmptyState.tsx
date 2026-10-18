import React from 'react';
import { Inbox } from 'lucide-react';
import clsx from 'clsx';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title?: string;
  message: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon = <Inbox className="w-10 h-10 text-slate-400" />,
  title = 'No items found',
  message,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center p-12 text-center bg-white rounded-xl border border-slate-200/80 shadow-xs',
        className
      )}
    >
      <div className="flex items-center justify-center w-16 h-16 mb-4 rounded-full bg-slate-50 border border-slate-100">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-800">{title}</h3>
      <p className="max-w-sm mt-1 text-sm text-slate-500">{message}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
