import type { Insight, InsightLogEntry } from './types';
import { daysDifference } from './math';

export interface RankOptions {
  monthlyIncomePaise?: number;
  insightLogs?: InsightLogEntry[];
  now: string;
}

const MINIMUM_SCORE_BAR = 0.04;

export function extractInsightTypeAndCategory(
  id: string,
  type: string,
  evidence?: Record<string, unknown>
): { type: string; category?: string } {
  if (evidence && typeof evidence.category === 'string') {
    return { type, category: evidence.category };
  }
  const parts = id.split(':');
  if (parts.length >= 2 && parts[1]) {
    return { type: parts[0] || type, category: parts[1] };
  }
  return { type };
}

/**
 * Checks if an insight is suppressed by user feedback.
 * "Not useful / Already know / Planned" suppresses that insight type + category for 14 days.
 * 3 "Not useful" in a row for that type + category suppresses for 60 days.
 */
export function isFeedbackSuppressed(
  insight: Insight,
  insightLogs: InsightLogEntry[],
  now: string
): boolean {
  const { type, category } = extractInsightTypeAndCategory(
    insight.id,
    insight.type,
    insight.evidence
  );

  // Filter logs for this (type, category) or exact id with feedback
  const feedbackLogs = insightLogs.filter((l) => {
    if (!l.feedback) return false;
    if (
      l.feedback !== 'not_useful' &&
      l.feedback !== 'already_know' &&
      l.feedback !== 'planned'
    ) {
      return false;
    }
    if (l.insightKey === insight.id) return true;
    const logMeta = extractInsightTypeAndCategory(l.insightKey, '');
    if (
      category &&
      logMeta.category === category &&
      (logMeta.type === type || logMeta.type === insight.type)
    ) {
      return true;
    }
    return false;
  });

  if (feedbackLogs.length === 0) return false;

  // Sort descending by timestamp (updatedAt || lastShown || firstShown)
  feedbackLogs.sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.lastShown || a.firstShown).getTime();
    const timeB = new Date(b.updatedAt || b.lastShown || b.firstShown).getTime();
    return timeB - timeA;
  });

  const latest = feedbackLogs[0];
  const rawDate = latest.updatedAt || latest.lastShown || latest.firstShown;
  const latestDateStr =
    typeof rawDate === 'string'
      ? rawDate.slice(0, 10)
      : rawDate.toISOString().slice(0, 10);

  const daysSince = Math.max(0, daysDifference(now, latestDateStr));

  // Check if 3 "not_useful" in a row
  let consecutiveNotUseful = 0;
  for (const l of feedbackLogs) {
    if (l.feedback === 'not_useful') {
      consecutiveNotUseful++;
    } else {
      break;
    }
  }

  const windowDays = consecutiveNotUseful >= 3 ? 60 : 14;
  return daysSince < windowDays;
}

/**
 * Section 3: RANKING & MEMORY
 * Score = normalised_impact * confidence * actionable_weight * novelty.
 * Suppresses insights shown in the last 3 days unless impact grew >= 25%.
 * Returns the top 3 ranked insights plus the always-present SAFE_TO_SPEND.
 * If nothing clears the bar, returns empty (never pads).
 */
export function rankAndFilterInsights(
  candidateInsights: Insight[],
  options: RankOptions
): {
  topInsights: Insight[];
  allRankedInsights: Insight[];
} {
  const { now, monthlyIncomePaise = 5000000, insightLogs = [] } = options;

  // Build lookup map for logs
  const logMap = new Map<string, InsightLogEntry>();
  for (const log of insightLogs) {
    logMap.set(log.insightKey, log);
  }

  // Separate safe_to_spend insight (always included if present)
  let safeToSpendInsight: Insight | null = null;
  const nonSafeCandidates: Insight[] = [];

  for (const ins of candidateInsights) {
    if (ins.type === 'safe_to_spend') {
      safeToSpendInsight = ins;
    } else {
      nonSafeCandidates.push(ins);
    }
  }

  // Score each candidate
  const scoredInsights: Insight[] = [];

  for (const ins of nonSafeCandidates) {
    // 1. Normalised Impact (0.05 to 1.0 based on monthly income baseline)
    const normalisedImpact = Math.min(
      1.0,
      Math.max(0.05, ins.impactPaise / monthlyIncomePaise)
    );

    // 2. Confidence (0.0 to 1.0)
    const confidence = Math.max(0.1, Math.min(1.0, ins.confidence));

    // 3. Actionable Weight (bonus for actionable items, drift, small leaks)
    let actionableWeight = ins.actionable ? 1.2 : 0.8;
    if (ins.type === 'drift') {
      actionableWeight *= 1.4; // Drift gets a higher rank weight than single spikes
    } else if (ins.type === 'small_leaks') {
      actionableWeight *= 1.2;
    }

    // 4. Novelty calculation from memory log & feedback learning
    const log = logMap.get(ins.id);
    let novelty = 1.0;

    if (isFeedbackSuppressed(ins, insightLogs, now)) {
      novelty = 0.0;
    } else if (log) {
      if (log.dismissed || log.feedback === 'not_now') {
        novelty = 0.0; // suppressed
      } else {
        const lastShownStr =
          typeof log.lastShown === 'string'
            ? log.lastShown.slice(0, 10)
            : log.lastShown.toISOString().slice(0, 10);
        const daysSinceShown = Math.max(0, daysDifference(now, lastShownStr));

        if (daysSinceShown >= 1 && daysSinceShown <= 3) {
          // Shown on a previous day in the last 3 days: suppressed UNLESS impact grew >= 25%
          if (
            log.lastImpactPaise &&
            log.lastImpactPaise > 0 &&
            ins.impactPaise >= log.lastImpactPaise * 1.25
          ) {
            novelty = 0.8; // Re-surface on significant growth!
          } else {
            novelty = 0.0; // Suppressed
          }
        } else if (daysSinceShown > 3) {
          // Decays smoothly if shown repeatedly in the past
          novelty = Math.max(0.3, 1.0 - log.timesShown * 0.15);
        } else {
          // Same day (daysSinceShown === 0): active for today's session
          novelty = 1.0;
        }
      }
    }

    const score = normalisedImpact * confidence * actionableWeight * novelty;

    // Attach computed score
    const scoredIns: Insight = {
      ...ins,
      score: Math.round(score * 1000) / 1000,
    };

    if (score >= MINIMUM_SCORE_BAR) {
      scoredInsights.push(scoredIns);
    }
  }

  // Helper to check if an insight represents a possible duplicate charge
  const isDuplicateInsight = (ins: Insight) => {
    const ev = ins.evidence as Record<string, unknown> | undefined;
    return (
      ev?.classification === 'possible_duplicate' ||
      ev?.isDuplicate === true ||
      ins.id.includes('duplicate') ||
      ins.title.toLowerCase().includes('possible duplicate')
    );
  };

  const duplicateInsights: Insight[] = [];
  const otherScoredInsights: Insight[] = [];

  for (const ins of scoredInsights) {
    if (isDuplicateInsight(ins)) {
      duplicateInsights.push(ins);
    } else {
      otherScoredInsights.push(ins);
    }
  }

  // Duplicate insights rank immediately after safe_to_spend regardless of impact
  duplicateInsights.sort((a, b) => (b.score || 0) - (a.score || 0));
  otherScoredInsights.sort((a, b) => (b.score || 0) - (a.score || 0));

  const allRanked = [...duplicateInsights, ...otherScoredInsights];

  // Take top 3 non-safe insights
  const top3 = allRanked.slice(0, 3);

  // Always prepend SAFE_TO_SPEND if available, followed immediately by duplicates
  const topInsights: Insight[] = [];
  if (safeToSpendInsight) {
    topInsights.push(safeToSpendInsight);
  }
  topInsights.push(...top3);

  return {
    topInsights,
    allRankedInsights: allRanked,
  };
}
