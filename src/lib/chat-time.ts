// Time as the chat surfaces read it: a letter is headed with the day, and
// the messages beneath it carry only the clock.

// Mixed case throughout — Anton does the shouting, the words don't.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// AP-style month abbreviations — "Sept", not "Sep".
const MONTHS = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/** Local calendar day, for grouping — "2026-9-7". */
export function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Monday, Sept 7" — with the year only when it isn't this year. */
export function dateline(iso: string): string {
  const d = new Date(iso);
  const base = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

/** "1:52" — 12-hour clock, no suffix, the way the dateline'd thread reads. */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  const hours = d.getHours() % 12 || 12;
  return `${hours}:${String(d.getMinutes()).padStart(2, '0')}`;
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
