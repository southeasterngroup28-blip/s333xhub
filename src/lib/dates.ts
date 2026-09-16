// One date table for every sentence in the app.
//
// Months are AP style ("Sept", not "Sep") wherever a date reads as prose:
// chat separators, ticket lines, the fan-mail cooldown, the drop form.
// The one place 3-letter caps ("SEP") is correct is the show poster's
// date block, where the month sits alone over the day numeral; that
// block reads Intl's short month straight from lib/shows' showDateParts.
//
// Mixed case throughout. Anton does the shouting, the words don't.

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

// One formatter for the whole app, created once, not per row. It follows
// the phone's clock setting.
const CLOCK = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** "1:52 PM", or "13:52" when the phone is set to 24-hour time. */
export function clockTime(iso: string): string {
  return CLOCK.format(new Date(iso));
}

/** "Sept 7" this year, "Sept 7, 2025" any other year. */
export function shortDate(d: Date): string {
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base}, ${d.getFullYear()}`;
}

/** "Sept 7, 2026", the year always on (form fields that round-trip). */
export function shortDateYear(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "Mon, Sept 7" (the year joins when it is not this year). */
export function longDate(d: Date): string {
  return `${WEEKDAYS_SHORT[d.getDay()]}, ${shortDate(d)}`;
}
