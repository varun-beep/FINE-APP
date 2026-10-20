import type { EngineExperiment, EngineExpense, Insight } from './types';
import { daysDifference } from './math';
import { formatPaiseToRupees } from '../money';

/**
 * Section: EXPERIMENT PROGRESS TRACKER
 * Generates an EXPERIMENT_PROGRESS insight for each active or completed experiment.
 * On completion, surfaces achieved saving vs baseline saving.
 */
export function generateExperimentProgressInsights(
  experiments: EngineExperiment[],
  expenses: EngineExpense[],
  now: string
): Insight[] {
  const insights: Insight[] = [];

  for (const exp of experiments) {
    if (exp.status === 'abandoned') continue;

    // Relevant date range
    const periodEnd = exp.endDate < now ? exp.endDate : now;

    // Filter relevant category expenses within experiment timeframe
    const matchingExpenses = expenses.filter((e) => {
      if (e.category !== exp.category) return false;
      if (e.spentOn < exp.startDate || e.spentOn > periodEnd) return false;
      if (e.kind && e.kind !== 'spend') return false;
      return true;
    });

    const isCountMetric =
      exp.metric.toLowerCase().includes('count') ||
      exp.metric.toLowerCase().includes('order');

    const actual = isCountMetric
      ? matchingExpenses.length
      : matchingExpenses.reduce((sum, e) => sum + e.amountPaise, 0);

    const totalDays = Math.max(1, daysDifference(exp.endDate, exp.startDate) + 1);
    const daysElapsed = Math.min(
      totalDays,
      Math.max(1, daysDifference(now, exp.startDate) + 1)
    );
    const fractionElapsed = Math.min(1.0, daysElapsed / totalDays);

    const proRatedBaseline = Math.round(exp.baseline * fractionElapsed);
    const isCompleted = now >= exp.endDate || exp.status === 'completed';
    const daysRemaining = isCompleted
      ? 0
      : Math.max(0, daysDifference(exp.endDate, now));

    const baselineForDiff = isCompleted ? exp.baseline : proRatedBaseline;
    const achievedSaving = Math.max(0, baselineForDiff - actual);

    let title: string;
    if (isCompleted) {
      if (isCountMetric) {
        title = `Experiment Completed: ${exp.category} (${actual} vs ${exp.baseline} baseline)`;
      } else {
        title = `Experiment Completed: ${exp.category} (${formatPaiseToRupees(achievedSaving)} saved vs baseline)`;
      }
    } else {
      if (isCountMetric) {
        title = `Experiment Progress: ${exp.category} (${actual}/${exp.target}, ${daysRemaining} days left)`;
      } else {
        title = `Experiment Progress: ${exp.category} (${formatPaiseToRupees(actual)} spent, ${daysRemaining} days left)`;
      }
    }

    insights.push({
      id: `experiment_progress:${exp.id}`,
      type: 'experiment_progress',
      title,
      impactPaise: isCountMetric ? 0 : achievedSaving,
      confidence: 0.9,
      actionable: true,
      levers: [
        {
          id: exp.leverId,
          description: `Maintain experiment: ${exp.target}`,
          monthlySavingPaise: isCountMetric ? 0 : achievedSaving,
        },
      ],
      evidence: {
        experimentId: exp.id,
        category: exp.category,
        metric: exp.metric,
        target: exp.target,
        baseline: exp.baseline,
        actual,
        achievedSavingPaise: achievedSaving,
        daysRemaining,
        status: isCompleted ? 'completed' : 'active',
      },
      firstSeen: exp.startDate,
      severity: actual > baselineForDiff ? 'warning' : 'info',
    });
  }

  return insights;
}
