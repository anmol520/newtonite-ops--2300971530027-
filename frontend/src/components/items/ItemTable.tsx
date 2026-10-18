import { useNavigate } from 'react-router-dom';
import { WorkItem } from '../../types';
import { StatusBadge, PriorityBadge, TypeBadge, OverdueBadge } from '../ui/Badge';
import { Avatar } from '../ui/Avatar';
import { Calendar, Clock } from 'lucide-react';

interface ItemTableProps {
  items: WorkItem[];
}

export function ItemTable({ items }: ItemTableProps) {
  const navigate = useNavigate();

  const isOverdue = (dueDate: string | null, status: string) => {
    if (!dueDate) return false;
    if (status === 'resolved' || status === 'closed') return false;
    return new Date(dueDate).getTime() < Date.now();
  };

  const formatDate = (isoString?: string | null) => {
    if (!isoString) return '-';
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  };

  const formatRelativeTime = (isoString: string) => {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div>
      {/* Desktop & Tablet Table (md and up) */}
      <div className="hidden md:block overflow-hidden bg-white rounded-xl border border-slate-200/80 shadow-xs">
        <table className="min-w-full divide-y divide-slate-200/80 text-left">
          <thead className="bg-slate-50/75 text-xs font-semibold text-slate-500 uppercase tracking-wider">
            <tr>
              <th scope="col" className="py-3 px-4">Title</th>
              <th scope="col" className="py-3 px-4">Type</th>
              <th scope="col" className="py-3 px-4">Priority</th>
              <th scope="col" className="py-3 px-4">Status</th>
              <th scope="col" className="py-3 px-4">Team</th>
              <th scope="col" className="py-3 px-4">Assignee</th>
              <th scope="col" className="py-3 px-4">Due</th>
              <th scope="col" className="py-3 px-4">Updated</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-sm">
            {items.map((item) => {
              const overdue = isOverdue(item.due_date, item.status);
              return (
                <tr
                  key={item.id}
                  onClick={() => navigate(`/items/${item.id}`)}
                  className="hover:bg-indigo-50/40 cursor-pointer transition-colors group"
                >
                  <td className="py-3.5 px-4 font-medium text-slate-900 group-hover:text-indigo-600 transition-colors max-w-xs truncate">
                    {item.title}
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <TypeBadge type={item.type} />
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <PriorityBadge priority={item.priority} />
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <StatusBadge status={item.status} />
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap text-xs text-slate-600">
                    {item.team_name || 'Team'}
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <div className="flex items-center space-x-2">
                      <Avatar name={item.assignee_name} size="sm" />
                      <span className="text-xs text-slate-700">
                        {item.assignee_name || <span className="text-slate-400 italic">Unassigned</span>}
                      </span>
                    </div>
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap text-xs">
                    {item.due_date ? (
                      <span className={overdue ? 'text-red-600 font-semibold flex items-center space-x-1' : 'text-slate-600 flex items-center space-x-1'}>
                        <span>{formatDate(item.due_date)}</span>
                        {overdue && <OverdueBadge />}
                      </span>
                    ) : (
                      <span className="text-slate-400">-</span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap text-xs text-slate-500">
                    {formatRelativeTime(item.updated_at)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile Stacked Cards (below md) */}
      <div className="md:hidden space-y-3">
        {items.map((item) => {
          const overdue = isOverdue(item.due_date, item.status);
          return (
            <div
              key={item.id}
              onClick={() => navigate(`/items/${item.id}`)}
              className="bg-white p-4 rounded-xl border border-slate-200/80 shadow-xs active:bg-slate-50 cursor-pointer space-y-3"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-semibold text-slate-900 leading-snug">
                  {item.title}
                </span>
                <PriorityBadge priority={item.priority} className="shrink-0" />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={item.status} />
                <TypeBadge type={item.type} />
                <span className="text-xs text-slate-500 font-medium px-2 py-0.5 bg-slate-100 rounded-md">
                  {item.team_name}
                </span>
                {overdue && <OverdueBadge />}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-500">
                <div className="flex items-center space-x-1.5">
                  <Avatar name={item.assignee_name} size="sm" />
                  <span>{item.assignee_name || 'Unassigned'}</span>
                </div>
                <div className="flex items-center space-x-3">
                  {item.due_date && (
                    <span className={`flex items-center space-x-1 ${overdue ? 'text-red-600 font-medium' : ''}`}>
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{formatDate(item.due_date)}</span>
                    </span>
                  )}
                  <span className="flex items-center space-x-1 text-slate-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatRelativeTime(item.updated_at)}</span>
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
