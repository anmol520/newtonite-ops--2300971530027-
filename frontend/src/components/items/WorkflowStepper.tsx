import { CheckCircle2, Circle, Clock } from 'lucide-react';
import clsx from 'clsx';
import { ItemStatus } from '../../types';

interface WorkflowStepperProps {
  currentStatus: ItemStatus;
}

const STEPS: { status: ItemStatus; label: string }[] = [
  { status: 'open', label: 'Open' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'awaiting_approval', label: 'Awaiting approval' },
  { status: 'resolved', label: 'Resolved' },
  { status: 'closed', label: 'Closed' },
];

export function WorkflowStepper({ currentStatus }: WorkflowStepperProps) {
  const currentIndex = STEPS.findIndex((s) => s.status === currentStatus);

  return (
    <div className="bg-white p-4 sm:p-5 rounded-xl border border-slate-200/80 shadow-xs overflow-x-auto">
      <div className="flex items-center justify-between min-w-[500px]">
        {STEPS.map((step, idx) => {
          const isCurrent = step.status === currentStatus;
          const isCompleted = currentIndex > idx;
          const isPending = currentIndex < idx;

          return (
            <div key={step.status} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center space-x-2.5">
                <div
                  className={clsx(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 transition-colors',
                    isCurrent && 'bg-indigo-600 text-white ring-4 ring-indigo-50 shadow-xs',
                    isCompleted && 'bg-emerald-600 text-white',
                    isPending && 'bg-slate-100 text-slate-400 border border-slate-200'
                  )}
                >
                  {isCompleted ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : isCurrent ? (
                    <Clock className="w-4 h-4 animate-pulse" />
                  ) : (
                    <Circle className="w-3.5 h-3.5" />
                  )}
                </div>
                <span
                  className={clsx(
                    'text-xs font-medium whitespace-nowrap',
                    isCurrent ? 'text-indigo-900 font-bold' : isCompleted ? 'text-slate-800' : 'text-slate-400'
                  )}
                >
                  {step.label}
                </span>
              </div>

              {idx < STEPS.length - 1 && (
                <div
                  className={clsx(
                    'flex-1 h-0.5 mx-3 rounded',
                    idx < currentIndex ? 'bg-emerald-500' : 'bg-slate-200'
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
