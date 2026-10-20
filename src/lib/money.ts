/**
 * Money utilities for SpendCoach.
 * Money is ALWAYS stored as integer paise (1 Rupee = 100 Paise).
 * Display as ₹ with Indian digit grouping (e.g. ₹1,23,456.50).
 */

/**
 * Formats integer paise into an Indian Rupee currency string (e.g., ₹1,23,456.50).
 * Handles positive, negative, and zero values.
 */
export function formatPaise(paise: number): string {
  if (!Number.isFinite(paise)) {
    throw new TypeError('Paise must be a finite number');
  }

  const isNegative = paise < 0;
  const absPaise = Math.abs(Math.round(paise));
  const wholePart = Math.floor(absPaise / 100);
  const decimalPart = (absPaise % 100).toString().padStart(2, '0');

  // Format whole part using Indian numbering system (3 digits, then groups of 2)
  const wholeStr = wholePart.toString();
  let formattedWhole: string;

  if (wholeStr.length <= 3) {
    formattedWhole = wholeStr;
  } else {
    const lastThree = wholeStr.substring(wholeStr.length - 3);
    const otherDigits = wholeStr.substring(0, wholeStr.length - 3);
    const groups: string[] = [];
    for (let i = otherDigits.length; i > 0; i -= 2) {
      const start = Math.max(0, i - 2);
      groups.unshift(otherDigits.substring(start, i));
    }
    formattedWhole = `${groups.join(',')},${lastThree}`;
  }

  const result = `₹${formattedWhole}.${decimalPart}`;
  return isNegative ? `-${result}` : result;
}

export const formatPaiseToRupees = formatPaise;

/**
 * Parses a rupee amount (number or string representation like "199.99", "₹1,23,456.50", "50")
 * into integer paise without floating point rounding errors.
 */
export function parseRupeesToPaise(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) {
      throw new TypeError('Rupees must be a finite number');
    }
    // Round to prevent float precision artifacts
    return Math.round(input * 100);
  }

  if (typeof input !== 'string') {
    throw new TypeError('Input must be a string or number');
  }

  // Remove currency symbol, whitespace, and Indian grouping commas
  const clean = input.replace(/[₹,\s]/g, '').trim();

  if (!clean || !/^-?\d*(\.\d+)?$/.test(clean) || clean === '.' || clean === '-') {
    throw new Error(`Invalid rupee amount: "${input}"`);
  }

  const isNegative = clean.startsWith('-');
  const rawPositive = isNegative ? clean.slice(1) : clean;

  const [wholePart = '0', fractionPart = ''] = rawPositive.split('.');
  const whole = parseInt(wholePart || '0', 10);
  if (isNaN(whole)) {
    throw new Error(`Invalid rupee amount: "${input}"`);
  }

  // Take up to 2 decimal places with rounding if more are provided
  let paiseFromFraction = 0;
  if (fractionPart.length > 0) {
    const twoDigits = (fractionPart + '00').slice(0, 2);
    paiseFromFraction = parseInt(twoDigits, 10);
    // If there is a 3rd digit, round appropriately
    if (fractionPart.length > 2) {
      const thirdDigit = parseInt(fractionPart[2], 10);
      if (thirdDigit >= 5) {
        paiseFromFraction += 1;
      }
    }
  }

  const totalPaise = whole * 100 + paiseFromFraction;
  return isNegative ? -totalPaise : totalPaise;
}

/**
 * Parses shorthand amounts like "250", "2.5k", "1.2L", "1.5cr", "₹4,850".
 * Returns integer paise, or null if invalid.
 */
export function parseAmountShorthand(input: string): number | null {
  if (!input || typeof input !== 'string') return null;
  const clean = input.replace(/[₹,\s]/g, '').trim().toLowerCase();
  if (!clean) return null;

  // Lakh shorthand: 1.2L, 1.2lakh, 1.2lakhs
  const lakhMatch = clean.match(/^([\d.]+)\s*(?:l|lakh|lakhs)$/);
  if (lakhMatch) {
    const val = parseFloat(lakhMatch[1]);
    return isNaN(val) || val <= 0 ? null : Math.round(val * 100000 * 100);
  }

  // Thousand shorthand: 2.5k, 25k
  const kMatch = clean.match(/^([\d.]+)\s*k$/);
  if (kMatch) {
    const val = parseFloat(kMatch[1]);
    return isNaN(val) || val <= 0 ? null : Math.round(val * 1000 * 100);
  }

  // Crore shorthand: 1.5cr
  const crMatch = clean.match(/^([\d.]+)\s*(?:cr|crore|crores)$/);
  if (crMatch) {
    const val = parseFloat(crMatch[1]);
    return isNaN(val) || val <= 0 ? null : Math.round(val * 10000000 * 100);
  }

  try {
    const paise = parseRupeesToPaise(clean);
    return paise > 0 ? paise : null;
  } catch {
    return null;
  }
}

/**
 * Converts integer paise into a clean decimal string suitable for an <input type="number" step="0.01">.
 * Example: 19999 -> "199.99", 5000 -> "50.00"
 */
export function paiseToDecimalString(paise: number): string {
  if (!Number.isFinite(paise)) return '0.00';
  const isNegative = paise < 0;
  const absPaise = Math.abs(Math.round(paise));
  const wholePart = Math.floor(absPaise / 100);
  const decimalPart = (absPaise % 100).toString().padStart(2, '0');
  const res = `${wholePart}.${decimalPart}`;
  return isNegative ? `-${res}` : res;
}
