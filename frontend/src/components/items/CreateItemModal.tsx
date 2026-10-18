import React, { useState, useEffect, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { apiFetch, ApiError } from '../../api/client';
import { ItemType, ItemPriority, WorkItem } from '../../types';

interface CreateItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (item: WorkItem) => void;
}

export function CreateItemModal({ isOpen, onClose, onSuccess }: CreateItemModalProps) {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const queryClient = useQueryClient();

  // Eligible teams: caller must be member, lead, or admin (viewers cannot create items)
  const eligibleTeams = (user?.memberships || []).filter(
    (m) => m.role === 'member' || m.role === 'lead' || m.role === 'admin'
  );

  const [teamId, setTeamId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<ItemType>('incident');
  const [priority, setPriority] = useState<ItemPriority>('medium');
  const [dueDate, setDueDate] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Idempotency guarantee: Generate key once when modal opens; reuse for retries/double-clicks
  const idempotencyKeyRef = useRef<string>('');

  useEffect(() => {
    if (isOpen) {
      // Generate a new idempotency key for this session
      idempotencyKeyRef.current = crypto.randomUUID();
      setFieldErrors({});
      // Select first eligible team by default
      if (eligibleTeams.length > 0 && !teamId) {
        setTeamId(eligibleTeams[0].teamId);
      }
    }
  }, [isOpen, eligibleTeams, teamId]);

  const mutation = useMutation({
    mutationFn: async () => {
      return await apiFetch<WorkItem>('/api/items', {
        method: 'POST',
        idempotencyKey: idempotencyKeyRef.current,
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          type,
          priority,
          teamId,
          dueDate: dueDate ? new Date(dueDate).toISOString() : null,
        }),
      });
    },
    onSuccess: (newItem) => {
      success(`Work item created: "${newItem.title}"`);
      queryClient.invalidateQueries({ queryKey: ['items'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });

      // Reset form and generate fresh key for future opens
      setTitle('');
      setDescription('');
      setDueDate('');
      setFieldErrors({});
      idempotencyKeyRef.current = crypto.randomUUID();

      onClose();
      if (onSuccess) {
        onSuccess(newItem);
      }
    },
    onError: (err: ApiError) => {
      toastError(err.message || 'Failed to create work item');
      setFieldErrors({ submit: err.message });
      // Crucial: idempotencyKeyRef.current is preserved so user retry reuses the key
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};

    if (!teamId) {
      errors.teamId = 'Please select a team';
    }
    if (!title.trim()) {
      errors.title = 'Title is required';
    } else if (title.trim().length < 3 || title.trim().length > 200) {
      errors.title = 'Title must be between 3 and 200 characters';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    mutation.mutate();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Create New Work Item"
      description="Create, assign, and track an operational item with full concurrency safeguards."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {fieldErrors.submit && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800">
            {fieldErrors.submit}
          </div>
        )}

        {/* Team Selection */}
        <div>
          <label htmlFor="item-team" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
            Team <span className="text-red-500">*</span>
          </label>
          <select
            id="item-team"
            value={teamId}
            onChange={(e) => setTeamId(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
          >
            {eligibleTeams.map((t) => (
              <option key={t.teamId} value={t.teamId}>
                {t.teamName} ({t.role})
              </option>
            ))}
          </select>
          {fieldErrors.teamId && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.teamId}</p>
          )}
        </div>

        {/* Title */}
        <div>
          <label htmlFor="item-title" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
            Title <span className="text-red-500">*</span>
          </label>
          <input
            id="item-title"
            type="text"
            required
            placeholder="e.g. Stripe webhook delivery failure in cluster-b"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
          />
          {fieldErrors.title && (
            <p className="mt-1 text-xs text-red-600">{fieldErrors.title}</p>
          )}
        </div>

        {/* Type & Priority Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="item-type" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Type
            </label>
            <select
              id="item-type"
              value={type}
              onChange={(e) => setType(e.target.value as ItemType)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            >
              <option value="incident">Incident</option>
              <option value="customer_issue">Customer Issue</option>
              <option value="payment">Payment</option>
              <option value="compliance">Compliance</option>
              <option value="task">Task</option>
            </select>
          </div>

          <div>
            <label htmlFor="item-priority" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
              Priority
            </label>
            <select
              id="item-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as ItemPriority)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
        </div>

        {/* Due Date */}
        <div>
          <label htmlFor="item-due-date" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
            Due Date (Optional)
          </label>
          <input
            id="item-due-date"
            type="datetime-local"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="item-desc" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
            Description
          </label>
          <textarea
            id="item-desc"
            rows={3}
            placeholder="Add operational details, error logs, or acceptance criteria..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors resize-y"
          />
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-end space-x-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={mutation.isPending}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 shadow-xs transition-colors disabled:opacity-50 flex items-center"
          >
            {mutation.isPending ? 'Creating...' : 'Create Item'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
