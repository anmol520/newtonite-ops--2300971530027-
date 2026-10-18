import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ItemDetailPage } from '../pages/ItemDetailPage';
import { ToastProvider } from '../context/ToastContext';
import * as clientModule from '../api/client';
import { WorkItem } from '../types';

// Mock AuthContext
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'current-user-id',
      name: 'Alice Tester',
      email: 'alice@demo.dev',
      memberships: [{ teamId: 'team-1', teamName: 'Payments Ops', role: 'member' }],
    },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

describe('Part F: Optimistic Rollback and Conflict Handling', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  it('A claim mutation that receives a 409 rolls back optimistic state and shows conflict message', async () => {
    const initialItem: WorkItem = {
      id: 'item-123',
      title: 'High priority payments glitch',
      description: 'Webhook dropping events',
      type: 'incident',
      priority: 'high',
      status: 'open',
      team_id: 'team-1',
      team_name: 'Payments Ops',
      assignee_id: null,
      assignee_name: null,
      created_by: 'creator-id',
      created_by_name: 'Creator',
      due_date: null,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      allowedActions: {
        claim: true,
        edit: false,
        assign: false,
        comment: true,
        transitions: [],
      },
    };

    const conflictWinnerItem: WorkItem = {
      ...initialItem,
      status: 'in_progress',
      assignee_id: 'user-priya',
      assignee_name: 'Priya Engineer',
      version: 2,
      allowedActions: {
        claim: false,
        edit: false,
        assign: false,
        comment: true,
        transitions: ['awaiting_approval'],
      },
    };

    let currentServerItem = initialItem;

    // Spy on apiFetch
    const apiFetchSpy = vi.spyOn(clientModule, 'apiFetch');

    apiFetchSpy.mockImplementation(async (endpoint: string, _options?: any) => {
      if (endpoint.includes('/activity')) {
        return { events: [], nextCursor: null };
      }
      if (endpoint.includes('/comments')) {
        return [];
      }
      if (endpoint.includes('/claim')) {
        // Simulate concurrent conflict: another member won the race
        currentServerItem = conflictWinnerItem;
        throw new clientModule.ApiError(
          409,
          'ALREADY_CLAIMED',
          'Priya already claimed this item',
          conflictWinnerItem
        );
      }
      if (endpoint.includes('/items/item-123')) {
        return currentServerItem;
      }
      return null;
    });

    render(
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <MemoryRouter initialEntries={['/items/item-123']}>
            <Routes>
              <Route path="/items/:id" element={<ItemDetailPage />} />
            </Routes>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );

    // 1. Initial State: item is open and unassigned
    const titleElement = await screen.findByText('High priority payments glitch');
    expect(titleElement).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();

    const claimButton = screen.getByRole('button', { name: /claim item/i });
    expect(claimButton).toBeTruthy();
    expect((claimButton as HTMLButtonElement).disabled).toBe(false);

    // 2. Click claim: triggers mutation
    fireEvent.click(claimButton);

    // 3. Mutation rejects with 409: rollback occurs, error.current is loaded, and conflict message is displayed
    await waitFor(() => {
      expect(
        screen.getByText('This item was changed by someone else. Showing the latest version.')
      ).toBeTruthy();
    });

    // 4. Verify state reconciliation: assignee is now Priya Engineer (from error.current)
    expect(screen.getByText('Priya Engineer')).toBeTruthy();
  });
});
