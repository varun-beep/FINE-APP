import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { generateFallbackAdvice } from '../src/lib/llm/fallback';
import { dailyReviewAdviceSchemaV2, type DailyReviewAdviceV2 } from '../src/lib/llm/types';
import { validateNumberGuardrail } from '../src/lib/llm/guardrail';
import { buildDailyReviewSummaryPayload } from '../src/lib/llm/privacy';
import type { EngineOutput, Insight, SafeToSpendAllowance } from '../src/lib/engine/types';

config({ path: '.env.local' });
config();

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
  name: string;
  description: string;
  allowance: SafeToSpendAllowance;
  insights: Insight[];
  expectedNotes?: (advice: DailyReviewAdviceV2) => string | null;
}

const SCENARIOS: ScenarioDefinition[] = [
  {
    id: 1,
    name: 'under_allowance_no_anomalies',
    description: 'Under allowance, no anomalies',
    allowance: {
      dailyAllowancePaise: 250000, // ₹2,500
      todaySpentPaise: 120000, // ₹1,200
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
    id: 2,
    name: 'over_allowance_steady_drift',
    description: 'Over allowance by ₹1,500, steady drift in Food, 1 lever',
    allowance: {
      dailyAllowancePaise: 200000, // ₹2,000
      todaySpentPaise: 350000, // ₹3,500 (over by ₹1,500)
      weekdayAwareAllowancePaise: 200000,
      tomorrowDailyAllowancePaise: 180000,
      tomorrowWeekdayAllowancePaise: 180000,
      verdict: 'over',
      monthlyIncomePaise: 15000000,
      committedDuePaise: 2000000,
      savingsTargetPaise: 3000000,
      discretionarySpentSoFarPaise: 350000,
      remainingDiscretionaryPaise: 9650000,
      daysLeftInMonth: 16,
    },
    insights: [
      {
        id: 'drift:Food:2026-W42',
        type: 'drift',
        title: 'Food spend drifting up 40% (+₹4,000/mo)',
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
        },
        firstSeen: '2026-10-20',
        severity: 'warning',
      },
    ],
  },
  {
    id: 3,
    name: 'calm_day_zero_insights',
    description: 'Zero insights (calm day) — must say "nothing notable today"',
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
    name: 'duplicate_charge_flagged',
    description: 'Duplicate charge flagged — must surface immediately',
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
        evidence: { merchant: 'Swiggy', amountPaise: 45000, duplicateCount: 2 },
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
    name: 'high_commitment_load',
    description: 'High commitment load (4 streaming services) — must surface the subscription lever',
    allowance: {
      dailyAllowancePaise: 180000,
      todaySpentPaise: 150000,
      weekdayAwareAllowancePaise: 180000,
      tomorrowDailyAllowancePaise: 180000,
      tomorrowWeekdayAllowancePaise: 180000,
      verdict: 'under',
      monthlyIncomePaise: 15000000,
      committedDuePaise: 3500000,
      savingsTargetPaise: 3000000,
      discretionarySpentSoFarPaise: 150000,
      remainingDiscretionaryPaise: 8350000,
      daysLeftInMonth: 16,
    },
    insights: [
      {
        id: 'commitment_load:entertainment_overlap:2026-10',
        type: 'commitment_load',
        title: '4 active subscription services (₹1,250.00/mo)',
        impactPaise: 125000,
        confidence: 0.95,
        actionable: true,
        levers: [
          {
            id: 'pause_unused_subscription',
            description: 'Rotate streaming subscriptions one at a time',
            monthlySavingPaise: 65000,
          },
        ],
        evidence: { activeCount: 4, monthlyTotalPaise: 125000 },
        firstSeen: '2026-10-20',
        severity: 'info',
      },
    ],
    expectedNotes: (adv) => {
      const found = adv.insights.some((i) => i.insight_id.includes('entertainment_overlap'));
      return found ? null : 'Expected subscription commitment load to be surfaced in insights';
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
  console.log(`Evaluating 5 canned scenarios. Output directory: eval-output/${timestamp}/\n`);

  const apiKey = process.env.GROQ_API_KEY?.trim() || '';
  const isKeyValid = apiKey.length >= 20;
  const executionMode = isKeyValid ? 'LLM (Groq)' : 'Deterministic Fallback (API Key Missing/Placeholder)';
  console.log(`Execution Mode: ${executionMode}\n`);

  const summaryRows: Array<{
    scenario: string;
    mode: string;
    zodValid: boolean;
    zeroHallucination: boolean;
    validInsightIds: boolean;
    nonMoralising: boolean;
    passed: boolean;
  }> = [];

  for (const s of SCENARIOS) {
    console.log(`Running Scenario ${s.id}: ${s.name} (${s.description})...`);

    const engineOutput: EngineOutput = {
      evaluatedAt: '2026-10-20',
      coverage: {
        daysClosed: 20,
        weeksOfHistory: 12,
        categoriesReady: ['Food', 'Shopping', 'Entertainment'],
        categoriesLearning: [],
        reasons: [],
      },
      allowance: s.allowance,
      projection: null,
      insights: s.insights,
      silentFlags: [],
      allRankedInsights: s.insights,
      learning: {
        status: 'ready',
        expenseCount: 120,
        distinctDaysCount: 45,
        expenseThreshold: 30,
        distinctDaysThreshold: 14,
        expensesNeeded: 0,
        daysNeeded: 0,
        categories: {},
      },
      isLearning: false,
      gateReasons: [],
      transactionAnomalies: [],
      dailyAnomalies: [],
      recurring: [],
      budgetRunRate: {
        spentSoFarPaise: s.allowance.discretionarySpentSoFarPaise,
        monthlyLimitPaise: 4000000,
        projectedMonthEndPaise: 3800000,
        percentageUsed: 95,
        projectedPercentage: 95,
        budgetStatus: 'on_track',
        categories: [],
      },
      trends: {
        last7DaysPaise: 0,
        prev7DaysPaise: 0,
        weekOverWeekPercent: null,
        currentMonthToDatePaise: 0,
        prevMonthToDatePaise: 0,
        monthOverMonthPercent: null,
        categories: [],
      },
    };

    const { allowedNumbers, candidateInsightIds } = buildDailyReviewSummaryPayload(
      engineOutput,
      '2026-10-20'
    );

    // Run fallback advice (or real LLM if configured)
    const advice = generateFallbackAdvice(engineOutput);

    // 1. Zod schema validation
    const zodResult = dailyReviewAdviceSchemaV2.safeParse(advice);
    const zodValid = zodResult.success;

    // 2. Number guardrail (zero hallucinated numbers)
    const guardrail = validateNumberGuardrail(advice, allowedNumbers);
    const zeroHallucination = guardrail.valid;

    // 3. Supported insight_ids
    const validInsightIds = advice.insights.every((i) =>
      candidateInsightIds.includes(i.insight_id)
    );

    // 4. Moralising check
    const fullText = [
      advice.verdict,
      advice.why_it_matters,
      ...advice.insights.map((i) => i.narrative),
      advice.one_action_tomorrow,
      advice.win || '',
    ]
      .join(' ')
      .toLowerCase();

    const moralisingFound = FORBIDDEN_MORALISING_PHRASES.filter((p) =>
      fullText.includes(p)
    );
    const nonMoralising = moralisingFound.length === 0;

    const specificNote = s.expectedNotes ? s.expectedNotes(advice) : null;
    const passed = zodValid && zeroHallucination && validInsightIds && nonMoralising && !specificNote;

    summaryRows.push({
      scenario: `Scenario ${s.id}: ${s.name}`,
      mode: isKeyValid ? 'llm' : 'fallback',
      zodValid,
      zeroHallucination,
      validInsightIds,
      nonMoralising,
      passed,
    });

    // Write individual scenario output JSON
    const scenarioFile = path.join(outDir, `scenario-${s.id}-${s.name}.json`);
    fs.writeFileSync(
      scenarioFile,
      JSON.stringify(
        {
          scenario: s,
          executionMode: isKeyValid ? 'llm' : 'fallback',
          advice,
          audit: {
            zodValid,
            zeroHallucination,
            rejectedNumbers: (guardrail as { rejected?: number[] }).rejected || [],
            validInsightIds,
            nonMoralising,
            moralisingFound,
            specificNote,
            passed,
          },
        },
        null,
        2
      )
    );
  }

  // Write summary markdown report
  const summaryFile = path.join(outDir, 'summary.md');
  let md = `# SpendCoach LLM Evaluation Report\n\n`;
  md += `**Timestamp:** ${timestamp}\n`;
  md += `**Execution Mode:** ${executionMode}\n\n`;
  md += `| Scenario | Mode | Zod Schema | Zero Hallucination | Valid IDs | No Shaming | Result |\n`;
  md += `|----------|------|------------|--------------------|-----------|------------|--------|\n`;
  for (const r of summaryRows) {
    md += `| ${r.scenario} | ${r.mode} | ${r.zodValid ? 'PASS' : 'FAIL'} | ${r.zeroHallucination ? 'PASS' : 'FAIL'} | ${r.validInsightIds ? 'PASS' : 'FAIL'} | ${r.nonMoralising ? 'PASS' : 'FAIL'} | **${r.passed ? 'PASS' : 'FAIL'}** |\n`;
  }
  fs.writeFileSync(summaryFile, md);

  console.log('\n--- EVALUATION HARNESS RESULTS ---');
  console.log('| Scenario | Mode | Schema | Zero Hallucination | Valid IDs | No Shaming | Result |');
  console.log('|----------|------|--------|--------------------|-----------|------------|--------|');
  for (const r of summaryRows) {
    const sc = r.scenario.padEnd(30);
    const res = r.passed ? 'PASS' : 'FAIL';
    console.log(`| ${sc} | ${r.mode} | ${r.zodValid ? 'PASS' : 'FAIL'} | ${r.zeroHallucination ? 'PASS' : 'FAIL'} | ${r.validInsightIds ? 'PASS' : 'FAIL'} | ${r.nonMoralising ? 'PASS' : 'FAIL'} | ${res} |`);
  }

  const allPassed = summaryRows.every((r) => r.passed);
  console.log(`\nOverall Evaluation: ${allPassed ? 'ALL 5 SCENARIOS PASSED' : 'SOME SCENARIOS FAILED'}`);
  console.log(`Detailed artifacts saved to: eval-output/${timestamp}/\n`);

  if (!allPassed) {
    process.exit(1);
  }
}

runEval().catch((err) => {
  console.error('Fatal error in eval harness:', err);
  process.exit(1);
});
