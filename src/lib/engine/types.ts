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
  kind?: 'spend' | 'investment' | 'income';
  source?: 'manual' | 'schedule';
  scheduleId?: string | null;
  oneOff?: boolean;
}

export interface EngineBudget {
  category: string;
  monthlyLimitPaise: number;
}

export interface EngineSchedule {
  id: string;
  name: string;
  kind: 'subscription' | 'investment' | 'bill' | 'emi' | 'income';
  category: string;
  amountPaise: number;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  anchorDate: string;
  startDate: string;
  endDate?: string | null;
  active: boolean;
}

export interface EngineDayClosure {
  day: string;
  status: 'logged' | 'no_spend' | 'skipped';
  closedAt?: Date | string;
}

export interface InsightLever {
  id: string;
  description: string;
  monthlySavingPaise: number;
}

export type InsightType =
  | 'safe_to_spend'
  | 'outlier'
  | 'drift'
  | 'behaviour'
  | 'small_leaks'
  | 'commitment_load'
  | 'savings'
  | 'projection'
  | 'experiment_progress';

export interface Insight {
  id: string; // stable, e.g. "drift:Food:2026-W42"
  type: InsightType;
  title: string;
  evidence: Record<string, number | string | boolean | null | undefined>;
  impactPaise: number; // estimated ₹ effect this month or per month
  confidence: number; // 0-1 from sample size and signal strength
  actionable: boolean;
  levers: InsightLever[];
  firstSeen: string; // YYYY-MM-DD
  severity: 'info' | 'warning' | 'alert';
  expenseId?: string; // for outliers (to allow one-off tagging)
  score?: number; // computed ranking score
}

export interface SilentFlag {
  id: string;
  type: string;
  title: string;
  reason: string;
  evidence: Record<string, number | string | boolean | null | undefined>;
}


export type AllowanceVerdict = 'under' | 'at' | 'over';

export interface SafeToSpendAllowance {
  dailyAllowancePaise: number;
  weekdayAwareAllowancePaise: number;
  todaySpentPaise: number;
  verdict: AllowanceVerdict;
  tomorrowDailyAllowancePaise: number;
  tomorrowWeekdayAllowancePaise: number;
  monthlyIncomePaise: number;
  committedDuePaise: number;
  savingsTargetPaise: number;
  discretionarySpentSoFarPaise: number;
  remainingDiscretionaryPaise: number;
  daysLeftInMonth: number;
}

export interface CoverageReport {
  daysClosed: number;
  weeksOfHistory: number;
  categoriesReady: string[];
  categoriesLearning: string[];
  reasons: string[];
}

export interface InsightLogEntry {
  insightKey: string;
  firstShown: Date | string;
  lastShown: Date | string;
  timesShown: number;
  dismissed: boolean;
  feedback?: 'not_now' | 'not_useful' | 'already_know' | 'planned' | null;
  lastImpactPaise?: number | null;
  updatedAt?: Date | string;
}

export interface EngineExperiment {
  id: string;
  leverId: string;
  category: string;
  metric: string;
  target: string;
  baseline: number;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  status: 'active' | 'completed' | 'abandoned';
}

export interface ExperimentProgress {
  id: string;
  name: string;
  startDate: string;
  targetSavingPaise: number;
  currentSavingPaise: number;
  status: 'in_progress' | 'achieved' | 'failed';
}

export interface EngineOptions {
  now?: string; // Reference date in YYYY-MM-DD (defaults to Asia/Kolkata today)
  budgets?: EngineBudget[];
  schedules?: EngineSchedule[];
  closedDays?: EngineDayClosure[];
  insightLogs?: InsightLogEntry[];
  experiments?: EngineExperiment[];
  savingsTargetRate?: number; // default 0.20 (20%)
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

export interface MonthEndProjection {
  totalProjectedPaise: number;
  lowPaise: number;
  highPaise: number;
  spentSoFarThisMonthPaise: number;
  committedKnownRestOfMonthPaise: number;
  projectedDiscretionaryRemainingPaise: number;
  cappedP90Paise: number;
  daysRemaining: number;
  title: string;
}

export interface EngineOutput {
  evaluatedAt: string; // YYYY-MM-DD
  coverage?: CoverageReport;
  allowance?: SafeToSpendAllowance | null;
  projection?: MonthEndProjection | null;
  insights?: Insight[];
  silentFlags?: SilentFlag[];
  allRankedInsights?: Insight[];
  learning: OverallLearningState;
  transactionAnomalies: TransactionAnomaly[];
  dailyAnomalies: DailyTotalAnomaly[];
  recurring: RecurringItem[];
  budgetRunRate: OverallBudgetRunRate;
  trends: OverallTrends;
}


