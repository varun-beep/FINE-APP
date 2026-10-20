import { db } from '@/db';
import { reviews, expenses, schedules } from '@/db/schema';
import { eq, and, gte, lte } from 'drizzle-orm';
import { getKolkataToday } from '@/lib/date';
import { addDays } from '@/lib/engine/math';
import { formatPaiseToRupees } from '@/lib/money';
import { getLatestEngineOutput } from '@/lib/engine/db';
import {
  weeklyReviewAdviceSchema,
  type WeeklyReviewAdvice,
  type WeeklyReviewResult,
  type StoredAdviceJson,
  type FallbackReason,
} from '@/lib/llm/types';

const FINANCIAL_DISCLAIMER =
  'This is general guidance generated from your expense patterns, not professional financial advice.';

/**
 * Returns the Sunday date (YYYY-MM-DD) for the given date.
 * If the date is Sunday, returns that date. Otherwise returns the preceding Sunday.
 */
export function getReviewSunday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  const dayOfWeek = d.getUTCDay(); // 0 is Sunday
  const daysToSubtract = dayOfWeek === 0 ? 0 : dayOfWeek;
  return addDays(dateStr, -daysToSubtract);
}

export interface WeeklyAggregates {
  sundayDate: string;
  weekStart: string;
  w0SpendPaise: number;
  w1SpendPaise: number;
  w2SpendPaise: number;
  w3SpendPaise: number;
  trailing3AvgPaise: number;
  weekOverWeekPct: number | null;
  bestCategory: { category: string; w0Paise: number; w1Paise: number; diffPaise: number };
  worstCategory: { category: string; w0Paise: number; w1Paise: number; diffPaise: number };
  weeklyInvestedPaise: number;
  estimatedWeeklyIncomePaise: number;
  savingsRatePct: number;
  experimentSuggestion: {
    lever_id: string;
    category: string;
    description: string;
    target: string;
    baseline_paise: number;
    duration_weeks: number;
  };
}

export async function computeWeeklyAggregates(sundayDate: string): Promise<WeeklyAggregates> {
  const w0End = sundayDate;
  const w0Start = addDays(sundayDate, -6);
  const w1End = addDays(w0Start, -1);
  const w1Start = addDays(w1End, -6);
  const w2End = addDays(w1Start, -1);
  const w2Start = addDays(w2End, -6);
  const w3End = addDays(w2Start, -1);
  const w3Start = addDays(w3End, -6);

  // Fetch all expenses from w3Start to w0End
  const allExpenses = await db
    .select()
    .from(expenses)
    .where(and(gte(expenses.spentOn, w3Start), lte(expenses.spentOn, w0End)));

  let w0Spend = 0;
  let w1Spend = 0;
  let w2Spend = 0;
  let w3Spend = 0;
  let weeklyInvested = 0;

  const w0CatSpend: Record<string, number> = {};
  const w1CatSpend: Record<string, number> = {};

  for (const e of allExpenses) {
    if (e.spentOn >= w0Start && e.spentOn <= w0End) {
      if (e.kind === 'spend') {
        w0Spend += e.amountPaise;
        w0CatSpend[e.category] = (w0CatSpend[e.category] || 0) + e.amountPaise;
      } else if (e.kind === 'investment') {
        weeklyInvested += e.amountPaise;
      }
    } else if (e.spentOn >= w1Start && e.spentOn <= w1End) {
      if (e.kind === 'spend') {
        w1Spend += e.amountPaise;
        w1CatSpend[e.category] = (w1CatSpend[e.category] || 0) + e.amountPaise;
      }
    } else if (e.spentOn >= w2Start && e.spentOn <= w2End) {
      if (e.kind === 'spend') w2Spend += e.amountPaise;
    } else if (e.spentOn >= w3Start && e.spentOn <= w3End) {
      if (e.kind === 'spend') w3Spend += e.amountPaise;
    }
  }

  const trailing3Avg = Math.round((w1Spend + w2Spend + w3Spend) / 3);
  const weekOverWeekPct =
    w1Spend > 0 ? Math.round(((w0Spend - w1Spend) / w1Spend) * 100) : null;

  // Find best and worst category trends (w0 vs w1)
  const allCategories = Array.from(
    new Set([...Object.keys(w0CatSpend), ...Object.keys(w1CatSpend)])
  );
  let best = { category: 'General', w0Paise: 0, w1Paise: 0, diffPaise: 0 };
  let worst = { category: 'General', w0Paise: 0, w1Paise: 0, diffPaise: 0 };

  if (allCategories.length > 0) {
    const diffs = allCategories.map((cat) => {
      const c0 = w0CatSpend[cat] || 0;
      const c1 = w1CatSpend[cat] || 0;
      return { category: cat, w0Paise: c0, w1Paise: c1, diffPaise: c0 - c1 };
    });
    // Best: biggest decrease (minimum diffPaise)
    diffs.sort((a, b) => a.diffPaise - b.diffPaise);
    best = diffs[0];
    // Worst: biggest increase (maximum diffPaise)
    worst = diffs[diffs.length - 1];
  }

  // Estimated weekly income
  const allSchedules = await db.select().from(schedules).where(eq(schedules.active, true));
  const incomeSchedule = allSchedules.find((s) => s.kind === 'income');
  const monthlyIncome = incomeSchedule ? incomeSchedule.amountPaise : 5000000;
  const estimatedWeeklyIncome = Math.round(monthlyIncome / 4);

  const savingsRatePct =
    estimatedWeeklyIncome > 0
      ? Math.round((weeklyInvested / estimatedWeeklyIncome) * 100)
      : 0;

  // Engine candidate lever for experiment suggestion
  const engineOutput = await getLatestEngineOutput(w0End);
  let experimentSuggestion = {
    lever_id: 'lever:Dining:limit_orders',
    category: 'Dining',
    description: 'Limit food deliveries to 3 orders per week',
    target: '3 orders/week',
    baseline_paise: w0CatSpend['Dining'] || 200000,
    duration_weeks: 4,
  };

  const topInsightWithLever = (engineOutput.insights || []).find(
    (i) => i.levers && i.levers.length > 0
  );
  if (topInsightWithLever && topInsightWithLever.levers[0]) {
    const lev = topInsightWithLever.levers[0];
    const cat =
      typeof topInsightWithLever.evidence?.category === 'string'
        ? topInsightWithLever.evidence.category
        : 'Discretionary';
    experimentSuggestion = {
      lever_id: lev.id,
      category: cat,
      description: lev.description,
      target: lev.description,
      baseline_paise: w0CatSpend[cat] || 250000,
      duration_weeks: 4,
    };
  }

  return {
    sundayDate,
    weekStart: w0Start,
    w0SpendPaise: w0Spend,
    w1SpendPaise: w1Spend,
    w2SpendPaise: w2Spend,
    w3SpendPaise: w3Spend,
    trailing3AvgPaise: trailing3Avg,
    weekOverWeekPct,
    bestCategory: best,
    worstCategory: worst,
    weeklyInvestedPaise: weeklyInvested,
    estimatedWeeklyIncomePaise: estimatedWeeklyIncome,
    savingsRatePct,
    experimentSuggestion,
  };
}

export function generateDeterministicWeeklyFallback(
  agg: WeeklyAggregates
): WeeklyReviewAdvice {
  const w0Str = formatPaiseToRupees(agg.w0SpendPaise);
  const avgStr = formatPaiseToRupees(agg.trailing3AvgPaise);

  let verdict: string;
  if (agg.trailing3AvgPaise > 0) {
    if (agg.w0SpendPaise <= agg.trailing3AvgPaise) {
      verdict = `This week you spent ${w0Str}, which is under your trailing 3-week average of ${avgStr}.`;
    } else {
      verdict = `This week you spent ${w0Str}, exceeding your trailing 3-week average of ${avgStr}.`;
    }
  } else {
    verdict = `This week you recorded a total discretionary spend of ${w0Str}.`;
  }

  const spendVsPrior =
    agg.weekOverWeekPct !== null
      ? `Discretionary spend was ${Math.abs(agg.weekOverWeekPct)}% ${agg.weekOverWeekPct >= 0 ? 'higher' : 'lower'} than the previous week (${formatPaiseToRupees(agg.w1SpendPaise)}).`
      : `Weekly spend totaled ${w0Str} across the 7-day period.`;

  const bestTrend =
    agg.bestCategory.diffPaise < 0
      ? `${agg.bestCategory.category} saw the largest reduction, down ${formatPaiseToRupees(Math.abs(agg.bestCategory.diffPaise))} vs last week.`
      : `${agg.bestCategory.category} remained your best-controlled category at ${formatPaiseToRupees(agg.bestCategory.w0Paise)}.`;

  const worstTrend =
    agg.worstCategory.diffPaise > 0
      ? `${agg.worstCategory.category} grew by ${formatPaiseToRupees(agg.worstCategory.diffPaise)} compared to last week.`
      : `No significant category inflation was detected this week.`;

  const savingsRate = `Your weekly savings rate was ${agg.savingsRatePct}% with ${formatPaiseToRupees(agg.weeklyInvestedPaise)} invested.`;

  return {
    verdict,
    spend_vs_prior_weeks: spendVsPrior,
    best_category_trend: bestTrend,
    worst_category_trend: worstTrend,
    savings_rate: savingsRate,
    experiment_suggestion: agg.experimentSuggestion,
    earning_ideas: [
      'Sell unused household items, old electronics, or textbooks online to reinvest into your emergency fund.',
    ],
    mood: agg.w0SpendPaise <= agg.trailing3AvgPaise ? 'celebratory' : 'supportive',
  };
}

export async function generateWeeklyReview(
  targetDate?: string,
  options?: { regenerate?: boolean }
): Promise<WeeklyReviewResult> {
  const referenceDate = targetDate || getKolkataToday();
  const sundayDate = getReviewSunday(referenceDate);
  const regenerate = options?.regenerate === true;

  // 1. Check existing review in reviews table (Idempotency)
  const [existing] = await db
    .select()
    .from(reviews)
    .where(and(eq(reviews.periodType, 'weekly'), eq(reviews.reviewDate, sundayDate)))
    .limit(1);

  if (existing?.adviceJson && !regenerate) {
    const stored = existing.adviceJson as Record<string, unknown>;
    const parsed = weeklyReviewAdviceSchema.safeParse(stored);
    if (parsed.success) {
      return {
        date: sundayDate,
        source: (existing.source as 'llm' | 'fallback') || 'fallback',
        advice: parsed.data,
        isLearning: false,
        regenerationCount: 0,
        canRegenerate: true,
        disclaimer: FINANCIAL_DISCLAIMER,
      };
    }
  }

  // 2. Compute Weekly Aggregates
  const aggregates = await computeWeeklyAggregates(sundayDate);

  // 3. Generate deterministic fallback advice
  const fallbackAdvice = generateDeterministicWeeklyFallback(aggregates);
  let finalAdvice: WeeklyReviewAdvice = fallbackAdvice;
  let finalSource: 'llm' | 'fallback' = 'fallback';
  let fallbackReason: FallbackReason | undefined = 'no_key';

  // 4. Check for LLM generation
  const apiKey = process.env.GROQ_API_KEY?.trim();
  const baseUrl = process.env.LLM_BASE_URL?.trim() || 'https://api.groq.com/openai/v1';
  const model = process.env.LLM_MODEL?.trim() || 'llama-3.3-70b-versatile';

  if (apiKey) {
    try {
      const prompt = `You are SpendCoach AI generating a Weekly Financial Review for the week ending Sunday ${sundayDate}.
All numbers must come directly from the provided weekly aggregates.
Do not invent figures or financial products.
Include 1 realistic saving or decluttering earning idea.

WEEKLY AGGREGATES:
${JSON.stringify(aggregates, null, 2)}

Respond in valid JSON matching this schema:
{
  "verdict": string,
  "spend_vs_prior_weeks": string,
  "best_category_trend": string,
  "worst_category_trend": string,
  "savings_rate": string,
  "experiment_suggestion": {
    "lever_id": string,
    "category": string,
    "description": string,
    "target": string,
    "baseline_paise": number,
    "duration_weeks": number
  },
  "earning_ideas": string[],
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
          const validated = weeklyReviewAdviceSchema.safeParse(parsed);
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
      periodType: 'weekly',
      regenerationCount: 0,
      lastGeneratedAt: new Date().toISOString(),
      isLearning: false,
      fallbackReason,
    },
  };

  await db
    .insert(reviews)
    .values({
      periodType: 'weekly',
      reviewDate: sundayDate,
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
    date: sundayDate,
    source: finalSource,
    advice: finalAdvice,
    isLearning: false,
    regenerationCount: 0,
    canRegenerate: true,
    disclaimer: FINANCIAL_DISCLAIMER,
    fallbackReason,
  };
}
