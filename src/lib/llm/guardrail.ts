import type { DailyReviewAdviceV2 } from './types';

export interface GuardrailValidationResult {
  valid: boolean;
  unsupportedNumbers: number[];
  reason?: string;
}

/**
 * Extracts all numeric values from text (including Indian format e.g. 1,23,456.50).
 */
export function extractNumbersFromText(text: string): number[] {
  const numbers: number[] = [];

  // Match numbers with possible commas, decimals, or currency prefixes
  // Matches e.g. ₹4,850, 136.6x, 46%, 79,900
  const regex = /(?:₹|Rs\.?|INR)?\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d+)?|\d+(?:\.\d+)?)/gi;

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[1]) {
      const cleanStr = match[1].replace(/,/g, '');
      const parsed = parseFloat(cleanStr);
      if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
        numbers.push(parsed);
      }
    }
  }

  return numbers;
}

/**
 * Checks if a candidate number is present in or derivable by simple rounding from the allowed numbers.
 */
export function isNumberAllowed(
  num: number,
  allowedSet: Set<number>,
  allowedList: number[]
): boolean {
  // 1. Trivial structural numbers in advice (e.g., "₹0", "1 action", "2 ways", "step 1", "3 items", "7 days", "14 days", "30 days")
  if (
    num === 0 ||
    num === 1 ||
    num === 2 ||
    num === 3 ||
    num === 4 ||
    num === 5 ||
    num === 7 ||
    num === 14 ||
    num === 28 ||
    num === 30 ||
    num === 31
  ) {
    return true;
  }

  // 2. Exact match
  if (allowedSet.has(num)) {
    return true;
  }

  const roundedNum = Math.round(num);
  const floorNum = Math.floor(num);
  if (allowedSet.has(roundedNum) || allowedSet.has(floorNum)) {
    return true;
  }

  // 3. Simple rounding/derivation check against any allowed number
  for (const allowed of allowedList) {
    if (allowed <= 0) continue;

    // Small absolute difference (e.g. 19.4 vs 19 or 20)
    if (Math.abs(num - allowed) <= 1.0) {
      return true;
    }

    // Relative rounding difference within 5% (e.g. 4850 rounded to 4900, 79900 rounded to 80000)
    const relDiff = Math.abs(num - allowed) / allowed;
    if (relDiff <= 0.05) {
      return true;
    }

    // Rounded to nearest 100 or 1000
    if (allowed > 500) {
      const round100Allowed = Math.round(allowed / 100) * 100;
      const round1000Allowed = Math.round(allowed / 1000) * 1000;
      if (
        Math.round(num) === round100Allowed ||
        Math.round(num) === round1000Allowed
      ) {
        return true;
      }
    }

    // Thousands derivation (e.g. ₹79.9k or 80k for 79,900; 4.85k or 5k for 4,850; 0.6k for 649)
    if (allowed >= 500) {
      const inThousands = allowed / 1000;
      if (
        Math.abs(num - inThousands) <= 0.2 ||
        Math.round(num) === Math.round(inThousands) ||
        Math.abs(num - Math.round(inThousands)) <= 1
      ) {
        return true;
      }
    }

    // Lakhs derivation (e.g. ₹0.8L or 0.79L for 79,900)
    if (allowed >= 10000) {
      const inLakhs = allowed / 100000;
      if (
        Math.abs(num - inLakhs) <= 0.05 ||
        Number(num.toFixed(1)) === Number(inLakhs.toFixed(1))
      ) {
        return true;
      }
    }
  }

  return false;
}

/**
 * NUMBER GUARDRAIL:
 * Extracts every number mentioned in the LLM advice fields and verifies that each appears
 * in (or is derivable by simple rounding from) the input summary.
 * If any number is unsupported, treats the output as invalid.
 */
export function validateNumberGuardrail(
  advice: Record<string, unknown>,
  allowedNumbers: number[]
): GuardrailValidationResult {
  const allowedSet = new Set(allowedNumbers);

  const textCorpusParts: string[] = [];

  // v2 fields
  if (typeof advice.verdict === 'string') textCorpusParts.push(advice.verdict);
  if (typeof advice.why_it_matters === 'string')
    textCorpusParts.push(advice.why_it_matters);
  if (Array.isArray(advice.insights)) {
    for (const ins of advice.insights) {
      if (ins && typeof ins === 'object' && typeof (ins as Record<string, unknown>).narrative === 'string') {
        textCorpusParts.push((ins as Record<string, unknown>).narrative as string);
      }
    }
  }
  if (typeof advice.one_action_tomorrow === 'string')
    textCorpusParts.push(advice.one_action_tomorrow);
  if (typeof advice.win === 'string') textCorpusParts.push(advice.win);

  // v1 backwards-compatible fields
  if (typeof advice.headline === 'string') textCorpusParts.push(advice.headline);
  if (Array.isArray(advice.went_well)) textCorpusParts.push(...advice.went_well.filter((x): x is string => typeof x === 'string'));
  if (Array.isArray(advice.watch_out)) textCorpusParts.push(...advice.watch_out.filter((x): x is string => typeof x === 'string'));
  if (typeof advice.action_tomorrow === 'string') textCorpusParts.push(advice.action_tomorrow);
  if (Array.isArray(advice.saving_ideas)) textCorpusParts.push(...advice.saving_ideas.filter((x): x is string => typeof x === 'string'));
  if (Array.isArray(advice.earning_ideas)) textCorpusParts.push(...advice.earning_ideas.filter((x): x is string => typeof x === 'string'));

  const textCorpus = textCorpusParts.join(' ');
  const extractedNumbers = extractNumbersFromText(textCorpus);
  const unsupported: number[] = [];

  for (const num of extractedNumbers) {
    if (!isNumberAllowed(num, allowedSet, allowedNumbers)) {
      unsupported.push(num);
    }
  }

  if (unsupported.length > 0) {
    return {
      valid: false,
      unsupportedNumbers: unsupported,
      reason: `Found unsupported number(s) not in engine summary: ${unsupported.join(', ')}`,
    };
  }

  return {
    valid: true,
    unsupportedNumbers: [],
  };
}

/**
 * INSIGHT ID GUARDRAIL:
 * Verifies that all insight_ids in the advice exist in the candidate insights list.
 * If candidate list is empty, insights must be empty.
 */
export function validateInsightIds(
  advice: DailyReviewAdviceV2,
  candidateInsightIds: string[]
): { valid: boolean; reason?: string } {
  const allowedIds = new Set(candidateInsightIds);

  for (const item of advice.insights || []) {
    if (!allowedIds.has(item.insight_id)) {
      return {
        valid: false,
        reason: `Insight ID "${item.insight_id}" is not in the supplied candidate insight list: [${candidateInsightIds.join(', ')}]`,
      };
    }
  }

  return { valid: true };
}

/**
 * ACTION ANTI-REPETITION GUARDRAIL:
 * Ensures the chosen action does not repeat an action shown in the last 3 reviews.
 */
export function validateActionAntiRepetition(
  actionTomorrow: string,
  last3ActionIds?: string[]
): { valid: boolean; reason?: string } {
  if (!last3ActionIds || last3ActionIds.length === 0) {
    return { valid: true };
  }

  const normalizedAction = actionTomorrow.toLowerCase().trim();
  for (const prevAction of last3ActionIds) {
    const normalizedPrev = prevAction.toLowerCase().trim();
    if (
      normalizedAction === normalizedPrev ||
      (normalizedPrev.length > 5 && normalizedAction.includes(normalizedPrev))
    ) {
      return {
        valid: false,
        reason: `Action "${actionTomorrow}" repeats an action shown in the last 3 reviews.`,
      };
    }
  }

  return { valid: true };
}
