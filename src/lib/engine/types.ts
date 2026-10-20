/**
 * Core type definitions for the SpendCoach Learning Engine.
 * All functions in the engine are pure and take these plain types as input/output.
 */

export interface EngineExpense {
  id: string;
  amountPaise: number;
  category: string;
  spentOn: string; // YYYY-MM-DD
  merchant?: string | null;
  note?: string | null;
  createdAt?: Date | string | null;
}

export interface EngineBudget {
  category: string;
  monthlyLimitPaise: number;
}

export interface EngineOptions {
  now?: string; // Reference date in YYYY-MM-DD (defaults to Asia/Kolkata today)
  budgets?: EngineBudget[];
}

export type LearningStatus = 'learning' | 'ready';

export interface CategoryLearningState {
  category: string;
  status: LearningStatus;
  expenseCount: number;
  threshold: number; // 8
  expensesNeeded: number;
}

export interface OverallLearningState {
  status: LearningStatus;
  expenseCount: number;
  distinctDaysCount: number;
  expenseThreshold: number; // 30
  distinctDaysThreshold: number; // 14
  expensesNeeded: number;
  daysNeeded: number;
  categories: Record<string, CategoryLearningState>;
}

export interface TransactionAnomaly {
  expenseId: string;
  amountPaise: number;
  category: string;
  spentOn: string;
  merchant?: string | null;
  note?: string | null;
  score: number;
  medianPaise: number;
  madPaise: number;
  ratioToMedian: number;
  baselineType: 'category' | 'overall';
  reason: string;
}

export interface DailyTotalAnomaly {
  date: string; // YYYY-MM-DD
  weekday: string; // "Monday", etc.
  totalPaise: number;
  medianPaise: number;
  score: number;
  ratioToMedian: number;
  baselineType: 'weekday' | 'all_days';
  dataPointsUsed: number;
  reason: string;
}

export interface RecurringItem {
  id: string; // generated key from normalised merchant/note
  key: string;
  merchantOrNote: string;
  category: string;
  interval: 'weekly' | 'biweekly' | 'monthly';
  intervalDays: number;
  occurrenceCount: number;
  estimatedAmountPaise: number;
  monthlyCostEstimatePaise: number;
  lastSpentOn: string;
  nextExpectedDate: string;
}

export type BudgetStatus = 'on_track' | 'warning' | 'over';

export interface CategoryBudgetRunRate {
  category: string;
  spentSoFarPaise: number;
  projectedMonthEndPaise: number;
  monthlyLimitPaise: number | null;
  budgetStatus: BudgetStatus;
  percentageUsed: number | null;
  projectedPercentage: number | null;
}

export interface OverallBudgetRunRate {
  spentSoFarPaise: number;
  projectedMonthEndPaise: number;
  monthlyLimitPaise: number | null;
  budgetStatus: BudgetStatus;
  percentageUsed: number | null;
  projectedPercentage: number | null;
  categories: CategoryBudgetRunRate[];
}

export interface CategoryTrend {
  category: string;
  last7DaysPaise: number;
  prev7DaysPaise: number;
  weekOverWeekPercent: number | null; // null if prev is 0
  currentMonthToDatePaise: number;
  prevMonthToDatePaise: number;
  monthOverMonthPercent: number | null; // null if prev is 0
}

export interface OverallTrends {
  last7DaysPaise: number;
  prev7DaysPaise: number;
  weekOverWeekPercent: number | null;
  currentMonthToDatePaise: number;
  prevMonthToDatePaise: number;
  monthOverMonthPercent: number | null;
  categories: CategoryTrend[];
}

export interface EngineOutput {
  evaluatedAt: string; // YYYY-MM-DD
  learning: OverallLearningState;
  transactionAnomalies: TransactionAnomaly[];
  dailyAnomalies: DailyTotalAnomaly[];
  recurring: RecurringItem[];
  budgetRunRate: OverallBudgetRunRate;
  trends: OverallTrends;
}
