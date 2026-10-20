/**
 * Pure statistical and mathematical helpers for the learning engine.
 */

/**
 * Calculates the median of an array of numbers.
 * Returns 0 if empty.
 */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Calculates the Median Absolute Deviation (MAD) of an array of numbers.
 * MAD = median(|x_i - median(X)|)
 */
export function medianAbsoluteDeviation(values: number[], precomputedMedian?: number): number {
  if (values.length <= 1) return 0;
  const med = precomputedMedian !== undefined ? precomputedMedian : median(values);
  const deviations = values.map((val) => Math.abs(val - med));
  return median(deviations);
}

/**
 * Computes Boris Iglewicz and David Hoaglin's modified Z-score:
 * M_i = 0.6745 * (x - median) / MAD
 */
export function modifiedZScore(x: number, med: number, mad: number): number {
  if (mad === 0) return 0;
  return (0.6745 * (x - med)) / mad;
}

/**
 * Adds an integer number of days to a YYYY-MM-DD date string.
 */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Calculates (dateA - dateB) in days.
 * Returns positive if dateA is after dateB.
 */
export function daysDifference(dateStrA: string, dateStrB: string): number {
  const [y1, m1, d1] = dateStrA.split('-').map(Number);
  const [y2, m2, d2] = dateStrB.split('-').map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((utc1 - utc2) / msPerDay);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Returns full English weekday name for a YYYY-MM-DD date.
 */
export function getWeekdayName(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return WEEKDAYS[date.getUTCDay()];
}

/**
 * Returns total days in a month for given year and month (1-indexed).
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
