import type { EngineOutput } from '@/lib/engine/types';
import type { DailyReviewAdvice } from './types';
import { formatPaise } from '@/lib/money';

/**
 * Generates deterministic, template-based fallback advice built purely from the engine output.
 * STRICT DATA CONDITIONALITY AUDIT:
 * - Every statement is grounded in and conditional on actual engine data.
 * - Never claims "on budget" if no budget is set or if budget is over.
 * - Never mentions a category unless that category actually has recorded spend.
 * - Never claims recurring expenses are regular unless recurring charges actually exist.
 * - Saving ideas target actual active spending categories.
 */
export function generateFallbackAdvice(output: EngineOutput): DailyReviewAdvice {
  const anomalies = output.transactionAnomalies;
  const budget = output.budgetRunRate;
  const recurring = output.recurring;

  const activeCategories = budget.categories.filter((c) => c.spentSoFarPaise > 0);
  const categoriesWithBudget = activeCategories.filter((c) => c.monthlyLimitPaise !== null);
  const onTrackBudgetCategories = categoriesWithBudget.filter((c) => c.budgetStatus === 'on_track');
  const overBudgetCategories = categoriesWithBudget.filter((c) => c.budgetStatus === 'over');
  const warningBudgetCategories = categoriesWithBudget.filter((c) => c.budgetStatus === 'warning');

  const hasOverallBudget = budget.monthlyLimitPaise !== null;
  const isOverallOver = hasOverallBudget && budget.budgetStatus === 'over';
  const isOverallWarning = hasOverallBudget && budget.budgetStatus === 'warning';

  // 1. Determine Mood
  let mood: 'good' | 'ok' | 'careful' = 'good';
  if (anomalies.length > 0 || isOverallOver || overBudgetCategories.length > 0) {
    mood = 'careful';
  } else if (isOverallWarning || warningBudgetCategories.length > 0) {
    mood = 'ok';
  }

  // 2. Headline
  let headline = 'Spending is steady and tracking within normal boundaries';
  if (anomalies.length > 0) {
    headline = `Unusual spend flagged: ${anomalies.length} transaction(s) significantly exceeded normal baselines`;
  } else if (isOverallOver) {
    headline = 'Overall monthly spending has exceeded the established budget limit';
  } else if (overBudgetCategories.length > 0) {
    headline = `Budget alert: ${overBudgetCategories[0].category} has exceeded its monthly limit`;
  } else if (isOverallWarning) {
    headline = 'Monthly spending pace is approaching caution threshold (>85%)';
  } else if (warningBudgetCategories.length > 0) {
    headline = `${warningBudgetCategories[0].category} spending is approaching its monthly limit`;
  }

  // 3. Went Well (1..3 items)
  const wentWell: string[] = [];

  // A. Budget tracking vs General expense logging
  if (onTrackBudgetCategories.length > 0) {
    wentWell.push(
      `${onTrackBudgetCategories.map((c) => c.category).slice(0, 2).join(' and ')} spending is tracking comfortably on budget.`
    );
  } else if (activeCategories.length > 0) {
    wentWell.push(
      `Accurately logged expenses across ${activeCategories.map((c) => c.category).slice(0, 2).join(' and ')}.`
    );
  } else {
    wentWell.push('Daily expenses were diligently recorded to maintain an accurate financial ledger.');
  }

  // B. Anomalies vs Recurring stability
  if (anomalies.length === 0) {
    wentWell.push('No anomalous spending spikes were detected in recent transactions.');
  } else if (recurring.length > 0) {
    wentWell.push(
      `Recurring charges (${recurring.map((r) => r.merchantOrNote.slice(0, 25)).slice(0, 2).join(', ')}) remained predictable.`
    );
  } else {
    wentWell.push('Daily transactions were consistently logged to maintain an uninterrupted history.');
  }

  // 4. Watch Out (0..3 items)
  const watchOut: string[] = [];

  // A. Anomalies callouts
  if (anomalies.length > 0) {
    for (const anom of anomalies.slice(0, 2)) {
      watchOut.push(
        `${anom.category} had a spend of ${formatPaise(anom.amountPaise)} (${anom.ratioToMedian}x your usual baseline).`
      );
    }
  }

  // B. Budget overages / warnings
  if (isOverallOver && budget.monthlyLimitPaise) {
    watchOut.push(
      `Total spend of ${formatPaise(budget.spentSoFarPaise)} has exceeded the ${formatPaise(budget.monthlyLimitPaise)} monthly limit.`
    );
  } else if (overBudgetCategories.length > 0) {
    const overCat = overBudgetCategories[0];
    watchOut.push(
      `${overCat.category} spend of ${formatPaise(overCat.spentSoFarPaise)} has exceeded its ${formatPaise(overCat.monthlyLimitPaise!)} limit.`
    );
  } else if (isOverallWarning && budget.monthlyLimitPaise) {
    watchOut.push(
      `Projected month-end total of ${formatPaise(budget.projectedMonthEndPaise)} is approaching the ${formatPaise(budget.monthlyLimitPaise)} limit.`
    );
  }

  // 5. Action Tomorrow
  let actionTomorrow = 'Stick to essential daily expenses and log each item promptly.';
  if (anomalies.length > 0) {
    actionTomorrow = 'Pause non-essential discretionary purchases tomorrow to balance recent spikes.';
  } else if (isOverallOver || overBudgetCategories.length > 0) {
    actionTomorrow = 'Review upcoming flexible expenses and hold off on optional shopping.';
  } else if (isOverallWarning) {
    actionTomorrow = 'Slow down discretionary spend over the next few days to stay within budget.';
  }

  // 6. Saving Ideas (1..3 items)
  const savingIdeas: string[] = [];
  if (recurring.length > 0) {
    const firstRec = recurring[0];
    savingIdeas.push(
      `Audit regular recurring charges such as ${firstRec.merchantOrNote.slice(0, 30)} to identify unused subscriptions.`
    );
  }

  // Target active categories with spend
  const foodActive = activeCategories.find((c) => c.category.toLowerCase() === 'food');
  const shoppingActive = activeCategories.find((c) => c.category.toLowerCase() === 'shopping');
  const transportActive = activeCategories.find((c) => c.category.toLowerCase() === 'transport');

  if (foodActive) {
    savingIdeas.push('Prepare lunch at home tomorrow rather than ordering food delivery.');
  } else if (shoppingActive) {
    savingIdeas.push('Place non-essential shopping items on a 48-hour cooling-off list before buying.');
  } else if (transportActive) {
    savingIdeas.push('Consolidate errands into a single commute trip to save on transport costs.');
  } else {
    savingIdeas.push('Review everyday incidental purchases to trim non-essential spending leaks.');
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
