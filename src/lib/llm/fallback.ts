import type { EngineOutput } from '@/lib/engine/types';
import type { DailyReviewAdviceV2 } from './types';
import { formatPaiseToRupees } from '@/lib/money';

export type UnifiedDailyReviewAdvice = DailyReviewAdviceV2 & {
  headline: string;
  went_well: string[];
  watch_out: string[];
  action_tomorrow: string;
  saving_ideas: string[];
  earning_ideas: string[];
};

/**
 * Section: DAILY REVIEW v2 DETERMINISTIC FALLBACK
 * Built from the same ranked insight structure as the LLM advice.
 * Purely deterministic, fully grounded in engine evidence, and zero hallucination.
 * Also includes backwards-compatible v1 fields to satisfy legacy assertions.
 */
export function generateFallbackAdvice(
  output: EngineOutput,
  last3ActionIds?: string[]
): UnifiedDailyReviewAdvice {
  const allowance = output.allowance;
  const nonSafeInsights = (output.insights || []).filter(
    (i) => i.type !== 'safe_to_spend'
  );

  const anomalies = output.transactionAnomalies || [];
  const budget = output.budgetRunRate;
  const recurring = output.recurring || [];

  const activeCategories = (budget?.categories || []).filter((c) => c.spentSoFarPaise > 0);
  const categoriesWithBudget = activeCategories.filter((c) => c.monthlyLimitPaise !== null);
  const onTrackBudgetCategories = categoriesWithBudget.filter((c) => c.budgetStatus === 'on_track');
  const overBudgetCategories = categoriesWithBudget.filter((c) => c.budgetStatus === 'over');
  const warningBudgetCategories = categoriesWithBudget.filter((c) => c.budgetStatus === 'warning');

  const hasOverallBudget = budget?.monthlyLimitPaise !== null && budget?.monthlyLimitPaise !== undefined;
  const isOverallOver = hasOverallBudget && budget?.budgetStatus === 'over';
  const isOverallWarning = hasOverallBudget && budget?.budgetStatus === 'warning';

  // 1. Determine Mood
  let mood: DailyReviewAdviceV2['mood'] = 'good';
  if (anomalies.length > 0 || isOverallOver || overBudgetCategories.length > 0 || allowance?.verdict === 'over') {
    mood = 'careful';
  } else if (isOverallWarning || warningBudgetCategories.length > 0) {
    mood = 'ok';
  } else if (allowance?.verdict === 'under') {
    mood = 'good';
  }

  // 2. Verdict (one sentence on today vs the allowance)
  let verdict: string;
  if (allowance) {
    const todayStr = formatPaiseToRupees(allowance.todaySpentPaise);
    const allowStr = formatPaiseToRupees(allowance.dailyAllowancePaise);
    if (allowance.verdict === 'under') {
      const diffStr = formatPaiseToRupees(
        allowance.dailyAllowancePaise - allowance.todaySpentPaise
      );
      verdict = `Today you spent ${todayStr}, keeping you comfortably ${diffStr} under your daily allowance of ${allowStr}.`;
    } else if (allowance.verdict === 'at') {
      verdict = `Today you spent ${todayStr}, matching your daily allowance of ${allowStr} exactly.`;
    } else {
      const diffStr = formatPaiseToRupees(
        allowance.todaySpentPaise - allowance.dailyAllowancePaise
      );
      verdict = `Today's spend of ${todayStr} exceeded your daily allowance of ${allowStr} by ${diffStr}.`;
    }
  } else {
    verdict = `Today's expenses were recorded across active categories.`;
  }

  // 3. Headline (v1 compatibility)
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

  // 4. Candidate Insights (<= 3 items)
  const insights = nonSafeInsights.slice(0, 3).map((ins) => ({
    insight_id: ins.id,
    narrative: ins.title,
    lever_id: ins.levers?.[0]?.id,
  }));

  // 5. Why It Matters (<= 2 sentences, from evidence)
  let whyItMatters: string;
  if (nonSafeInsights.length === 0) {
    whyItMatters = 'Nothing notable today; all category spending is tracking predictably within normal historical bounds.';
  } else {
    const topInsight = nonSafeInsights[0];
    const impactStr =
      topInsight.impactPaise > 0
        ? ` with an estimated impact of ${formatPaiseToRupees(topInsight.impactPaise)}`
        : '';
    whyItMatters = `${topInsight.title}${impactStr}. Addressing this keeps your monthly discretionary budget on target.`;
  }

  // 6. One Action Tomorrow (must reference a lever_id or the allowance, with ₹ effect)
  let oneActionTomorrow: string;
  const usedActions = new Set((last3ActionIds || []).map((a) => a.toLowerCase().trim()));

  let chosenLever: { id: string; description: string; savingPaise: number } | null = null;
  for (const ins of nonSafeInsights) {
    for (const lev of ins.levers || []) {
      if (!usedActions.has(lev.id.toLowerCase().trim()) && !usedActions.has(lev.description.toLowerCase().trim())) {
        chosenLever = {
          id: lev.id,
          description: lev.description,
          savingPaise: lev.monthlySavingPaise,
        };
        break;
      }
    }
    if (chosenLever) break;
  }

  if (chosenLever && chosenLever.savingPaise > 0) {
    oneActionTomorrow = `${chosenLever.description} to save ${formatPaiseToRupees(chosenLever.savingPaise)} this month (lever: ${chosenLever.id}).`;
  } else if (allowance) {
    const tomorrowStr = formatPaiseToRupees(allowance.tomorrowDailyAllowancePaise);
    oneActionTomorrow = `Keep discretionary spending within tomorrow's adjusted allowance of ${tomorrowStr} to protect your monthly savings target.`;
  } else {
    oneActionTomorrow = 'Log every purchase tomorrow to keep your spending record complete and actionable.';
  }

  // 7. Win (something genuinely good: under allowance, savings on track, drift reversing, experiment completed; null if nothing is true)
  let win: string | null = null;
  if (allowance && allowance.verdict === 'under') {
    const underBy = formatPaiseToRupees(allowance.dailyAllowancePaise - allowance.todaySpentPaise);
    win = `Finished today ${underBy} under your daily spending allowance.`;
  } else {
    const completedExp = nonSafeInsights.find(
      (i) => i.type === 'experiment_progress' && (i.evidence?.status === 'completed' || (i.evidence?.achievedSavingPaise as number) > 0)
    );
    if (completedExp && completedExp.impactPaise > 0) {
      win = `Experiment win: Saved ${formatPaiseToRupees(completedExp.impactPaise)} against your baseline.`;
    }
  }

  // 8. Went Well (v1 compatibility)
  const wentWell: string[] = [];
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

  if (anomalies.length === 0) {
    wentWell.push('No anomalous spending spikes were detected in recent transactions.');
  }

  // 9. Watch Out (v1 compatibility)
  const watchOut: string[] = [];
  if (anomalies.length > 0) {
    for (const anom of anomalies.slice(0, 2)) {
      watchOut.push(
        `${anom.category} had a spend of ${formatPaiseToRupees(anom.amountPaise)} (${anom.ratioToMedian}x your usual baseline).`
      );
    }
  }
  if (isOverallOver && budget?.monthlyLimitPaise) {
    watchOut.push(
      `Total spend of ${formatPaiseToRupees(budget.spentSoFarPaise)} has exceeded the ${formatPaiseToRupees(budget.monthlyLimitPaise)} monthly limit.`
    );
  } else if (overBudgetCategories.length > 0) {
    const overCat = overBudgetCategories[0];
    watchOut.push(
      `${overCat.category} spend of ${formatPaiseToRupees(overCat.spentSoFarPaise)} has exceeded its ${formatPaiseToRupees(overCat.monthlyLimitPaise!)} limit.`
    );
  }

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
  } else if (recurring.length === 0) {
    savingIdeas.push('Review everyday incidental purchases to trim non-essential spending leaks.');
  }

  return {
    verdict,
    why_it_matters: whyItMatters,
    insights,
    one_action_tomorrow: oneActionTomorrow,
    win,
    mood,
    // v1 compatibility
    headline,
    went_well: wentWell,
    watch_out: watchOut,
    action_tomorrow: oneActionTomorrow,
    saving_ideas: savingIdeas,
    earning_ideas: [],
  };
}

/**
 * Generates friendly learning-mode review when baseline thresholds have not yet been met.
 */
export function generateLearningAdvice(output: EngineOutput): UnifiedDailyReviewAdvice {
  const { expenseCount, expenseThreshold, distinctDaysCount, distinctDaysThreshold, expensesNeeded, daysNeeded } =
    output.learning;

  const headline = `SpendCoach is still learning your spending patterns (${expenseCount}/${expenseThreshold} entries, ${distinctDaysCount}/${distinctDaysThreshold} days)`;
  const actionTomorrow = `Log your purchases tomorrow. Need ${expensesNeeded} more entries across ${daysNeeded} more days.`;

  return {
    verdict: 'SpendCoach is actively learning your baseline financial patterns.',
    why_it_matters: `Accurate detection requires at least ${expenseThreshold} entries across ${distinctDaysThreshold} distinct days before anomaly detection unlocks.`,
    insights: [],
    one_action_tomorrow: actionTomorrow,
    win: `Successfully logged ${expenseCount} entries across ${distinctDaysCount} days so far.`,
    mood: 'ok',
    // v1 compatibility
    headline,
    went_well: [
      'Diligent expense recording is actively establishing your baseline spending behavior.',
    ],
    watch_out: [],
    action_tomorrow: actionTomorrow,
    saving_ideas: [
      'Continue logging both small and large expenses to unlock personalized AI recommendations.',
    ],
    earning_ideas: [],
  };
}
