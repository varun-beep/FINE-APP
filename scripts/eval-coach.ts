import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

import { generateFallbackAdvice, generateLearningAdvice } from '../src/lib/llm/fallback';
import { dailyReviewAdviceSchemaV2, type DailyReviewAdviceV2 } from '../src/lib/llm/types';
import { validateNumberGuardrail } from '../src/lib/llm/guardrail';
import { buildDailyReviewSummaryPayload } from '../src/lib/llm/privacy';
import type { EngineOutput, Insight, SafeToSpendAllowance } from '../src/lib/engine/types';

const FORBIDDEN_MORALISING_PHRASES = [
  'should have',
  'guilty',
  'bad habit',
  'wasteful',
  'shame',
  'foolish',
  'careless',
  'irresponsible',
  'lazy',
  'failure',
];

interface ScenarioDefinition {
  id: number;
  slug: 'over_budget' | 'on_track' | 'nothing_notable' | 'duplicate_charge' | 'learning_mode' | 'food_drift';
  name: string;
  description: string;
  allowance: SafeToSpendAllowance;
  insights: Insight[];
  isLearningMode?: boolean;
  expectedNotes?: (advice: DailyReviewAdviceV2) => string | null;
}

const SCENARIOS: ScenarioDefinition[] = [
  {
    id: 1,
    slug: 'over_budget',
    name: 'Over Budget',
    description: 'Spent ₹4,500 against daily allowance of ₹2,000 (over budget)',
    allowance: {
      dailyAllowancePaise: 200000,
      todaySpentPaise: 450000,
      weekdayAwareAllowancePaise: 200000,
      tomorrowDailyAllowancePaise: 150000,
      tomorrowWeekdayAllowancePaise: 150000,
      verdict: 'over',
      monthlyIncomePaise: 15000000,
      committedDuePaise: 2000000,
      savingsTargetPaise: 3000000,
      discretionarySpentSoFarPaise: 450000,
      remainingDiscretionaryPaise: 9550000,
      daysLeftInMonth: 16,
    },
    insights: [],
    expectedNotes: (adv) => (adv.verdict.toLowerCase().includes('exceeded') || adv.verdict.toLowerCase().includes('over') ? null : 'Expected over-budget verdict'),
  },
  {
    id: 2,
    slug: 'on_track',
    name: 'On Track',
    description: 'Spent ₹1,200 against daily allowance of ₹2,500 (comfortably on track)',
    allowance: {
      dailyAllowancePaise: 250000,
      todaySpentPaise: 120000,
      weekdayAwareAllowancePaise: 250000,
      tomorrowDailyAllowancePaise: 260000,
      tomorrowWeekdayAllowancePaise: 260000,
      verdict: 'under',
      monthlyIncomePaise: 15000000,
      committedDuePaise: 2000000,
      savingsTargetPaise: 3000000,
      discretionarySpentSoFarPaise: 120000,
      remainingDiscretionaryPaise: 9880000,
      daysLeftInMonth: 16,
    },
    insights: [],
    expectedNotes: (adv) => (adv.win ? null : 'Expected win to be populated when under allowance'),
  },
  {
    id: 3,
    slug: 'nothing_notable',
    name: 'Nothing Notable',
    description: 'Zero anomalies, normal spend, must say "nothing notable today"',
    allowance: {
      dailyAllowancePaise: 200000,
      todaySpentPaise: 195000,
      weekdayAwareAllowancePaise: 200000,
      tomorrowDailyAllowancePaise: 200000,
      tomorrowWeekdayAllowancePaise: 200000,
      verdict: 'at',
      monthlyIncomePaise: 15000000,
      committedDuePaise: 2000000,
      savingsTargetPaise: 3000000,
      discretionarySpentSoFarPaise: 195000,
      remainingDiscretionaryPaise: 9805000,
      daysLeftInMonth: 16,
    },
    insights: [],
    expectedNotes: (adv) =>
      adv.why_it_matters.toLowerCase().includes('nothing notable today')
        ? null
        : 'Expected why_it_matters to contain "nothing notable today" on calm day',
  },
  {
    id: 4,
    slug: 'duplicate_charge',
    name: 'Duplicate Charge',
    description: 'Possible duplicate charge flagged (Swiggy ₹450)',
    allowance: {
      dailyAllowancePaise: 200000,
      todaySpentPaise: 90000,
      weekdayAwareAllowancePaise: 200000,
      tomorrowDailyAllowancePaise: 205000,
      tomorrowWeekdayAllowancePaise: 205000,
      verdict: 'under',
      monthlyIncomePaise: 15000000,
      committedDuePaise: 2000000,
      savingsTargetPaise: 3000000,
      discretionarySpentSoFarPaise: 90000,
      remainingDiscretionaryPaise: 9910000,
      daysLeftInMonth: 16,
    },
    insights: [
      {
        id: 'outlier:possible_duplicate:swiggy_450',
        type: 'outlier',
        title: 'Possible duplicate charge: ₹450.00 at Swiggy',
        impactPaise: 45000,
        confidence: 0.95,
        actionable: true,
        levers: [
          {
            id: 'dispute_duplicate',
            description: 'Check this charge with the merchant or your bank',
            monthlySavingPaise: 45000,
          },
        ],
        evidence: { merchant: 'Swiggy', amountPaise: 45000, duplicateCount: 2, classification: 'possible_duplicate' },
        firstSeen: '2026-10-20',
        severity: 'alert',
      },
    ],
    expectedNotes: (adv) => {
      const found = adv.insights.some((i) => i.insight_id.includes('swiggy_450'));
      return found ? null : 'Expected duplicate charge to be surfaced in insights';
    },
  },
  {
    id: 5,
    slug: 'learning_mode',
    name: 'Learning Mode',
    description: 'Learning gate active (coverage closed days < 14)',
    allowance: {
      dailyAllowancePaise: 200000,
      todaySpentPaise: 100000,
      weekdayAwareAllowancePaise: 200000,
      tomorrowDailyAllowancePaise: 200000,
      tomorrowWeekdayAllowancePaise: 200000,
      verdict: 'under',
      monthlyIncomePaise: 15000000,
      committedDuePaise: 2000000,
      savingsTargetPaise: 3000000,
      discretionarySpentSoFarPaise: 100000,
      remainingDiscretionaryPaise: 9900000,
      daysLeftInMonth: 16,
    },
    insights: [],
    isLearningMode: true,
    expectedNotes: (adv) => (adv.verdict.toLowerCase().includes('learning') ? null : 'Expected learning verdict in learning mode'),
  },
  {
    id: 6,
    slug: 'food_drift',
    name: 'Food Drift',
    description: 'Steady Food drift (+40% over 4 weeks), driven by dining upgrade',
    allowance: {
      dailyAllowancePaise: 200000,
      todaySpentPaise: 250000,
      weekdayAwareAllowancePaise: 200000,
      tomorrowDailyAllowancePaise: 195000,
      tomorrowWeekdayAllowancePaise: 195000,
      verdict: 'over',
      monthlyIncomePaise: 15000000,
      committedDuePaise: 2000000,
      savingsTargetPaise: 3000000,
      discretionarySpentSoFarPaise: 250000,
      remainingDiscretionaryPaise: 9750000,
      daysLeftInMonth: 16,
    },
    insights: [
      {
        id: 'drift:Food:2026-W42',
        type: 'drift',
        title: 'Food spend drifting up 40% (+₹4,000.00/mo)',
        impactPaise: 400000,
        confidence: 0.9,
        actionable: true,
        levers: [
          {
            id: 'curb_drift_food',
            description: 'Bring Food back to previous pace of ₹1,000/week',
            monthlySavingPaise: 400000,
          },
        ],
        evidence: {
          category: 'Food',
          percentChange: 40,
          monthlyEffectPaise: 400000,
          recentWeeklyMedianPaise: 250000,
          priorWeeklyMedianPaise: 150000,
          drivers: [{ merchant: 'Punjab Grill', rupeesAddedPaise: 100000, recentWeeklyAvgPaise: 250000, baselineWeeklyAvgPaise: 150000 }],
        },
        firstSeen: '2026-10-20',
        severity: 'warning',
      },
    ],
    expectedNotes: (adv) => {
      const found = adv.insights.some((i) => i.insight_id.includes('Food'));
      return found ? null : 'Expected Food drift to be surfaced in insights';
    },
  },
];

async function runEval() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(process.cwd(), 'eval-output', timestamp);
  fs.mkdirSync(outDir, { recursive: true });

  console.log('================================================================');
  console.log('             SPENDCOACH LLM EVALUATION HARNESS                  ');
  console.log('================================================================');
  console.log(`Evaluating 6 canned financial scenarios. Output directory: eval-output/${timestamp}/\n`);

  const apiKey = process.env.GROQ_API_KEY?.trim() || '';
  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  const model = process.env.LLM_MODEL || 'llama-3.3-70b-versatile';

  // Check if API key is actually authenticated with provider
  let isKeyValid = false;
  if (apiKey.length >= 16) {
    try {
      const pingRes = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(4000),
      });
      isKeyValid = pingRes.ok;
    } catch {
      isKeyValid = false;
    }
  }

  const executionMode = isKeyValid ? 'Real LLM (Groq API)' : 'Deterministic Fallback Engine (No Valid API Key)';
  console.log(`Execution Mode: ${executionMode}`);
  console.log(`Groq Key Verified: ${isKeyValid ? 'YES (Valid)' : 'NO (Unset or Invalid Authentication)'}\n`);

  let anyFallbackWhenKeyValid = false;
  let allScenariosPassed = true;

  for (const s of SCENARIOS) {
    console.log(`----------------------------------------------------------------`);
    console.log(`[SCENARIO ${s.id}/6] ${s.name} (${s.description})`);
    console.log(`----------------------------------------------------------------`);

    const engineOutput: EngineOutput = {
      evaluatedAt: '2026-10-20',
      coverage: {
        daysClosed: s.isLearningMode ? 5 : 20,
        weeksOfHistory: 12,
        categoriesReady: ['Food', 'Shopping', 'Entertainment'],
        categoriesLearning: [],
        reasons: [],
      },
      learning: {
        status: s.isLearningMode ? 'learning' : 'ready',
        expenseCount: s.isLearningMode ? 18 : 65,
        expenseThreshold: 30,
        distinctDaysCount: s.isLearningMode ? 5 : 20,
        distinctDaysThreshold: 14,
        expensesNeeded: s.isLearningMode ? 12 : 0,
        daysNeeded: s.isLearningMode ? 9 : 0,
        categories: {},
      },
      budgetRunRate: {
        spentSoFarPaise: s.allowance.discretionarySpentSoFarPaise,
        monthlyLimitPaise: s.allowance.monthlyIncomePaise - s.allowance.committedDuePaise - s.allowance.savingsTargetPaise,
        projectedMonthEndPaise: s.allowance.discretionarySpentSoFarPaise * 2,
        percentageUsed: Math.round((s.allowance.discretionarySpentSoFarPaise / (s.allowance.monthlyIncomePaise - s.allowance.committedDuePaise - s.allowance.savingsTargetPaise || 1)) * 100),
        projectedPercentage: 90,
        budgetStatus: s.allowance.verdict === 'over' ? 'warning' : 'on_track',
        categories: [],
      },
      allowance: s.allowance,
      insights: s.insights,
      trends: {
        last7DaysPaise: 0,
        prev7DaysPaise: 0,
        weekOverWeekPercent: 0,
        currentMonthToDatePaise: 0,
        prevMonthToDatePaise: 0,
        monthOverMonthPercent: 0,
        categories: [],
      },
      transactionAnomalies: [],
      dailyAnomalies: [],
      recurring: [],
      silentFlags: [],
    };

    let advice: DailyReviewAdviceV2;
    let source: 'llm' | 'fallback' = 'fallback';
    let tokenCounts = { prompt: 0, completion: 0, total: 0 };

    if (s.isLearningMode) {
      advice = generateLearningAdvice(engineOutput);
      source = 'fallback';
    } else if (isKeyValid) {
      const { payload, allowedNumbers, candidateInsightIds } =
        buildDailyReviewSummaryPayload(engineOutput, '2026-10-20');

      try {
        const response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: [
              {
                role: 'system',
                content:
                  'You are SpendCoach AI. Return strictly valid JSON with keys: verdict, why_it_matters, insights, one_action_tomorrow, win, mood. Do not invent numbers.',
              },
              { role: 'user', content: JSON.stringify(payload) },
            ],
            response_format: { type: 'json_object' },
            temperature: 0.3,
            max_tokens: 700,
          }),
          signal: AbortSignal.timeout(12000),
        });

        if (response.ok) {
          const respData = await response.json();
          const rawContent = respData.choices?.[0]?.message?.content || '{}';
          tokenCounts = {
            prompt: respData.usage?.prompt_tokens || 0,
            completion: respData.usage?.completion_tokens || 0,
            total: respData.usage?.total_tokens || 0,
          };
          const parsed = JSON.parse(rawContent);
          const validSchema = dailyReviewAdviceSchemaV2.safeParse(parsed);
          if (validSchema.success) {
            advice = validSchema.data;
            source = 'llm';
          } else {
            advice = generateFallbackAdvice(engineOutput);
            source = 'fallback';
          }
        } else {
          advice = generateFallbackAdvice(engineOutput);
          source = 'fallback';
        }
      } catch {
        advice = generateFallbackAdvice(engineOutput);
        source = 'fallback';
      }
    } else {
      advice = generateFallbackAdvice(engineOutput);
      source = 'fallback';
    }

    if (isKeyValid && !s.isLearningMode && source === 'fallback') {
      anyFallbackWhenKeyValid = true;
    }

    // Validation checks
    const schemaCheck = dailyReviewAdviceSchemaV2.safeParse(advice);
    const zodValid = schemaCheck.success;

    const { payload, allowedNumbers } = buildDailyReviewSummaryPayload(engineOutput, '2026-10-20');
    const guardrail = validateNumberGuardrail(advice as unknown as Record<string, unknown>, allowedNumbers);
    const zeroHallucination = guardrail.valid;

    const candidateIds = new Set(s.insights.map((i) => i.id));
    const validInsightIds = advice.insights.every((i) => candidateIds.has(i.insight_id));

    const adviceText = JSON.stringify(advice).toLowerCase();
    const foundMoralising = FORBIDDEN_MORALISING_PHRASES.filter((p) => adviceText.includes(p));
    const nonMoralising = foundMoralising.length === 0;

    const scenarioPassed = zodValid && zeroHallucination && validInsightIds && nonMoralising;
    if (!scenarioPassed) allScenariosPassed = false;

    console.log(`Source: ${source}`);
    console.log(`Tokens: prompt=${tokenCounts.prompt}, completion=${tokenCounts.completion}, total=${tokenCounts.total}`);
    console.log(`Full Advice JSON:`);
    console.log(JSON.stringify(advice, null, 2));
    console.log(`Validation:`);
    console.log(`  ✓ Schema valid (Zod): ${zodValid ? 'PASS' : 'FAIL'}`);
    console.log(`  ✓ Number guardrail (zero hallucination): ${zeroHallucination ? 'PASS' : 'FAIL'}`);
    console.log(`  ✓ Referenced insight IDs valid: ${validInsightIds ? 'PASS' : 'FAIL'}`);
    console.log(`  ✓ Tone check (non-moralising): ${nonMoralising ? 'PASS' : 'FAIL'}`);
    console.log(`Scenario Result: ${scenarioPassed ? 'PASS' : 'FAIL'}\n`);

    // Write artifact to disk
    fs.writeFileSync(
      path.join(outDir, `${s.id}_${s.slug}.json`),
      JSON.stringify(
        {
          scenario: s.name,
          slug: s.slug,
          source,
          tokenCounts,
          advice,
          validation: { zodValid, zeroHallucination, validInsightIds, nonMoralising, scenarioPassed },
        },
        null,
        2
      )
    );
  }

  console.log('================================================================');
  console.log(` EVALUATION SUMMARY: ${allScenariosPassed ? 'ALL 6 SCENARIOS PASSED' : 'SOME SCENARIOS FAILED'}`);
  console.log(` Artifacts saved to: eval-output/${timestamp}/`);
  console.log('================================================================\n');

  if (isKeyValid && anyFallbackWhenKeyValid) {
    console.error('FAIL: Groq API key is valid, but one or more scenarios returned fallback!');
    process.exit(1);
  }

  if (!allScenariosPassed) {
    process.exit(1);
  }

  process.exit(0);
}

runEval().catch((err) => {
  console.error('Fatal evaluation error:', err);
  process.exit(1);
});
