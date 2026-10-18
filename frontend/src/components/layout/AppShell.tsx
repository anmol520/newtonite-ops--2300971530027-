import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Layers,
  Plus,
  Bell,
  LogOut,
  Menu,
  X,
  CheckCheck,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '../../context/AuthContext';
import { Avatar } from '../ui/Avatar';
import { CreateItemModal } from '../items/CreateItemModal';
import { apiFetch } from '../../api/client';
import { NotificationRecord } from '../../types';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);

  const notifRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  // Close popovers on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setIsNotifOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close mobile drawer on route change
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // Notifications query (polls every 20 seconds as per Part E)
  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      return await apiFetch<{
        notifications: NotificationRecord[];
        unreadCount: number;
      }>('/api/notifications');
    },
    refetchInterval: 20000,
    refetchOnWindowFocus: true,
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      return await apiFetch<{ success: boolean }>('/api/notifications/read-all', {
        method: 'POST',
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const unreadCount = notifData?.unreadCount || 0;
  const notifications = notifData?.notifications || [];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* Sidebar for Desktop */}
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-slate-200/80 shadow-xs shrink-0">
        <div className="h-16 flex items-center px-6 border-b border-slate-100">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white font-bold text-base shadow-xs">
              OP
            </div>
            <div className="leading-tight">
              <h1 className="text-sm font-bold text-slate-900 tracking-tight">Ops Under Pressure</h1>
              <p className="text-[10px] text-slate-400 font-medium tracking-wide uppercase">Newtonite Core</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1.5">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              clsx(
                'flex items-center px-3.5 py-2.5 text-sm font-medium rounded-xl transition-all',
                isActive
                  ? 'bg-indigo-50 text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
              )
            }
          >
            <LayoutDashboard className="w-4 h-4 mr-3 shrink-0" />
            Dashboard
          </NavLink>

          <NavLink
            to="/items"
            className={({ isActive }) =>
              clsx(
                'flex items-center px-3.5 py-2.5 text-sm font-medium rounded-xl transition-all',
                isActive
                  ? 'bg-indigo-50 text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
              )
            }
          >
            <Layers className="w-4 h-4 mr-3 shrink-0" />
            All items
          </NavLink>
        </nav>

        {/* User mini profile in sidebar footer */}
        <div className="p-4 border-t border-slate-100">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/60">
            <div className="flex items-center space-x-3">
              <Avatar name={user?.name} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-slate-900 truncate">{user?.name}</p>
                <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1">
              {user?.memberships.map((m) => (
                <span
                  key={m.teamId}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-white text-slate-600 border border-slate-200 shadow-2xs"
                >
                  {m.teamName.split(' ')[0]}: <span className="text-indigo-600 ml-0.5 font-semibold">{m.role}</span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Container */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Bar */}
        <header className="h-16 bg-white border-b border-slate-200/80 flex items-center justify-between px-4 sm:px-6 sticky top-0 z-30 shadow-2xs">
          <div className="flex items-center md:hidden">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100"
              aria-label="Toggle navigation menu"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <span className="ml-2.5 font-bold text-sm text-slate-900">Ops Under Pressure</span>
          </div>

          <div className="hidden md:block">
            {/* Breadcrumb or view indicator */}
          </div>

          <div className="flex items-center space-x-3 ml-auto">
            {/* "New item" Button */}
            <button
              onClick={() => setIsCreateOpen(true)}
              className="inline-flex items-center px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg shadow-xs focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              New item
            </button>

            {/* Notification Bell with Popover */}
            <div className="relative" ref={notifRef}>
              <button
                onClick={() => setIsNotifOpen(!isNotifOpen)}
                className="relative p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                aria-label="Notifications"
              >
                <Bell className="w-5 h-5" />
                {unreadCount > 0 && (
                  <span className="absolute top-1 right-1 flex items-center justify-center min-w-4 h-4 px-1 text-[10px] font-bold text-white bg-red-600 rounded-full border border-white shadow-xs">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Notification Popover */}
              {isNotifOpen && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-xl border border-slate-200/80 shadow-2xl z-50 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-b border-slate-100">
                    <span className="text-xs font-semibold text-slate-900">
                      Notifications ({unreadCount} unread)
                    </span>
                    {unreadCount > 0 && (
                      <button
                        onClick={() => markAllReadMutation.mutate()}
                        disabled={markAllReadMutation.isPending}
                        className="inline-flex items-center text-xs font-medium text-indigo-600 hover:text-indigo-800 transition-colors"
                      >
                        <CheckCheck className="w-3.5 h-3.5 mr-1" />
                        Mark all read
                      </button>
                    )}
                  </div>

                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-400">
                        No notifications yet
                      </div>
                    ) : (
                      notifications.map((n) => (
                        <div
                          key={n.id}
                          onClick={() => {
                            setIsNotifOpen(false);
                            navigate(`/items/${n.item_id}`);
                          }}
                          className={clsx(
                            'p-3.5 text-xs cursor-pointer hover:bg-indigo-50/40 transition-colors',
                            !n.read_at ? 'bg-indigo-50/20 font-medium text-slate-900' : 'text-slate-600'
                          )}
                        >
                          <p className="line-clamp-2">{n.message}</p>
                          <span className="mt-1 block text-[10px] text-slate-400">
                            {new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* User Menu */}
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className="flex items-center space-x-2 p-1.5 rounded-lg hover:bg-slate-100 transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
              >
                <Avatar name={user?.name} size="sm" />
                <span className="hidden sm:inline text-xs font-semibold text-slate-700">
                  {user?.name?.split(' ')[0]}
                </span>
              </button>

              {isUserMenuOpen && (
                <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl border border-slate-200/80 shadow-2xl p-4 z-50 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{user?.name}</p>
                    <p className="text-xs text-slate-500">{user?.email}</p>
                  </div>

                  <div className="pt-2 border-t border-slate-100">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                      Team Roles
                    </p>
                    <div className="space-y-1">
                      {user?.memberships.map((m) => (
                        <div key={m.teamId} className="flex items-center justify-between text-xs py-0.5">
                          <span className="text-slate-600 truncate">{m.teamName}</span>
                          <span className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 uppercase">
                            {m.role}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-100">
                    <button
                      onClick={logout}
                      className="w-full flex items-center justify-center px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5 mr-1.5" />
                      Sign out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Mobile Navigation Drawer */}
        {isMobileMenuOpen && (
          <div className="md:hidden bg-white border-b border-slate-200 px-4 py-3 space-y-2">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                clsx(
                  'flex items-center px-3 py-2 text-sm font-medium rounded-lg',
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                )
              }
            >
              <LayoutDashboard className="w-4 h-4 mr-3" />
              Dashboard
            </NavLink>
            <NavLink
              to="/items"
              className={({ isActive }) =>
                clsx(
                  'flex items-center px-3 py-2 text-sm font-medium rounded-lg',
                  isActive ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'
                )
              }
            >
              <Layers className="w-4 h-4 mr-3" />
              All items
            </NavLink>
          </div>
        )}

        {/* Main Body */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>

      {/* Global Create Item Modal */}
      <CreateItemModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={(item) => navigate(`/items/${item.id}`)}
      />
    </div>
  );
}
