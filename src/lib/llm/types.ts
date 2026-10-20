import { z } from 'zod';

export const dailyReviewAdviceSchema = z.object({
  headline: z.string().min(1, 'Headline is required'),
  went_well: z.array(z.string().min(1)).min(1).max(3),
  watch_out: z.array(z.string().min(1)).min(0).max(3),
  action_tomorrow: z.string().min(1, 'Action tomorrow is required'),
  saving_ideas: z.array(z.string().min(1)).min(1).max(3),
  earning_ideas: z.array(z.string().min(1)).min(0).max(2),
  mood: z.enum(['good', 'ok', 'careful']),
});

export type DailyReviewAdvice = z.infer<typeof dailyReviewAdviceSchema>;

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
}

export interface StoredAdviceJson extends DailyReviewAdvice {
  _meta?: {
    regenerationCount: number;
    lastGeneratedAt: string;
    isLearning?: boolean;
    learningProgress?: LearningProgress;
    fallbackReason?: FallbackReason;
    rawModelOutput?: string;
    guardrailRejectedNumbers?: number[];
  };
}

export interface DailyReviewSummaryPayload {
  evaluationDate: string;
  learningStatus: string;
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
