import type { EngineOutput } from '@/lib/engine/types';
import type { DailyReviewAdvice } from './types';
import { formatPaise } from '@/lib/money';

/**
 * Generates deterministic, template-based fallback advice built purely from the engine output.
 * Guaranteed to satisfy dailyReviewAdviceSchema without calling any external network or LLM.
 */
export function generateFallbackAdvice(output: EngineOutput): DailyReviewAdvice {
  const anomalies = output.transactionAnomalies;
  const budget = output.budgetRunRate;
  const recurring = output.recurring;

  // 1. Determine Mood
  let mood: 'good' | 'ok' | 'careful' = 'good';
  if (anomalies.length > 0 || budget.budgetStatus === 'over') {
    mood = 'careful';
  } else if (budget.budgetStatus === 'warning') {
    mood = 'ok';
  }

  // 2. Headline
  let headline = 'Spending is steady and tracking within normal boundaries';
  if (anomalies.length > 0) {
    headline = `Unusual spend flagged: ${anomalies.length} transaction(s) significantly exceeded normal baselines`;
  } else if (budget.budgetStatus === 'over') {
    headline = 'Overall monthly spending has exceeded the established budget limit';
  } else if (budget.budgetStatus === 'warning') {
    headline = 'Monthly spending pace is approaching caution threshold (>85%)';
  }

  // 3. Went Well (1..3 items)
  const wentWell: string[] = [];
  const onTrackCategories = budget.categories
    .filter((c) => c.budgetStatus === 'on_track' && c.spentSoFarPaise > 0)
    .map((c) => c.category);

  if (onTrackCategories.length > 0) {
    wentWell.push(
      `${onTrackCategories.slice(0, 2).join(' and ')} spending is tracking comfortably on budget.`
    );
  } else {
    wentWell.push('Daily expenses were diligently logged to maintain an accurate financial record.');
  }

  if (anomalies.length === 0) {
    wentWell.push('No anomalous spending spikes were detected in recent transactions.');
  } else {
    wentWell.push('Routine recurring expenses remained regular and predictable.');
  }

  // 4. Watch Out (0..3 items)
  const watchOut: string[] = [];
  if (anomalies.length > 0) {
    for (const anom of anomalies.slice(0, 2)) {
      watchOut.push(
        `${anom.category} had a spend of ${formatPaise(anom.amountPaise)} (${anom.ratioToMedian}x your usual baseline).`
      );
    }
  }

  if (budget.budgetStatus === 'over' && budget.monthlyLimitPaise) {
    watchOut.push(
      `Total spend of ${formatPaise(budget.spentSoFarPaise)} has exceeded the ${formatPaise(budget.monthlyLimitPaise)} monthly limit.`
    );
  } else if (budget.budgetStatus === 'warning') {
    watchOut.push(
      `Projected month-end total of ${formatPaise(budget.projectedMonthEndPaise)} is near your limit.`
    );
  }

  // 5. Action Tomorrow
  let actionTomorrow = 'Stick to essential daily expenses and log each item promptly.';
  if (anomalies.length > 0) {
    actionTomorrow = 'Pause non-essential discretionary purchases tomorrow to balance recent spikes.';
  } else if (budget.budgetStatus === 'over') {
    actionTomorrow = 'Review upcoming flexible expenses and hold off on optional shopping.';
  }

  // 6. Saving Ideas (1..3 items)
  const savingIdeas: string[] = [];
  if (recurring.length > 0) {
    const firstRec = recurring[0];
    savingIdeas.push(
      `Audit regular recurring charges such as ${firstRec.merchantOrNote.slice(0, 30)} to identify unused subscriptions.`
    );
  } else {
    savingIdeas.push('Prepare lunch at home tomorrow rather than ordering food delivery.');
  }

  // 7. Earning Ideas (0..2 items)
  const earningIdeas: string[] = [
    'List unused household items or pre-owned gadgets on online marketplaces.',
  ];

  return {
    headline,
    went_well: wentWell.slice(0, 3),
    watch_out: watchOut.slice(0, 3),
    action_tomorrow: actionTomorrow,
    saving_ideas: savingIdeas.slice(0, 3),
    earning_ideas: earningIdeas.slice(0, 2),
    mood,
  };
}

/**
 * Generates friendly learning-mode result when baseline thresholds have not yet been met.
 */
export function generateLearningAdvice(output: EngineOutput): DailyReviewAdvice {
  const { expenseCount, expenseThreshold, distinctDaysCount, distinctDaysThreshold, expensesNeeded, daysNeeded } =
    output.learning;

  return {
    headline: `SpendCoach is still learning your spending patterns (${expenseCount}/${expenseThreshold} entries, ${distinctDaysCount}/${distinctDaysThreshold} days)`,
    went_well: [
      'Diligent expense recording is actively establishing your baseline spending behavior.',
    ],
    watch_out: [],
    action_tomorrow: `Log your daily expenses tomorrow. Need ${expensesNeeded} more entries and ${daysNeeded} more days of history.`,
    saving_ideas: [
      'Continue logging both small and large expenses to unlock personalized AI recommendations.',
    ],
    earning_ideas: [],
    mood: 'ok',
  };
}
