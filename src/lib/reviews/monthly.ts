import { db } from '@/db';
import { reviews, expenses, schedules, budgets } from '@/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { getKolkataToday } from '@/lib/date';
import { formatPaiseToRupees } from '@/lib/money';
import { getLatestEngineOutput } from '@/lib/engine/db';
import {
  monthlyReviewAdviceSchema,
  type MonthlyReviewAdvice,
  type MonthlyReviewResult,
  type StoredAdviceJson,
  type FallbackReason,
} from '@/lib/llm/types';

const FINANCIAL_DISCLAIMER =
  'This is general guidance generated from your expense patterns, not professional financial advice.';

/**
 * Returns the 1st of the month for the given date (YYYY-MM-01).
 */
export function getReviewMonth(dateStr: string): string {
  return dateStr.slice(0, 7) + '-01';
}

export interface MonthlyAggregates {
  monthDate: string; // YYYY-MM-01
  monthEnd: string;
  monthlyIncomePaise: number;
  monthlySpendPaise: number;
  monthlyInvestedPaise: number;
  savingsRatePct: number;
  savingsTargetRatePct: number;
  commitmentsTotalPaise: number;
  commitmentsShareOfIncomePct: number;
  topLearnings: string[];
  budgetAdjustmentSuggestion: string;
  savingOrEarningIdea: string;
}

export async function computeMonthlyAggregates(
  monthDate: string
): Promise<MonthlyAggregates> {
  const [yearStr, monthStr] = monthDate.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthEnd = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

  // 1. Fetch expenses for this month
  const monthExpenses = await db
    .select()
    .from(expenses)
    .where(and(gte(expenses.spentOn, monthDate), lte(expenses.spentOn, monthEnd)));

  let spendPaise = 0;
  let investedPaise = 0;
  let incomePaiseFromExpenses = 0;
  const categorySpendMap: Record<string, number> = {};

  for (const e of monthExpenses) {
    if (e.kind === 'spend') {
      spendPaise += e.amountPaise;
      categorySpendMap[e.category] = (categorySpendMap[e.category] || 0) + e.amountPaise;
    } else if (e.kind === 'investment') {
      investedPaise += e.amountPaise;
    } else if (e.kind === 'income') {
      incomePaiseFromExpenses += e.amountPaise;
    }
  }

  // 2. Fetch schedules (commitments and scheduled income)
  const activeSchedules = await db
    .select()
    .from(schedules)
    .where(eq(schedules.active, true));

  let scheduledIncomePaise = 0;
  let commitmentsTotalPaise = 0;

  for (const s of activeSchedules) {
    if (s.kind === 'income') {
      scheduledIncomePaise += s.amountPaise;
    } else if (s.kind === 'subscription' || s.kind === 'bill' || s.kind === 'emi') {
      // Monthly cost
      if (s.frequency === 'monthly') {
        commitmentsTotalPaise += s.amountPaise;
      } else if (s.frequency === 'daily') {
        commitmentsTotalPaise += s.amountPaise * 30;
      } else if (s.frequency === 'weekly') {
        commitmentsTotalPaise += s.amountPaise * 4;
      } else if (s.frequency === 'yearly') {
        commitmentsTotalPaise += Math.round(s.amountPaise / 12);
      }
    }
  }

  const totalIncomePaise =
    incomePaiseFromExpenses > 0 ? incomePaiseFromExpenses : scheduledIncomePaise || 5000000;

  const savingsRatePct =
    totalIncomePaise > 0
      ? Math.round((investedPaise / totalIncomePaise) * 100)
      : 0;

  const commitmentsSharePct =
    totalIncomePaise > 0
      ? Math.round((commitmentsTotalPaise / totalIncomePaise) * 100)
      : 0;

  // 3. Top 3 Learnings from Engine
  const engineOutput = await getLatestEngineOutput(monthEnd);
  const topLearnings: string[] = [];

  // Largest category
  const sortedCategories = Object.entries(categorySpendMap).sort(
    (a, b) => b[1] - a[1]
  );
  if (sortedCategories.length > 0) {
    const [topCat, topAmount] = sortedCategories[0];
    const topPct = spendPaise > 0 ? Math.round((topAmount / spendPaise) * 100) : 0;
    topLearnings.push(
      `${topCat} was your largest discretionary expense, accounting for ${topPct}% (${formatPaiseToRupees(topAmount)}) of monthly spend.`
    );
  }

  // Check commitments share
  topLearnings.push(
    `Fixed commitments consumed ${commitmentsSharePct}% (${formatPaiseToRupees(commitmentsTotalPaise)}) of your monthly income.`
  );

  // Check top engine insight or drift
  const topInsight = (engineOutput.insights || []).find((i) => i.type !== 'safe_to_spend');
  if (topInsight) {
    topLearnings.push(topInsight.title);
  } else {
    topLearnings.push(
      `Discretionary spending remained balanced across ${sortedCategories.length} categories.`
    );
  }

  // 4. Engine-computed budget adjustment suggestion
  const allBudgets = await db.select().from(budgets);
  let budgetAdjustmentSuggestion = 'Maintain existing category allocations; all budgets are tracking close to baselines.';

  for (const b of allBudgets) {
    const actualSpend = categorySpendMap[b.category] || 0;
    if (actualSpend > b.monthlyLimitPaise * 1.15) {
      const overBy = formatPaiseToRupees(actualSpend - b.monthlyLimitPaise);
      budgetAdjustmentSuggestion = `Consider increasing the ${b.category} monthly budget by ${overBy} to reflect actual recurring demand, or reallocate from savings.`;
      break;
    } else if (actualSpend < b.monthlyLimitPaise * 0.75 && b.monthlyLimitPaise > 50000) {
      const surplus = formatPaiseToRupees(b.monthlyLimitPaise - actualSpend);
      budgetAdjustmentSuggestion = `You consistently underspent in ${b.category} by ${surplus}. Consider reallocating this surplus toward investments or emergency savings.`;
      break;
    }
  }

  // 5. Saving or Earning Idea
  let savingOrEarningIdea = 'Audit active OTT and recurring subscriptions to cancel any services not used in the past 30 days.';
  if (topInsight?.levers && topInsight.levers.length > 0) {
    const lev = topInsight.levers[0];
    savingOrEarningIdea = `${lev.description} to capture an estimated ${formatPaiseToRupees(lev.monthlySavingPaise)} in monthly savings.`;
  }

  return {
    monthDate,
    monthEnd,
    monthlyIncomePaise: totalIncomePaise,
    monthlySpendPaise: spendPaise,
    monthlyInvestedPaise: investedPaise,
    savingsRatePct,
    savingsTargetRatePct: 20,
    commitmentsTotalPaise,
    commitmentsShareOfIncomePct: commitmentsSharePct,
    topLearnings: topLearnings.slice(0, 3),
    budgetAdjustmentSuggestion,
    savingOrEarningIdea,
  };
}

export function generateDeterministicMonthlyFallback(
  agg: MonthlyAggregates
): MonthlyReviewAdvice {
  const incStr = formatPaiseToRupees(agg.monthlyIncomePaise);
  const spendStr = formatPaiseToRupees(agg.monthlySpendPaise);
  const invStr = formatPaiseToRupees(agg.monthlyInvestedPaise);

  const verdict = `Monthly financial summary: earned ${incStr}, spent ${spendStr} on discretionary items, and invested ${invStr}.`;
  const incomeVsSpendVsInvested = `Total monthly income of ${incStr} went to ${spendStr} discretionary spending and ${invStr} into investments/gold.`;
  const savingsRateVsTarget = `Achieved a ${agg.savingsRatePct}% savings rate against your target of ${agg.savingsTargetRatePct}%.`;
  const commitmentsTotal = `Committed bills and subscriptions totaled ${formatPaiseToRupees(agg.commitmentsTotalPaise)} (${agg.commitmentsShareOfIncomePct}% of income).`;

  return {
    verdict,
    income_vs_spend_vs_invested: incomeVsSpendVsInvested,
    savings_rate_vs_target: savingsRateVsTarget,
    commitments_total: commitmentsTotal,
    top_learnings: agg.topLearnings,
    budget_adjustment_suggestion: agg.budgetAdjustmentSuggestion,
    saving_or_earning_idea: agg.savingOrEarningIdea,
    mood: agg.savingsRatePct >= agg.savingsTargetRatePct ? 'celebratory' : 'supportive',
  };
}

export async function generateMonthlyReview(
  targetDate?: string,
  options?: { regenerate?: boolean }
): Promise<MonthlyReviewResult> {
  const referenceDate = targetDate || getKolkataToday();
  const monthDate = getReviewMonth(referenceDate);
  const regenerate = options?.regenerate === true;

  // 1. Check existing review (Idempotency)
  const [existing] = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.periodType, 'monthly'), eq(reviews.reviewDate, monthDate)))
    .limit(1);

  if (existing?.adviceJson && !regenerate) {
    const stored = existing.adviceJson as Record<string, unknown>;
    const parsed = monthlyReviewAdviceSchema.safeParse(stored);
    if (parsed.success) {
      return {
        date: monthDate,
        source: (existing.source as 'llm' | 'fallback') || 'fallback',
        advice: parsed.data,
        isLearning: false,
        regenerationCount: 0,
        canRegenerate: true,
        disclaimer: FINANCIAL_DISCLAIMER,
      };
    }
  }

  // 2. Compute Monthly Aggregates
  const aggregates = await computeMonthlyAggregates(monthDate);

  // 3. Fallback advice
  const fallbackAdvice = generateDeterministicMonthlyFallback(aggregates);
  let finalAdvice: MonthlyReviewAdvice = fallbackAdvice;
  let finalSource: 'llm' | 'fallback' = 'fallback';
  let fallbackReason: FallbackReason | undefined = 'no_key';

  // 4. Call LLM if key available
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const baseUrl = process.env.LLM_BASE_URL?.trim() || 'https://api.groq.com/openai/v1';
  const model = process.env.LLM_MODEL?.trim() || 'llama-3.3-70b-versatile';

  if (apiKey) {
    try {
      const prompt = `You are SpendCoach AI generating a Monthly Financial Review for ${monthDate.slice(0, 7)}.
All numbers must come directly from the provided monthly aggregates.
Do not invent figures or financial products.
Provide an objective, non-shaming coaching review.

MONTHLY AGGREGATES:
${JSON.stringify(aggregates, null, 2)}

Respond in valid JSON matching this schema:
{
  "verdict": string,
  "income_vs_spend_vs_invested": string,
  "savings_rate_vs_target": string,
  "commitments_total": string,
  "top_learnings": string[], // 1 to 3 items
  "budget_adjustment_suggestion": string,
  "saving_or_earning_idea": string,
  "mood": "celebratory" | "supportive" | "direct" | "cautious" | "reflective"
}`;

      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.3,
          max_tokens: 700,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (res.ok) {
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (content) {
          const parsed = JSON.parse(content);
          const validated = monthlyReviewAdviceSchema.safeParse(parsed);
          if (validated.success) {
            finalAdvice = validated.data;
            finalSource = 'llm';
            fallbackReason = undefined;
          }
        }
      }
    } catch {
      // Fallback remains active
    }
  }

  // 5. Persist to reviews table
  const adviceToStore: StoredAdviceJson = {
    ...finalAdvice,
    _meta: {
      periodType: 'monthly',
      regenerationCount: 0,
      lastGeneratedAt: new Date().toISOString(),
      isLearning: false,
      fallbackReason,
    },
  };

  await db
    .insert(reviews)
    .values({
      periodType: 'monthly',
      reviewDate: monthDate,
      statsJson: aggregates as unknown as Record<string, unknown>,
      adviceJson: adviceToStore as unknown as Record<string, unknown>,
      source: finalSource,
      createdAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [reviews.periodType, reviews.reviewDate],
      set: {
        statsJson: aggregates as unknown as Record<string, unknown>,
        adviceJson: adviceToStore as unknown as Record<string, unknown>,
        source: finalSource,
      },
    });

  return {
    date: monthDate,
    source: finalSource,
    advice: finalAdvice,
    isLearning: false,
    regenerationCount: 0,
    canRegenerate: true,
    disclaimer: FINANCIAL_DISCLAIMER,
    fallbackReason,
  };
}
