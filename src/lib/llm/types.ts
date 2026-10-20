import { z } from 'zod';

// ==========================================
// 1. DAILY REVIEW v2 SCHEMAS
// ==========================================
export const dailyReviewInsightItemSchema = z.object({
  insight_id: z.string().min(1, 'insight_id is required'),
  narrative: z.string().min(1, 'narrative is required'),
  lever_id: z.string().optional(),
});

export const dailyReviewAdviceSchemaV2 = z.object({
  verdict: z.string().min(1, 'verdict is required'),
  why_it_matters: z.string().min(1, 'why_it_matters is required'),
  insights: z.array(dailyReviewInsightItemSchema).max(3),
  one_action_tomorrow: z.string().min(1, 'one_action_tomorrow is required'),
  win: z.string().nullable(),
  mood: z.enum([
    'celebratory',
    'supportive',
    'direct',
    'cautious',
    'caution',
    'reflective',
    'good',
    'ok',
    'careful',
  ]),
});

export type DailyReviewAdviceV2 = z.infer<typeof dailyReviewAdviceSchemaV2>;

// v1 schema kept for backward compatibility with existing tests
export const dailyReviewAdviceSchema = z.object({
  headline: z.string().min(1, 'Headline is required').optional(),
  went_well: z.array(z.string().min(1)).min(1).max(3).optional(),
  watch_out: z.array(z.string().min(1)).min(0).max(3).optional(),
  action_tomorrow: z.string().min(1, 'Action tomorrow is required').optional(),
  saving_ideas: z.array(z.string().min(1)).min(1).max(3).optional(),
  earning_ideas: z.array(z.string().min(1)).min(0).max(2).optional(),
  verdict: z.string().min(1).optional(),
  why_it_matters: z.string().min(1).optional(),
  insights: z.array(dailyReviewInsightItemSchema).max(3).optional(),
  one_action_tomorrow: z.string().min(1).optional(),
  win: z.string().nullable().optional(),
  mood: z.enum([
    'celebratory',
    'supportive',
    'direct',
    'cautious',
    'caution',
    'reflective',
    'good',
    'ok',
    'careful',
  ]),
});

export type DailyReviewAdvice = z.infer<typeof dailyReviewAdviceSchema>;

// ==========================================
// 2. WEEKLY & MONTHLY REVIEW SCHEMAS
// ==========================================
export const weeklyExperimentSuggestionSchema = z.object({
  lever_id: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  target: z.string().min(1),
  baseline_paise: z.number().int().nonnegative(),
  duration_weeks: z.number().int().positive(),
});

export const weeklyReviewAdviceSchema = z.object({
  verdict: z.string().min(1),
  spend_vs_prior_weeks: z.string().min(1),
  best_category_trend: z.string().min(1),
  worst_category_trend: z.string().min(1),
  savings_rate: z.string().min(1),
  experiment_suggestion: weeklyExperimentSuggestionSchema,
  earning_ideas: z.array(z.string().min(1)).max(2).optional(),
  mood: z
    .enum([
      'celebratory',
      'supportive',
      'direct',
      'cautious',
      'reflective',
      'good',
      'ok',
      'careful',
    ])
    .optional(),
});

export type WeeklyReviewAdvice = z.infer<typeof weeklyReviewAdviceSchema>;

export const monthlyReviewAdviceSchema = z.object({
  verdict: z.string().min(1),
  income_vs_spend_vs_invested: z.string().min(1),
  savings_rate_vs_target: z.string().min(1),
  commitments_total: z.string().min(1),
  top_learnings: z.array(z.string().min(1)).min(1).max(3),
  budget_adjustment_suggestion: z.string().min(1),
  saving_or_earning_idea: z.string().min(1),
  mood: z
    .enum([
      'celebratory',
      'supportive',
      'direct',
      'cautious',
      'reflective',
      'good',
      'ok',
      'careful',
    ])
    .optional(),
});

export type MonthlyReviewAdvice = z.infer<typeof monthlyReviewAdviceSchema>;

// ==========================================
// 3. COMMON REVIEW METADATA & RESULTS
// ==========================================
export type FallbackReason =
  | 'no_key'
  | 'http_error'
  | 'timeout'
  | 'rate_limited'
  | 'invalid_json'
  | 'schema_invalid'
  | 'guardrail_rejected';

export interface LearningProgress {
  expenseCount: number;
  expenseThreshold: number;
  distinctDaysCount: number;
  distinctDaysThreshold: number;
  expensesNeeded: number;
  daysNeeded: number;
}

export interface DailyReviewResult {
  date: string;
  source: 'llm' | 'fallback';
  advice: DailyReviewAdvice;
  isLearning: boolean;
  regenerationCount: number;
  canRegenerate: boolean;
  learningProgress?: LearningProgress;
  disclaimer: string;
  fallbackReason?: FallbackReason;
  rawModelOutput?: string;
  guardrailRejectedNumbers?: number[];
  candidateInsightIds?: string[];
  actionId?: string;
}

export interface WeeklyReviewResult {
  date: string; // Sunday date
  source: 'llm' | 'fallback';
  advice: WeeklyReviewAdvice;
  isLearning: boolean;
  regenerationCount: number;
  canRegenerate: boolean;
  disclaimer: string;
  fallbackReason?: FallbackReason;
  rawModelOutput?: string;
}

export interface MonthlyReviewResult {
  date: string; // 1st of month
  source: 'llm' | 'fallback';
  advice: MonthlyReviewAdvice;
  isLearning: boolean;
  regenerationCount: number;
  canRegenerate: boolean;
  disclaimer: string;
  fallbackReason?: FallbackReason;
  rawModelOutput?: string;
}

export interface StoredAdviceJson extends Record<string, unknown> {
  _meta?: {
    periodType?: 'daily' | 'weekly' | 'monthly';
    regenerationCount: number;
    lastGeneratedAt: string;
    isLearning?: boolean;
    learningProgress?: LearningProgress;
    fallbackReason?: FallbackReason;
    rawModelOutput?: string;
    guardrailRejectedNumbers?: number[];
    candidateInsightIds?: string[];
    actionId?: string;
  };
}

// ==========================================
// 4. PRIVACY PAYLOAD TYPES
// ==========================================
export interface CandidateInsightPayload {
  insight_id: string;
  type: string;
  title: string;
  impactRupees: number;
  confidence: number;
  evidence: Record<string, unknown>;
  levers: Array<{
    lever_id: string;
    description: string;
    monthlySavingRupees: number;
  }>;
}

export interface SafeToSpendAllowancePayload {
  dailyAllowanceRupees: number;
  todaySpentRupees: number;
  remainingDiscretionaryRupees: number;
  verdict: 'under' | 'at' | 'over';
  tomorrowDailyAllowanceRupees: number;
  monthlyIncomeRupees: number;
  committedDueRupees: number;
  savingsTargetRupees: number;
  daysLeftInMonth: number;
}

export interface DailyReviewSummaryPayload {
  evaluationDate: string;
  learningStatus: string;
  allowance?: SafeToSpendAllowancePayload | null;
  candidateInsights: CandidateInsightPayload[];
  last3ActionIds?: string[];
  overallBudget: {
    spentSoFarRupees: number;
    monthlyLimitRupees: number | null;
    projectedMonthEndRupees: number;
    budgetStatus: string;
    percentageUsed: number | null;
  };
  categories: Array<{
    category: string;
    spentSoFarRupees: number;
    monthlyLimitRupees: number | null;
    projectedMonthEndRupees: number;
    budgetStatus: string;
    trend7dPctChange: number | null;
    trendMtdPctChange: number | null;
  }>;
  flaggedAnomalies: Array<{
    category: string;
    ratioToMedian: number;
    reason: string;
    amountRupees: number;
  }>;
  recurringCharges: Array<{
    merchant: string;
    interval: string;
    estimatedRupees: number;
    monthlyCostRupees: number;
  }>;
}
