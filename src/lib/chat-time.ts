// Time as the chat surfaces read it: a separator chip heads the thread when
// the day turns or a quiet hour passes, and a tapped bubble tells its time.
// The date table and the clock live in lib/dates; this file only composes.

import { MONTHS, WEEKDAYS, WEEKDAYS_SHORT, clockTime } from '@/lib/dates';

export { clockTime };

/** Local calendar day, for grouping: "2026-9-7". */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole calendar days between then and now: 0 today, 1 yesterday. */
function daysAgo(iso: string): number {
  return Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 86_400_000);
}

/** "Today", "Yesterday", a weekday within the last 6 days, else "Mon, Sept 7" (the year joins when it is not this year). */
function dayLabel(iso: string): string {
  const n = daysAgo(iso);
  const d = new Date(iso);
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n > 1 && n < 7) return WEEKDAYS[d.getDay()];
  const base = `${WEEKDAYS_SHORT[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

/** The thread's separator chip: "Today 1:52 PM", "Monday 3:04 PM", "Mon, Sept 7 2:15 PM". */
export function separatorLabel(iso: string): string {
  return `${dayLabel(iso)} ${clockTime(iso)}`;
}

/** The chat list's stamp: clock today, "Yesterday", a weekday this week, else the date. */
export function listTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (dayKey(iso) === dayKey(now.toISOString())) return clockTime(iso);
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(iso) === dayKey(yesterday.toISOString())) return 'Yesterday';
  const ageDays = (now.getTime() - d.getTime()) / 86_400_000;
  if (ageDays < 6) return WEEKDAYS_SHORT[d.getDay()];
  const month = MONTHS[d.getMonth()];
  return d.getFullYear() === now.getFullYear()
    ? `${month} ${d.getDate()}`
    : `${month} ${d.getDate()}, ${d.getFullYear()}`;
}
