'use client';

import React, { useState, useEffect } from 'react';
import { Navbar } from '@/components/Navbar';
import { formatPaiseToRupees } from '@/lib/money';
import {
  Calendar,
  Plus,
  Play,
  Pause,
  Trash2,
  Edit2,
  Sparkles,
  TrendingUp,
  CheckCircle,
  X,
  CreditCard,
  Tv,
  Coins,
} from 'lucide-react';
import { EXPENSE_CATEGORIES, type ExpenseCategory } from '@/lib/validations';

interface ScheduleItem {
  id: string;
  name: string;
  kind: 'subscription' | 'investment' | 'bill' | 'emi' | 'income';
  category: ExpenseCategory;
  amountPaise: number;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  anchorDate: string;
  startDate: string;
  endDate?: string | null;
  active: boolean;
  lastPostedThrough?: string | null;
  monthlyEquivalentPaise: number;
}

interface SuggestionItem {
  id: string;
  key: string;
  merchantOrNote: string;
  category: ExpenseCategory;
  interval: 'weekly' | 'biweekly' | 'monthly';
  estimatedAmountPaise: number;
}

const INDIAN_APP_PRESETS = [
  { name: 'Netflix', category: 'Subscriptions' as ExpenseCategory, kind: 'subscription' as const, frequency: 'monthly' as const },
  { name: 'Prime Video', category: 'Subscriptions' as ExpenseCategory, kind: 'subscription' as const, frequency: 'monthly' as const },
  { name: 'Disney+ Hotstar', category: 'Subscriptions' as ExpenseCategory, kind: 'subscription' as const, frequency: 'monthly' as const },
  { name: 'JioHotstar', category: 'Subscriptions' as ExpenseCategory, kind: 'subscription' as const, frequency: 'monthly' as const },
  { name: 'Spotify', category: 'Subscriptions' as ExpenseCategory, kind: 'subscription' as const, frequency: 'monthly' as const },
  { name: 'YouTube Premium', category: 'Subscriptions' as ExpenseCategory, kind: 'subscription' as const, frequency: 'monthly' as const },
  { name: 'Zee5', category: 'Subscriptions' as ExpenseCategory, kind: 'subscription' as const, frequency: 'monthly' as const },
  { name: 'SonyLIV', category: 'Subscriptions' as ExpenseCategory, kind: 'subscription' as const, frequency: 'monthly' as const },
  { name: 'Apple One', category: 'Subscriptions' as ExpenseCategory, kind: 'subscription' as const, frequency: 'monthly' as const },
  { name: 'iCloud', category: 'Subscriptions' as ExpenseCategory, kind: 'subscription' as const, frequency: 'monthly' as const },
  { name: 'Daily gold investment', category: 'Investment' as ExpenseCategory, kind: 'investment' as const, frequency: 'daily' as const },
];

export default function CommitmentsPage() {
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleItem | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'subscription' | 'investment' | 'bill' | 'emi' | 'income'>('subscription');
  const [category, setCategory] = useState<ExpenseCategory>('Subscriptions');
  const [amountRupees, setAmountRupees] = useState('');
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly');
  const [anchorDate, setAnchorDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const fetchSchedules = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/schedules');
      if (res.ok) {
        const data = await res.json();
        setSchedules(data.schedules || []);
        setSuggestions(data.suggestions || []);
      }
    } catch (err) {
      console.error('Failed to load commitments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const openAddModal = (preset?: typeof INDIAN_APP_PRESETS[0]) => {
    setEditingSchedule(null);
    if (preset) {
      setName(preset.name);
      setKind(preset.kind);
      setCategory(preset.category);
      setFrequency(preset.frequency);
    } else {
      setName('');
      setKind('subscription');
      setCategory('Subscriptions');
      setFrequency('monthly');
    }
    setAmountRupees('');
    const today = new Date().toISOString().slice(0, 10);
    setAnchorDate(today);
    setStartDate(today);
    setEffectiveFrom(today);
    setShowModal(true);
  };

  const openEditModal = (sched: ScheduleItem) => {
    setEditingSchedule(sched);
    setName(sched.name);
    setKind(sched.kind);
    setCategory(sched.category);
    setAmountRupees((sched.amountPaise / 100).toString());
    setFrequency(sched.frequency);
    setAnchorDate(sched.anchorDate);
    setStartDate(sched.startDate);
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedAmount = parseFloat(amountRupees);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      alert('Please enter a valid positive amount.');
      return;
    }

    const amount_paise = Math.round(parsedAmount * 100);
    setSaving(true);

    try {
      if (editingSchedule) {
        // PATCH
        const res = await fetch(`/api/schedules/${editingSchedule.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            kind,
            category,
            amount_paise,
            frequency,
            anchor_date: anchorDate,
            effective_from: effectiveFrom,
          }),
        });

        if (!res.ok) throw new Error('Update failed');
        showToast(`Updated "${name}" commitment`);
      } else {
        // POST
        const res = await fetch('/api/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name,
            kind,
            category,
            amount_paise,
            frequency,
            anchor_date: anchorDate,
            start_date: startDate,
          }),
        });

        if (!res.ok) throw new Error('Create failed');
        showToast(`Created commitment "${name}"`);
      }

      setShowModal(false);
      fetchSchedules();
    } catch (err) {
      console.error(err);
      alert('Failed to save commitment. Please check inputs.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (sched: ScheduleItem) => {
    try {
      const res = await fetch(`/api/schedules/${sched.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !sched.active }),
      });
      if (res.ok) {
        showToast(sched.active ? `Paused "${sched.name}"` : `Resumed "${sched.name}"`);
        fetchSchedules();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleDelete = async (sched: ScheduleItem) => {
    if (!confirm(`Delete commitment "${sched.name}"? Past posted expenses will remain.`)) return;
    try {
      const res = await fetch(`/api/schedules/${sched.id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        showToast(`Deleted "${sched.name}"`);
        fetchSchedules();
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Calculations for summary strip
  const activeSpendCommitments = schedules.filter(
    (s) => s.active && s.kind !== 'income' && s.kind !== 'investment'
  );
  const activeInvestments = schedules.filter(
    (s) => s.active && s.kind === 'investment'
  );
  const activeIncome = schedules.filter(
    (s) => s.active && s.kind === 'income'
  );

  const totalCommittedSpendPaise = activeSpendCommitments.reduce(
    (sum, s) => sum + s.monthlyEquivalentPaise,
    0
  );
  const totalInvestmentPaise = activeInvestments.reduce(
    (sum, s) => sum + s.monthlyEquivalentPaise,
    0
  );
  const totalIncomePaise = activeIncome.reduce(
    (sum, s) => sum + s.monthlyEquivalentPaise,
    0
  );

  const incomeShare =
    totalIncomePaise > 0
      ? Math.round((totalCommittedSpendPaise / totalIncomePaise) * 100)
      : null;

  // Group schedules by kind
  const kinds: Array<'subscription' | 'investment' | 'bill' | 'emi' | 'income'> = [
    'subscription',
    'investment',
    'bill',
    'emi',
    'income',
  ];

  const kindLabels: Record<string, { label: string; icon: React.ReactNode }> = {
    subscription: { label: 'OTT & Subscriptions', icon: <Tv className="h-4 w-4 text-purple-400" /> },
    investment: { label: 'Investments & Gold', icon: <Coins className="h-4 w-4 text-amber-400" /> },
    bill: { label: 'Recurring Bills', icon: <CreditCard className="h-4 w-4 text-blue-400" /> },
    emi: { label: 'EMIs & Loans', icon: <Calendar className="h-4 w-4 text-rose-400" /> },
    income: { label: 'Salary & Incomes', icon: <TrendingUp className="h-4 w-4 text-emerald-400" /> },
  };

  return (
    <div className="min-h-screen bg-slate-950 pb-24 text-slate-100">
      <Navbar />

      <main className="mx-auto max-w-xl px-4 pt-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-4">
          <div>
            <h1 className="text-xl font-black tracking-tight text-white">Fixed Commitments</h1>
            <p className="text-xs text-slate-400">
              Subscriptions, daily gold & bills separated from discretionary spend
            </p>
          </div>
          <button
            onClick={() => openAddModal()}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white shadow-lg shadow-emerald-950/40 transition hover:bg-emerald-500 active:scale-95"
          >
            <Plus className="h-4 w-4" />
            <span>Add New</span>
          </button>
        </div>

        {/* Toast */}
        {toastMessage && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-950/60 p-3 text-xs text-emerald-300 backdrop-blur-md">
            <CheckCircle className="h-4 w-4 text-emerald-400" />
            <span>{toastMessage}</span>
          </div>
        )}

        {/* Summary Strip */}
        <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/80 p-4 shadow-xl backdrop-blur-xl">
          <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
            <div className="rounded-xl bg-slate-950/60 p-2.5 border border-slate-800/60">
              <span className="block text-[11px] font-medium text-slate-400">Committed / mo</span>
              <span className="text-base font-bold text-white">
                {formatPaiseToRupees(totalCommittedSpendPaise)}
              </span>
              {incomeShare !== null && (
                <span className="block text-[10px] text-amber-400 font-semibold mt-0.5">
                  {incomeShare}% of income
                </span>
              )}
            </div>

            <div className="rounded-xl bg-slate-950/60 p-2.5 border border-slate-800/60">
              <span className="block text-[11px] font-medium text-amber-400">Investments / mo</span>
              <span className="text-base font-bold text-amber-200">
                {formatPaiseToRupees(totalInvestmentPaise)}
              </span>
            </div>

            <div className="col-span-2 rounded-xl bg-slate-950/60 p-2.5 border border-slate-800/60 sm:col-span-1">
              <span className="block text-[11px] font-medium text-emerald-400">Income / mo</span>
              <span className="text-base font-bold text-emerald-300">
                {totalIncomePaise > 0 ? formatPaiseToRupees(totalIncomePaise) : 'Not set'}
              </span>
            </div>
          </div>
        </div>

        {/* Quick-Add Indian App Presets */}
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Quick-Add Presets
            </span>
            <span className="text-[11px] text-slate-500">Tap to pre-fill</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none">
            {INDIAN_APP_PRESETS.map((p) => (
              <button
                key={p.name}
                onClick={() => openAddModal(p)}
                className="flex items-center gap-1.5 whitespace-nowrap rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-emerald-500/50 hover:bg-slate-800 active:scale-95"
              >
                <Plus className="h-3 w-3 text-emerald-400" />
                <span>{p.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Suggestion Banner from Learning Engine */}
        {suggestions.length > 0 && (
          <div className="mb-6 rounded-2xl border border-purple-500/30 bg-purple-950/20 p-4 backdrop-blur-md">
            <div className="flex items-center gap-2 pb-2">
              <Sparkles className="h-4 w-4 text-purple-400" />
              <span className="text-xs font-bold text-purple-200">
                Detected Recurring Charges
              </span>
            </div>
            <p className="text-xs text-purple-300/80 mb-3">
              These repeat regularly in your expenses. Add them as fixed commitments so they are never flagged as anomalies:
            </p>
            <div className="space-y-2">
              {suggestions.slice(0, 3).map((sug) => (
                <div
                  key={sug.key}
                  className="flex items-center justify-between rounded-xl border border-purple-900/40 bg-slate-950/60 p-2.5"
                >
                  <div>
                    <span className="font-semibold text-xs text-white block">
                      {sug.merchantOrNote}
                    </span>
                    <span className="text-[10px] text-purple-300">
                      {formatPaiseToRupees(sug.estimatedAmountPaise)} ({sug.interval})
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setName(sug.merchantOrNote);
                      setKind('subscription');
                      setCategory(sug.category);
                      setAmountRupees((sug.estimatedAmountPaise / 100).toString());
                      setFrequency(sug.interval === 'weekly' ? 'weekly' : 'monthly');
                      setShowModal(true);
                    }}
                    className="flex min-h-[36px] items-center gap-1 rounded-lg bg-purple-600/30 px-2.5 text-[11px] font-semibold text-purple-200 transition hover:bg-purple-600/50"
                  >
                    <span>Add</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Grouped Schedules List */}
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500">Loading commitments...</div>
        ) : schedules.length === 0 ? (
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-8 text-center">
            <Coins className="mx-auto h-8 w-8 text-slate-600 mb-2" />
            <h3 className="font-bold text-sm text-slate-300">No Commitments Added Yet</h3>
            <p className="text-xs text-slate-500 max-w-xs mx-auto mt-1 mb-4">
              Add your OTT subscriptions, daily gold, EMIs, and monthly bills.
            </p>
            <button
              onClick={() => openAddModal()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white shadow"
            >
              <Plus className="h-4 w-4" />
              <span>Add Your First Commitment</span>
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {kinds.map((k) => {
              const group = schedules.filter((s) => s.kind === k);
              if (group.length === 0) return null;
              const groupMonthlyTotal = group
                .filter((s) => s.active)
                .reduce((sum, s) => sum + s.monthlyEquivalentPaise, 0);

              return (
                <div key={k} className="rounded-2xl border border-slate-800/90 bg-slate-900/60 p-4">
                  {/* Group Header */}
                  <div className="flex items-center justify-between pb-3 border-b border-slate-800/60 mb-3">
                    <div className="flex items-center gap-2">
                      {kindLabels[k]?.icon}
                      <span className="text-xs font-bold text-white uppercase tracking-wider">
                        {kindLabels[k]?.label}
                      </span>
                    </div>
                    <span className="text-xs font-semibold text-slate-400">
                      {formatPaiseToRupees(groupMonthlyTotal)}/mo
                    </span>
                  </div>

                  {/* Items */}
                  <div className="space-y-2.5">
                    {group.map((item) => (
                      <div
                        key={item.id}
                        className={`flex items-center justify-between rounded-xl border p-3 transition ${
                          item.active
                            ? 'border-slate-800 bg-slate-950/70'
                            : 'border-slate-900 bg-slate-950/30 opacity-60'
                        }`}
                      >
                        <div className="flex-1 min-w-0 pr-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-white truncate">
                              {item.name}
                            </span>
                            {!item.active && (
                              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold text-slate-400">
                                PAUSED
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400">
                            <span className="capitalize">{item.frequency}</span>
                            <span>•</span>
                            <span>{item.category}</span>
                            <span>•</span>
                            <span>Anchor: {item.anchorDate.slice(8)}th</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className="font-bold text-sm text-white block">
                              {formatPaiseToRupees(item.amountPaise)}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              ~{formatPaiseToRupees(item.monthlyEquivalentPaise)}/mo
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => toggleActive(item)}
                              title={item.active ? 'Pause schedule' : 'Resume schedule'}
                              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                            >
                              {item.active ? (
                                <Pause className="h-4 w-4" />
                              ) : (
                                <Play className="h-4 w-4 text-emerald-400" />
                              )}
                            </button>
                            <button
                              onClick={() => openEditModal(item)}
                              title="Edit"
                              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(item)}
                              title="Delete"
                              className="p-1.5 text-slate-400 hover:text-red-400 rounded-lg hover:bg-slate-800"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
            <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
                <h2 className="text-base font-bold text-white">
                  {editingSchedule ? `Edit ${editingSchedule.name}` : 'New Commitment'}
                </h2>
                <button
                  onClick={() => setShowModal(false)}
                  className="rounded-lg p-1 text-slate-400 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={handleSave} className="space-y-4 text-xs">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">Name</label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Netflix Premium, Daily gold, House Rent"
                    className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-base text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-300 mb-1">Kind</label>
                    <select
                      value={kind}
                      onChange={(e) => setKind(e.target.value as ScheduleItem['kind'])}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-base text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="subscription">Subscription (OTT/Apps)</option>
                      <option value="investment">Investment (Gold/SIP)</option>
                      <option value="bill">Bill (Electricity/WiFi)</option>
                      <option value="emi">EMI / Loan</option>
                      <option value="income">Income / Salary</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-300 mb-1">Category</label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-base text-white focus:border-emerald-500 focus:outline-none"
                    >
                      {EXPENSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-300 mb-1">Amount (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={amountRupees}
                      onChange={(e) => setAmountRupees(e.target.value)}
                      placeholder="e.g. 649"
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-base text-white focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-300 mb-1">Frequency</label>
                    <select
                      value={frequency}
                      onChange={(e) => setFrequency(e.target.value as ScheduleItem['frequency'])}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-base text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-300 mb-1">Anchor Date</label>
                    <input
                      type="date"
                      required
                      value={anchorDate}
                      onChange={(e) => setAnchorDate(e.target.value)}
                      className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-base text-white focus:border-emerald-500 focus:outline-none"
                    />
                    <span className="text-[10px] text-slate-500 mt-1 block">
                      Day of month / anniversary date
                    </span>
                  </div>

                  {editingSchedule ? (
                    <div>
                      <label className="block font-semibold text-slate-300 mb-1">Effective From</label>
                      <input
                        type="date"
                        required
                        value={effectiveFrom}
                        onChange={(e) => setEffectiveFrom(e.target.value)}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-base text-white focus:border-emerald-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">
                        Past postings are kept
                      </span>
                    </div>
                  ) : (
                    <div>
                      <label className="block font-semibold text-slate-300 mb-1">Start Date</label>
                      <input
                        type="date"
                        required
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2.5 text-base text-white focus:border-emerald-500 focus:outline-none"
                      />
                      <span className="text-[10px] text-slate-500 mt-1 block">
                        Never posts before this
                      </span>
                    </div>
                  )}
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="min-h-[44px] rounded-xl px-4 font-semibold text-slate-400 hover:bg-slate-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="min-h-[44px] rounded-xl bg-emerald-600 px-5 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {saving ? 'Saving...' : editingSchedule ? 'Save Changes' : 'Create Commitment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
