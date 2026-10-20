import React from 'react';
import {
  Utensils,
  ShoppingCart,
  Car,
  Receipt,
  ShoppingBag,
  HeartPulse,
  Film,
  Home,
  Tag,
  Tv,
  Coins,
  TrendingUp,
  Calendar,
} from 'lucide-react';
import type { ExpenseCategory } from '@/lib/validations';

interface Props {
  category: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export const CATEGORY_META: Record<
  ExpenseCategory,
  {
    icon: React.ComponentType<{ className?: string }>;
    colorClass: string;
    bgClass: string;
    borderClass: string;
  }
> = {
  Food: {
    icon: Utensils,
    colorClass: 'text-amber-400',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/20',
  },
  Groceries: {
    icon: ShoppingCart,
    colorClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/20',
  },
  Transport: {
    icon: Car,
    colorClass: 'text-sky-400',
    bgClass: 'bg-sky-500/10',
    borderClass: 'border-sky-500/20',
  },
  Bills: {
    icon: Receipt,
    colorClass: 'text-purple-400',
    bgClass: 'bg-purple-500/10',
    borderClass: 'border-purple-500/20',
  },
  Shopping: {
    icon: ShoppingBag,
    colorClass: 'text-pink-400',
    bgClass: 'bg-pink-500/10',
    borderClass: 'border-pink-500/20',
  },
  Health: {
    icon: HeartPulse,
    colorClass: 'text-rose-400',
    bgClass: 'bg-rose-500/10',
    borderClass: 'border-rose-500/20',
  },
  Entertainment: {
    icon: Film,
    colorClass: 'text-indigo-400',
    bgClass: 'bg-indigo-500/10',
    borderClass: 'border-indigo-500/20',
  },
  Rent: {
    icon: Home,
    colorClass: 'text-teal-400',
    bgClass: 'bg-teal-500/10',
    borderClass: 'border-teal-500/20',
  },
  Subscriptions: {
    icon: Tv,
    colorClass: 'text-purple-400',
    bgClass: 'bg-purple-500/10',
    borderClass: 'border-purple-500/20',
  },
  Investment: {
    icon: Coins,
    colorClass: 'text-amber-400',
    bgClass: 'bg-amber-500/10',
    borderClass: 'border-amber-500/20',
  },
  Income: {
    icon: TrendingUp,
    colorClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/20',
  },
  EMI: {
    icon: Calendar,
    colorClass: 'text-rose-400',
    bgClass: 'bg-rose-500/10',
    borderClass: 'border-rose-500/20',
  },
  Other: {
    icon: Tag,
    colorClass: 'text-slate-400',
    bgClass: 'bg-slate-500/10',
    borderClass: 'border-slate-500/20',
  },
};

export function CategoryBadge({ category, size = 'sm', showLabel = true }: Props) {
  const meta = CATEGORY_META[category as ExpenseCategory] || CATEGORY_META.Other;
  const IconComponent = meta.icon;

  const iconSizes = {
    sm: 'h-3.5 w-3.5',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
  };

  const containerPadding = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border font-medium ${meta.bgClass} ${meta.borderClass} ${meta.colorClass} ${containerPadding[size]}`}
    >
      <IconComponent className={iconSizes[size]} />
      {showLabel && <span>{category}</span>}
    </span>
  );
}
