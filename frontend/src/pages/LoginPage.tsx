import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ShieldCheck, ArrowRight, Lock, Mail } from 'lucide-react';
import { apiFetch, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
  };
}

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const { success } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const demoAccounts = [
    { email: 'admin@demo.dev', role: 'Admin (All 4 Teams)', name: 'Alice Admin' },
    { email: 'lead.payments@demo.dev', role: 'Lead (Payments Ops)', name: 'Liam Payments' },
    { email: 'lead.support@demo.dev', role: 'Lead (Customer Support)', name: 'Sophia Support' },
    { email: 'lead.platform@demo.dev', role: 'Lead (Platform Engineering)', name: 'Lucas Platform' },
    { email: 'lead.compliance@demo.dev', role: 'Lead (Compliance)', name: 'Clara Compliance' },
    { email: 'member.payments@demo.dev', role: 'Member (Payments Ops)', name: 'Mason Payments' },
    { email: 'member.support@demo.dev', role: 'Member (Customer Support)', name: 'Mia Support' },
    { email: 'viewer@demo.dev', role: 'Viewer (Payments & Support)', name: 'Victor Viewer' },
    { email: 'multi@demo.dev', role: 'Multi-Role (Lead/Member/Viewer)', name: 'Morgan Multi' },
  ];

  const loginMutation = useMutation({
    mutationFn: async ({ emailVal, passwordVal }: { emailVal: string; passwordVal: string }) => {
      return await apiFetch<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: emailVal, password: passwordVal }),
      });
    },
    onSuccess: (data) => {
      login(data.token);
      success(`Signed in as ${data.user.name}`);
      navigate('/');
    },
    onError: (err: ApiError) => {
      setErrorMessage(err.message || 'Invalid email or password');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    loginMutation.mutate({ emailVal: email, passwordVal: password });
  };

  const handleUseDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('Demo@12345');
    setErrorMessage('');
    loginMutation.mutate({ emailVal: demoEmail, passwordVal: 'Demo@12345' });
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-slate-50">
      {/* Brand Panel */}
      <div className="lg:w-1/2 bg-slate-900 text-white p-8 lg:p-16 flex flex-col justify-between relative overflow-hidden">
        <div className="absolute inset-0 bg-radial from-indigo-900/40 via-transparent to-transparent pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center space-x-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-lg shadow-lg">
              OP
            </div>
            <span className="text-xl font-bold tracking-tight">Operations Under Pressure</span>
          </div>

          <div className="max-w-lg space-y-4">
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight text-white">
              Operational work orchestration under pressure.
            </h2>
            <p className="text-slate-400 text-base leading-relaxed">
              An enterprise operations system built with strict concurrency correctness,
              server-side role authorization, append-only history, and outbox reliability.
            </p>
          </div>
        </div>

        <div className="relative z-10 mt-12 pt-8 border-t border-slate-800 grid grid-cols-2 gap-4 text-xs">
          <div className="flex items-start space-x-2">
            <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <span className="text-slate-300">Atomic Optimistic Locking & Race Protection</span>
          </div>
          <div className="flex items-start space-x-2">
            <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <span className="text-slate-300">Append-Only Immutable Activity Ledger</span>
          </div>
          <div className="flex items-start space-x-2">
            <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <span className="text-slate-300">Transactional Idempotency Protection</span>
          </div>
          <div className="flex items-start space-x-2">
            <ShieldCheck className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
            <span className="text-slate-300">Transactional Outbox Worker & Backoff</span>
          </div>
        </div>
      </div>

      {/* Form & Demo Accounts Panel */}
      <div className="lg:w-1/2 p-6 sm:p-12 lg:p-16 flex flex-col justify-center max-w-xl mx-auto w-full">
        <div className="bg-white p-8 rounded-2xl border border-slate-200/80 shadow-xl space-y-6">
          <div>
            <h3 className="text-2xl font-bold text-slate-900 tracking-tight">Sign in to your account</h3>
            <p className="mt-1 text-sm text-slate-500">
              Enter your demo credentials or pick an account below.
            </p>
          </div>

          {errorMessage && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs font-medium text-red-800">
              {errorMessage}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  id="email"
                  type="email"
                  required
                  placeholder="admin@demo.dev"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
                <input
                  id="password"
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loginMutation.isPending}
              className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-xl shadow-xs focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-colors flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              <span>{loginMutation.isPending ? 'Signing in...' : 'Sign in'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          {/* Demo Accounts Panel */}
          <div className="pt-5 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Seeded Demo Accounts
              </span>
              <span className="text-[11px] text-slate-400 font-mono">Password: Demo@12345</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1">
              {demoAccounts.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => handleUseDemo(account.email)}
                  disabled={loginMutation.isPending}
                  className="text-left p-2.5 rounded-xl border border-slate-200/80 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all text-xs group"
                >
                  <p className="font-semibold text-slate-800 group-hover:text-indigo-600 truncate">
                    {account.name}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">{account.role}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
