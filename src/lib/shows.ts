import { Linking } from 'react-native';

import { markFeedStale } from '@/lib/posts';
import { supabase, requireUserId } from '@/lib/supabase';

export type ShowStatus = 'announced' | 'sold_out' | 'cancelled';

export type Show = {
  id: string;
  /** Optional tour/show name ("Highs & Lows Tour"). */
  title: string | null;
  venue: string;
  /** "Miami, FL" */
  city: string;
  starts_at: string;
  /** IANA zone of the venue — every time we display is in this zone. */
  timezone: string;
  /** Link-out; null = "Tickets soon". */
  ticket_url: string | null;
  status: ShowStatus;
  created_at: string;
  updated_at: string;
};

export type NewShow = Omit<Show, 'id' | 'created_at' | 'updated_at' | 'status'> & {
  status?: ShowStatus;
};

export type ShowPatch = Partial<Omit<Show, 'id' | 'created_at' | 'updated_at'>>;

const SHOW_COLUMNS =
  'id, title, venue, city, starts_at, timezone, ticket_url, status, created_at, updated_at';

/**
 * A show is still "on" for 6 hours after doors — it's happening, not
 * over. The upcoming list, the past list and isPast() all share this
 * cutoff so a show never lands in both lists or neither.
 */
export const SHOW_GRACE_MS = 6 * 60 * 60 * 1000;

export const DEFAULT_SHOW_TIMEZONE = 'America/New_York';

/** Zones the create form offers — the artist picks by name, we store IANA. */
export const SHOW_TIMEZONES: { label: string; value: string }[] = [
  { label: 'Eastern', value: 'America/New_York' },
  { label: 'Central', value: 'America/Chicago' },
  { label: 'Mountain', value: 'America/Denver' },
  { label: 'Arizona', value: 'America/Phoenix' },
  { label: 'Pacific', value: 'America/Los_Angeles' },
  { label: 'Alaska', value: 'America/Anchorage' },
  { label: 'Hawaii', value: 'Pacific/Honolulu' },
  { label: 'London', value: 'Europe/London' },
  { label: 'Central Europe', value: 'Europe/Paris' },
  { label: 'Tokyo', value: 'Asia/Tokyo' },
  { label: 'Sydney', value: 'Australia/Sydney' },
];

export const SHOW_STATUS_LABEL: Record<ShowStatus, string> = {
  announced: 'On sale',
  sold_out: 'Sold out',
  cancelled: 'Cancelled',
};

/** "On sale" / "Tickets soon" / "Sold out" / "Cancelled" for a badge. */
export function statusLabel(show: Show): string {
  if (show.status === 'announced' && !show.ticket_url) return 'Tickets soon';
  return SHOW_STATUS_LABEL[show.status];
}

/**
 * Supabase errors carry raw Postgres text - fans never see that. A
 * write the database refused (RLS) means a non-artist tried to manage
 * shows; everything else gets the caller's own copy.
 */
function friendly(error: { message?: string; code?: string } | null, copy: string): Error {
  const text = error?.message ?? '';
  if (error?.code === '42501' || text.includes('row-level security')) {
    return new Error('Only the artist can manage shows.');
  }
  return new Error(copy);
}

function cutoffIso(): string {
  return new Date(Date.now() - SHOW_GRACE_MS).toISOString();
}

/** Every show that hasn't wrapped yet, soonest first (cancelled and sold out included). */
export async function fetchUpcomingShows(): Promise<Show[]> {
  const { data, error } = await supabase
    .from('shows')
    .select(SHOW_COLUMNS)
    .gte('starts_at', cutoffIso())
    .order('starts_at', { ascending: true });
  if (error) throw friendly(error, 'Could not load shows - check your connection and try again.');
  return (data as unknown as Show[]) ?? [];
}

/** Shows that are over, most recent first. */
export async function fetchPastShows(limit = 20): Promise<Show[]> {
  const { data, error } = await supabase
    .from('shows')
    .select(SHOW_COLUMNS)
    .lt('starts_at', cutoffIso())
    .order('starts_at', { ascending: false })
    .limit(limit);
  if (error) throw friendly(error, 'Could not load past shows - try again in a moment.');
  return (data as unknown as Show[]) ?? [];
}

/** One show by id. Resolves null when it's gone. */
export async function fetchShow(id: string): Promise<Show | null> {
  const { data, error } = await supabase
    .from('shows')
    .select(SHOW_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw friendly(error, 'Could not load that show - try again in a moment.');
  return (data as unknown as Show) ?? null;
}

/**
 * Tidies a typed-in ticket link: blank becomes null (= "Tickets soon"),
 * and "ticketmaster.com/…" gets the https:// the phone needs to open it.
 */
export function normalizeTicketUrl(url: string | null | undefined): string | null {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  // Web links only: never javascript:, tel:, intent: and friends.
  if (!/^https?:\/\/\S+$/i.test(withScheme)) {
    throw new Error('Ticket links must start with http:// or https://');
  }
  return withScheme;
}

/** Artist: announce a show. Inserting an 'announced' show fires the push to every fan. */
export async function createShow(input: NewShow): Promise<Show> {
  await requireUserId(); // friendly "sign in again" before the database says 42501
  const { data, error } = await supabase
    .from('shows')
    .insert({
      title: input.title?.trim() || null,
      venue: input.venue.trim(),
      city: input.city.trim(),
      starts_at: input.starts_at,
      timezone: input.timezone || DEFAULT_SHOW_TIMEZONE,
      ticket_url: normalizeTicketUrl(input.ticket_url),
      status: input.status ?? 'announced',
    })
    .select(SHOW_COLUMNS)
    .single();
  if (error) throw friendly(error, 'Could not save the show - check the details and try again.');
  markFeedStale(); // the feed's Shows card re-reads on focus only when told to
  return data as unknown as Show;
}

/** Artist: edit any of a show's details (status included - "sold out", "cancelled"). */
export async function updateShow(id: string, patch: ShowPatch): Promise<Show> {
  await requireUserId();
  const row: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if ('title' in patch) row.title = patch.title?.trim() || null;
  if (patch.venue !== undefined) row.venue = patch.venue.trim();
  if (patch.city !== undefined) row.city = patch.city.trim();
  if ('ticket_url' in patch) row.ticket_url = normalizeTicketUrl(patch.ticket_url);

  const { data, error } = await supabase
    .from('shows')
    .update(row)
    .eq('id', id)
    .select(SHOW_COLUMNS)
    .maybeSingle();
  if (error) throw friendly(error, 'Could not save your changes - try again in a moment.');
  if (!data) throw new Error("That show isn't there anymore - it may have been deleted.");
  markFeedStale();
  return data as unknown as Show;
}

export async function deleteShow(id: string): Promise<void> {
  await requireUserId();
  const { error } = await supabase.from('shows').delete().eq('id', id);
  if (error) throw friendly(error, 'Could not delete the show - try again in a moment.');
  markFeedStale();
}

/** Opens the ticket link in the browser. Does nothing when there isn't one yet. */
export async function openTickets(show: Show): Promise<void> {
  let url: string | null;
  try {
    url = normalizeTicketUrl(show.ticket_url);
  } catch {
    throw new Error("That ticket link isn't a web address.");
  }
  if (!url) return;
  try {
    if (!(await Linking.canOpenURL(url))) throw new Error('unsupported');
    await Linking.openURL(url);
  } catch {
    throw new Error("Couldn't open the ticket link - try again in a moment.");
  }
}

// ---- dates: everything below displays in the VENUE's zone, not the
// ---- phone's. Hermes (Expo's engine) ships full ICU Intl on iOS and
// ---- Android, so the timeZone option works everywhere the app runs.

type Formatters = {
  /** Weekday, month, day, hour, minute + zone abbreviation, as parts. */
  display: Intl.DateTimeFormat;
  /** Just the clock, in the phone's own locale ("8:00 PM" / "20:00"). */
  time: Intl.DateTimeFormat;
  /** Numeric year/month/day for calendar-day math. Always en-US: Latin digits. */
  ymd: Intl.DateTimeFormat;
};

// Building an Intl formatter costs a few ms on Hermes; a list of shows
// would pay that per row, so keep one set per zone.
const formatterMemo = new Map<string, Formatters>();

function withZone(
  locale: string | undefined,
  options: Intl.DateTimeFormatOptions,
  timeZone: string
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone });
  } catch {
    // An unknown zone string throws a RangeError; a card must never crash
    // over it. Fall back to the phone's own zone.
    return new Intl.DateTimeFormat(locale, options);
  }
}

function formattersFor(timeZone: string): Formatters {
  const hit = formatterMemo.get(timeZone);
  if (hit) return hit;
  const built: Formatters = {
    display: withZone(
      undefined,
      {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      },
      timeZone
    ),
    time: withZone(undefined, { hour: 'numeric', minute: '2-digit' }, timeZone),
    ymd: withZone('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' }, timeZone),
  };
  formatterMemo.set(timeZone, built);
  return built;
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPart['type']): string {
  return parts.find((p) => p.type === type)?.value ?? '';
}

/**
 * The pieces a poster-style date block wants — { month: 'Sep', day: '14',
 * weekday: 'Sat', time: '8:00 PM', zone: 'EDT' } — in the show's zone.
 * Casing is left to the screen (Anton headings uppercase via style).
 */
export function showDateParts(show: Show): {
  month: string;
  day: string;
  weekday: string;
  time: string;
  zone: string;
} {
  const when = new Date(show.starts_at);
  const f = formattersFor(show.timezone);
  const parts = f.display.formatToParts(when);
  return {
    month: part(parts, 'month'),
    day: part(parts, 'day'),
    weekday: part(parts, 'weekday'),
    time: f.time.format(when),
    zone: part(parts, 'timeZoneName'),
  };
}

/** Days since the epoch for the calendar date `ms` falls on in `timeZone`. */
function calendarDay(ms: number, timeZone: string): number {
  const parts = formattersFor(timeZone).ymd.formatToParts(new Date(ms));
  const num = (type: Intl.DateTimeFormatPart['type']) => parseInt(part(parts, type), 10) || 0;
  return Math.floor(Date.UTC(num('year'), num('month') - 1, num('day')) / 86_400_000);
}

/** True once the show has wrapped (doors + the 6-hour grace window). */
export function isPast(show: Show, now: number = Date.now()): boolean {
  return new Date(show.starts_at).getTime() + SHOW_GRACE_MS < now;
}

/**
 * Short relative label, judged on calendar days in the venue's zone:
 * "Tonight", "Tomorrow", "Sat" (within the week), "In 12 days", or "Past".
 */
export function showRelative(show: Show, now: number = Date.now()): string {
  if (isPast(show, now)) return 'Past';
  const days =
    calendarDay(new Date(show.starts_at).getTime(), show.timezone) -
    calendarDay(now, show.timezone);
  if (days <= 0) return 'Tonight';
  if (days === 1) return 'Tomorrow';
  if (days <= 6) return showDateParts(show).weekday;
  return `In ${days} days`;
}
