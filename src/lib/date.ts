/**
 * Date and Time utilities for SpendCoach.
 * All "today" logic strictly uses the Asia/Kolkata timezone, never server UTC.
 */

const TIMEZONE = 'Asia/Kolkata';

/**
 * Returns today's date formatted as YYYY-MM-DD in the Asia/Kolkata timezone.
 */
export function getKolkataToday(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

/**
 * Returns the current month formatted as YYYY-MM in the Asia/Kolkata timezone,
 * or extracts the month from a given YYYY-MM-DD string.
 */
export function getKolkataCurrentMonth(dateStr?: string): string {
  if (dateStr && /^\d{4}-\d{2}/.test(dateStr)) {
    return dateStr.substring(0, 7);
  }
  const today = getKolkataToday();
  return today.substring(0, 7);
}

/**
 * Checks if a given YYYY-MM-DD date string represents "today" in Asia/Kolkata.
 */
export function isKolkataToday(dateStr: string): boolean {
  return dateStr === getKolkataToday();
}

/**
 * Returns yesterday's date formatted as YYYY-MM-DD in Asia/Kolkata.
 */
export function getKolkataYesterday(): string {
  const todayStr = getKolkataToday();
  const [year, month, day] = todayStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Formats a YYYY-MM-DD date string into human-friendly relative label or readable date.
 * Example: "Today", "Yesterday", or "Tue, 20 Oct 2026"
 */
export function formatDisplayDate(dateStr: string): string {
  if (dateStr === getKolkataToday()) {
    return 'Today';
  }
  if (dateStr === getKolkataYesterday()) {
    return 'Yesterday';
  }
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  const d = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC', // We are parsing the explicit UTC date representation of the local day
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}
