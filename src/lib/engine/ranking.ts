import type { Insight, InsightLogEntry } from './types';
import { daysDifference } from './math';

export interface RankOptions {
  monthlyIncomePaise?: number;
  insightLogs?: InsightLogEntry[];
  now: string;
}

const MINIMUM_SCORE_BAR = 0.04;

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

    // 4. Novelty calculation from memory log
    const log = logMap.get(ins.id);
    let novelty = 1.0;

    if (log) {
      // If user dismissed or clicked "not now" / "not useful" / "planned"
      if (log.dismissed || log.feedback === 'not_now' || log.feedback === 'not_useful' || log.feedback === 'planned') {
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
          novelty = Math.max(0.3, 1.0 - (log.timesShown * 0.15));
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

  // Sort descending by score
  scoredInsights.sort((a, b) => (b.score || 0) - (a.score || 0));

  // Take top 3 non-safe insights
  const top3 = scoredInsights.slice(0, 3);

  // Always prepend SAFE_TO_SPEND if available
  const topInsights: Insight[] = [];
  if (safeToSpendInsight) {
    topInsights.push(safeToSpendInsight);
  }
  topInsights.push(...top3);

  return {
    topInsights,
    allRankedInsights: scoredInsights,
  };
}
