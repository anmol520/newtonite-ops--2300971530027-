import clsx from 'clsx';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        'animate-pulse bg-slate-200/80 rounded-md',
        className
      )}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200/80 shadow-xs space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-8 rounded-full" />
      </div>
      <Skeleton className="h-8 w-16" />
      <Skeleton className="h-3 w-40" />
    </div>
  );
}

export function SkeletonTableRow() {
  return (
    <tr className="border-b border-slate-100">
      <td className="py-4 px-4"><Skeleton className="h-5 w-48" /></td>
      <td className="py-4 px-4"><Skeleton className="h-5 w-20" /></td>
      <td className="py-4 px-4"><Skeleton className="h-5 w-16" /></td>
      <td className="py-4 px-4"><Skeleton className="h-5 w-24" /></td>
      <td className="py-4 px-4"><Skeleton className="h-5 w-28" /></td>
      <td className="py-4 px-4"><Skeleton className="h-6 w-6 rounded-full" /></td>
      <td className="py-4 px-4"><Skeleton className="h-5 w-20" /></td>
      <td className="py-4 px-4"><Skeleton className="h-5 w-16" /></td>
    </tr>
  );
}
