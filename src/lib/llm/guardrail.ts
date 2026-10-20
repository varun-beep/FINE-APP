import type { DailyReviewAdvice } from './types';

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
function isNumberAllowed(num: number, allowedSet: Set<number>, allowedList: number[]): boolean {
  // 1. Trivial structural numbers in advice (e.g., "₹0", "1 action", "2 ways", "step 1")
  if (num === 0 || num === 1 || num === 2 || num === 3) {
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
      if (Math.round(num) === round100Allowed || Math.round(num) === round1000Allowed) {
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
  advice: DailyReviewAdvice,
  allowedNumbers: number[]
): GuardrailValidationResult {
  const allowedSet = new Set(allowedNumbers);

  // Collect all text from all advice fields
  const textCorpus = [
    advice.headline,
    ...advice.went_well,
    ...advice.watch_out,
    advice.action_tomorrow,
    ...advice.saving_ideas,
    ...advice.earning_ideas,
  ].join(' ');

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
