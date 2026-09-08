import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/providers/auth-provider';

import { DISPLAY_FONT } from '@/constants/type';
import {
  DEFAULT_SHOW_TIMEZONE,
  SALES_MODE_LABEL,
  SHOW_STATUS_LABEL,
  SHOW_TIMEZONES,
  createShow,
  deleteShow,
  fetchShow,
  updateShow,
  type SalesMode,
  type ShowStatus,
} from '@/lib/shows';
import { ticketsSold } from '@/lib/tickets';

/** Segmented order for the edit screen; labels come from the lib so badges match. */
const STATUS_ORDER: ShowStatus[] = ['announced', 'sold_out', 'cancelled'];

/** In-app first — selling in the app is the whole point of the feature. */
const SALES_MODES: SalesMode[] = ['in_app', 'link', 'none'];

/** Stripe won't take a USD charge under 50¢, so neither does the form. */
const MIN_PRICE_CENTS = 50;

/** "45", "45.5", "$45.00", "1,200" → cents; null when it isn't a price. */
function parsePriceCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Cents back into the price field: 4500 → "45", 4550 → "45.50". */
function priceInput(cents: number): string {
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

/** Blank = unlimited (null); otherwise a whole number, or NaN when it isn't one. */
function parseCapacity(raw: string): number | null {
  const cleaned = raw.trim().replace(/,/g, '');
  if (!cleaned) return null;
  return /^\d+$/.test(cleaned) ? Number(cleaned) : Number.NaN;
}

// ---- The artist types the time as printed on the ticket (venue wall clock).
// ---- We store the real instant plus the zone, so every fan sees venue time.

// ---- Dates: whatever's on the flyer goes in ("9/15", "Sept 15", "2026-09-15");
// ---- on blur the field tidies itself to "Sep 15, 2026".

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

type DateParts = { year: number; month: number; day: number };

/** A read date, plus whether we had to guess (day/month swapped, or a year we picked). */
type ParsedDate = DateParts & { guessed: boolean };

/** A real calendar date, or null. Feb 30 and friends roll over when built, so a real date round-trips unchanged. */
function calendarDate(year: number, month: number, day: number): DateParts | null {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** "sep", "sept", "September", "Sep." → 9; null when it isn't a month. */
function monthNumber(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return null;
  const i = MONTH_NAMES.findIndex((name) => name.startsWith(w));
  return i === -1 ? null : i + 1;
}

/** "26" → 2026; four digits pass through; nothing typed stays undefined. */
function fullYear(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  return raw.length === 2 ? 2000 + Number(raw) : Number(raw);
}

/** No year typed: this year, or next year once that day has already gone by. */
function inferYear(month: number, day: number): { year: number; rolled: boolean } {
  const now = new Date();
  const year = now.getFullYear();
  const today = Date.UTC(year, now.getMonth(), now.getDate());
  const thisYear = calendarDate(year, month, day);
  if (thisYear && Date.UTC(year, month - 1, day) >= today) return { year, rolled: false };
  return { year: year + 1, rolled: true };
}

/** Pins the year (typed, or inferred) and confirms the date exists. */
function resolveDate(month: number, day: number, year: number | undefined): ParsedDate | null {
  if (year != null) {
    const d = calendarDate(year, month, day);
    return d && { ...d, guessed: false };
  }
  const inferred = inferYear(month, day);
  const d = calendarDate(inferred.year, month, day);
  return d && { ...d, guessed: inferred.rolled };
}

/** Numbers only: month/day as typed, else swapped ("15/9" → Sep 15) — the swap counts as a guess. */
function numericDate(a: number, b: number, year: number | undefined): ParsedDate | null {
  const asTyped = resolveDate(a, b, year);
  if (asTyped) return asTyped;
  const swapped = resolveDate(b, a, year);
  return swapped && { ...swapped, guessed: true };
}

/**
 * Accepts 2026-09-15, 9/15/2026, 9/15/26, 9/15, Sep 15, Sept 15th,
 * September 15, 2026, 15 Sep 2026 — and 2026-15-09, read with day and month swapped.
 */
function parseDate(raw: string): ParsedDate | null {
  const text = raw
    .trim()
    .replace(/\s+/g, ' ')
    // "Tue, Sep 15" — a weekday up front is decoration.
    .replace(/^(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,? /i, '');
  if (!text) return null;

  // 2026-09-15 · 2026/9/15
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text);
  if (m) return numericDate(Number(m[2]), Number(m[3]), Number(m[1]));

  // 9/15/2026 · 9-15-26 · 9/15 (year assumed)
  m = /^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?$/.exec(text);
  if (m) return numericDate(Number(m[1]), Number(m[2]), fullYear(m[3]));

  // Sep 15 · Sept 15th · September 15, 2026 · Sep. 15 2026
  m = /^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?,?(?: (\d{2}|\d{4}))?$/i.exec(text);
  if (m) {
    const month = monthNumber(m[1]);
    return month ? resolveDate(month, Number(m[2]), fullYear(m[3])) : null;
  }

  // 15 Sep · 15th September 2026
  m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)\.?,?(?: (\d{2}|\d{4}))?$/i.exec(text);
  if (m) {
    const month = monthNumber(m[2]);
    return month ? resolveDate(month, Number(m[1]), fullYear(m[3])) : null;
  }

  return null;
}

/** The field's tidy form: "Sep 15, 2026" — which parseDate reads straight back. */
function dateLabel(d: DateParts): string {
  const month = MONTH_NAMES[d.month - 1];
  return `${month.charAt(0).toUpperCase()}${month.slice(1, 3)} ${d.day}, ${d.year}`;
}

/** The field's tidy form: 22:00 → "10:00 PM". */
function timeLabel(t: { hour: number; minute: number }): string {
  const h12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  return `${h12}:${String(t.minute).padStart(2, '0')} ${t.hour >= 12 ? 'PM' : 'AM'}`;
}

/** Accepts "8:00 PM", "10pm", "10 PM", "10:30pm", "22:00", "10.30 p.m." — whatever's on the flyer. */
function parseTime(raw: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2})(?:[:.](\d{2}))?\s*([ap]\.?m?\.?)?$/i.exec(raw.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const meridiem = m[3]?.toLowerCase();
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem.startsWith('p') && hour !== 12) hour += 12;
    if (meridiem.startsWith('a') && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

/** "america/chicago" → "America/Chicago"; null when it's not a zone at all. */
function canonicalZone(raw: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: raw }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** How far the zone's wall clock sits from UTC at a given instant (DST-aware). */
function zoneOffsetMs(instantMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return wall - Math.floor(instantMs / 1000) * 1000;
}

function zonedToUtc(
  d: { year: number; month: number; day: number },
  t: { hour: number; minute: number },
  tz: string
): Date {
  const wall = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute);
  let instant = wall - zoneOffsetMs(wall, tz);
  // A DST switch between the two guesses shifts the offset; one more pass settles it.
  instant = wall - zoneOffsetMs(instant, tz);
  return new Date(instant);
}

/** The stored instant, back into the form's "Oct 18, 2026" / "8:00 PM" fields. */
function wallClock(iso: string, tz: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    date: dateLabel({ year: get('year'), month: get('month'), day: get('day') }),
    time: timeLabel({ hour: get('hour'), minute: get('minute') }),
  };
}

/** "Sat, Oct 18, 2026, 8:00 PM EDT" — exactly what fans will read. */
function previewLabel(at: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(at);
}

export default function ShowFormScreen() {
  // Present only in edit mode: /show-new?id=<uuid>. Plain /show-new creates.
  const { id: editId } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { profile } = useAuth();
  const editing = !!editId;

  const [loading, setLoading] = useState(editing);
  const [title, setTitle] = useState('');
  const [venue, setVenue] = useState('');
  const [city, setCity] = useState('');
  const [date, setDate] = useState('');
  /** "Read that as Sep 15, 2026 — tap to change." after a guessed date; tap focuses the field. */
  const [dateNote, setDateNote] = useState<string | null>(null);
  const dateRef = useRef<TextInput>(null);
  const [time, setTime] = useState('');
  /** One of SHOW_TIMEZONES' values, or 'other' to reveal the free-text field. */
  const [zoneChoice, setZoneChoice] = useState<string>(DEFAULT_SHOW_TIMEZONE);
  const [customZone, setCustomZone] = useState('');
  const [ticketUrl, setTicketUrl] = useState('');
  const [salesMode, setSalesMode] = useState<SalesMode>('in_app');
  const [price, setPrice] = useState('');
  const [capacity, setCapacity] = useState('');
  /**
   * Editing: tickets already sold. Capacity can't drop below it, and a show
   * with sales can't be deleted (sold tickets pin it) — only cancelled.
   */
  const [sold, setSold] = useState(0);
  const [status, setStatus] = useState<ShowStatus>('announced');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editId) return;
    fetchShow(editId)
      .then((show) => {
        if (!show) {
          setError('Show not found.');
          return;
        }
        setTitle(show.title ?? '');
        setVenue(show.venue);
        setCity(show.city);
        const zone = canonicalZone(show.timezone) ?? DEFAULT_SHOW_TIMEZONE;
        const wall = wallClock(show.starts_at, zone);
        setDate(wall.date);
        setTime(wall.time);
        const preset = SHOW_TIMEZONES.some((z) => z.value === zone);
        setZoneChoice(preset ? zone : 'other');
        setCustomZone(preset ? '' : zone);
        setTicketUrl(show.ticket_url ?? '');
        setSalesMode(show.sales_mode);
        setPrice(show.ticket_price_cents != null ? priceInput(show.ticket_price_cents) : '');
        setCapacity(show.capacity != null ? String(show.capacity) : '');
        setStatus(show.status);
        // Every mode, not just in-app: a show that sold in the app and then
        // switched to a link still has fans holding tickets. Best effort — a
        // miss only loosens the capacity check and lets Delete fall through
        // to the database's own (friendly) refusal.
        ticketsSold(show.id).then(setSold).catch(() => {});
      })
      .catch((e) => setError((e as { message?: string })?.message ?? 'Could not load.'))
      .finally(() => setLoading(false));
  }, [editId]);

  const zoneRaw = zoneChoice === 'other' ? customZone.trim() : zoneChoice;
  const timezone = zoneRaw ? canonicalZone(zoneRaw) : null;
  const dateParts = parseDate(date);
  const timeParts = parseTime(time);
  const startsAt =
    dateParts && timeParts && timezone ? zonedToUtc(dateParts, timeParts, timezone) : null;
  const ticket = ticketUrl.trim();
  const ticketOk =
    salesMode !== 'link' || ticket.length === 0 || /^https?:\/\/\S+$/i.test(ticket);
  const priceCents = parsePriceCents(price);
  const priceOk = salesMode !== 'in_app' || (priceCents !== null && priceCents >= MIN_PRICE_CENTS);
  const capacityValue = parseCapacity(capacity);
  const capacityOk =
    salesMode !== 'in_app' ||
    capacityValue === null ||
    (Number.isInteger(capacityValue) && capacityValue >= 1 && capacityValue >= sold);
  const valid =
    venue.trim().length > 0 &&
    city.trim().length > 0 &&
    !!startsAt &&
    ticketOk &&
    priceOk &&
    capacityOk;

  const priceHint =
    salesMode === 'in_app' && price.trim() && !priceOk
      ? priceCents === null
        ? 'Price should look like 45 or 45.50.'
        : 'Tickets need a price of at least $0.50.'
      : null;
  const capacityHint =
    salesMode === 'in_app' && capacity.trim() && !capacityOk
      ? capacityValue !== null && Number.isInteger(capacityValue) && capacityValue < sold
        ? `${sold} already sold — capacity can't go below that.`
        : 'Capacity should be a whole number, like 200 (or blank for unlimited).'
      : null;
  const salesNote =
    salesMode === 'in_app'
      ? `${price.trim() ? '' : 'Set a ticket price to post. '}Fans pay in the app with Apple Pay or a card${
          capacityValue && capacityOk ? ` — sales stop at ${capacityValue}.` : ' — no cap on sales.'
        }${editing && sold > 0 ? ` ${sold} sold so far.` : ''}`
      : salesMode === 'link'
        ? 'Fans tap TICKETS and land on that page. Blank shows “Tickets soon”.'
        : 'No ticket button — fans just see the date and place.';
  // Switching an in-app show away from in-app doesn't touch tickets already sold.
  const switchNote =
    editing && sold > 0 && salesMode !== 'in_app'
      ? `${sold} fan${sold === 1 ? '' : 's'} already bought in the app — they keep their tickets; new in-app sales stop.`
      : null;

  const whenHint =
    date.trim() && !dateParts
      ? 'Couldn’t read that date — e.g. Sep 15 or 9/15/2026.'
      : time.trim() && !timeParts
        ? 'Time should look like 8:00 PM, 8pm, or 20:00.'
        : null;
  const zoneHint =
    zoneRaw && !timezone ? "That's not a timezone we recognize — try America/Chicago." : null;
  const inPast = !!startsAt && startsAt.getTime() < Date.now();

  /** On blur: "9/15" → "Sep 15, 2026". A guessed reading gets a note the artist can tap to fix. */
  function tidyDate() {
    const parsed = parseDate(date);
    if (!parsed) return;
    const label = dateLabel(parsed);
    setDate(label);
    setDateNote(parsed.guessed ? `Read that as ${label} — tap to change.` : null);
  }

  /** On blur: "10pm" → "10:00 PM". */
  function tidyTime() {
    const parsed = parseTime(time);
    if (parsed) setTime(timeLabel(parsed));
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    // '/shows' is new this build; typed routes regenerate when the dev server runs.
    else router.replace('/shows' as never);
  }

  async function handleSubmit() {
    if (!valid || saving || !startsAt || !timezone) return;
    setSaving(true);
    setError(null);
    const fields = {
      title: title.trim() || null,
      venue: venue.trim(),
      city: city.trim(),
      starts_at: startsAt.toISOString(),
      timezone,
      sales_mode: salesMode,
      ticket_url: salesMode === 'link' ? ticket || null : null,
      ticket_price_cents: salesMode === 'in_app' ? priceCents : null,
      capacity: salesMode === 'in_app' ? capacityValue : null,
    };
    try {
      if (editId) {
        await updateShow(editId, { ...fields, status });
        goBack();
      } else {
        await createShow(fields);
        goBack(); // /shows refetches on focus, so the new row is already there
      }
    } catch (e) {
      setError(
        (e as { message?: string })?.message ??
          (editId ? 'Could not save the show.' : 'Could not post the show.')
      );
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editId || saving) return;
    setConfirmDelete(false);
    setSaving(true);
    setError(null);
    try {
      await deleteShow(editId);
      goBack();
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not delete the show.');
      setSaving(false);
    }
  }

  // Artist-only surface; a deep-linked fan sees nothing, not a broken form.
  if (profile?.role !== 'artist') {
    return <SafeAreaView style={styles.safe} />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>{editing ? 'EDIT SHOW' : 'NEW SHOW'}</Text>
        <View style={{ width: 48 }} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        // Price and capacity sit below the fold on a phone: the avoiding view
        // lifts the form off the keyboard and the deep bottom padding leaves
        // room to scroll the last inputs and the button clear of it.
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
            contentInsetAdjustmentBehavior="automatic">
            <TextInput
              style={styles.input}
              placeholder="Tour or show name (optional)"
              placeholderTextColor="#55585f"
              value={title}
              onChangeText={setTitle}
              maxLength={80}
            />

            <Text style={styles.label}>VENUE</Text>
            <TextInput
              style={styles.input}
              placeholder="The Fillmore"
              placeholderTextColor="#55585f"
              value={venue}
              onChangeText={setVenue}
              autoCapitalize="words"
              maxLength={80}
            />

            <Text style={styles.label}>CITY</Text>
            <TextInput
              style={styles.input}
              placeholder="Miami, FL"
              placeholderTextColor="#55585f"
              value={city}
              onChangeText={setCity}
              autoCapitalize="words"
              maxLength={60}
            />

            <View style={styles.pairRow}>
              <View style={styles.pairCell}>
                <Text style={styles.label}>DATE</Text>
                <TextInput
                  ref={dateRef}
                  style={styles.input}
                  placeholder="Sep 15, 2026"
                  placeholderTextColor="#55585f"
                  value={date}
                  onChangeText={(text) => {
                    setDate(text);
                    setDateNote(null);
                  }}
                  onBlur={tidyDate}
                  autoCapitalize="words"
                  autoCorrect={false}
                  maxLength={24}
                />
              </View>
              <View style={styles.pairCell}>
                <Text style={styles.label}>TIME</Text>
                <TextInput
                  style={styles.input}
                  placeholder="8:00 PM"
                  placeholderTextColor="#55585f"
                  value={time}
                  onChangeText={setTime}
                  onBlur={tidyTime}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={10}
                />
              </View>
            </View>
            {dateNote ? (
              <Pressable onPress={() => dateRef.current?.focus()} hitSlop={6}>
                <Text style={styles.readAs}>{dateNote}</Text>
              </Pressable>
            ) : null}
            {whenHint ? <Text style={styles.hint}>{whenHint}</Text> : null}

            <Text style={styles.label}>TIMEZONE</Text>
            <View style={styles.zoneRow}>
              {SHOW_TIMEZONES.map((option) => (
                <Pressable
                  key={option.value}
                  style={[styles.zoneChip, zoneChoice === option.value && styles.zoneChipOn]}
                  onPress={() => setZoneChoice(option.value)}>
                  <Text
                    style={[styles.zoneText, zoneChoice === option.value && styles.zoneTextOn]}>
                    {option.label.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
              <Pressable
                style={[styles.zoneChip, zoneChoice === 'other' && styles.zoneChipOn]}
                onPress={() => setZoneChoice('other')}>
                <Text style={[styles.zoneText, zoneChoice === 'other' && styles.zoneTextOn]}>
                  OTHER
                </Text>
              </Pressable>
            </View>
            {zoneChoice === 'other' ? (
              <TextInput
                style={styles.input}
                placeholder="America/Anchorage"
                placeholderTextColor="#55585f"
                value={customZone}
                onChangeText={setCustomZone}
                autoCapitalize="none"
                autoCorrect={false}
              />
            ) : null}
            {zoneHint ? <Text style={styles.hint}>{zoneHint}</Text> : null}
            <Text style={styles.sub}>
              {startsAt && timezone
                ? `Fans will see: ${previewLabel(startsAt, timezone)}.${
                    inPast ? ' Heads up — that date has already passed.' : ''
                  }`
                : 'Use the time printed on the ticket — the venue’s local time.'}
            </Text>

            <Text style={styles.label}>TICKETS</Text>
            <View style={[styles.statusRow, styles.modeRow]}>
              {SALES_MODES.map((mode) => (
                <Pressable
                  key={mode}
                  style={[styles.statusChip, salesMode === mode && styles.statusChipOn]}
                  onPress={() => setSalesMode(mode)}>
                  <Text
                    style={[
                      styles.statusText,
                      styles.modeText,
                      salesMode === mode && styles.statusTextOn,
                    ]}>
                    {SALES_MODE_LABEL[mode].toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>

            {salesMode === 'in_app' ? (
              <View style={styles.pairRow}>
                <View style={styles.pairCell}>
                  <Text style={styles.label}>PRICE ($)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="45"
                    placeholderTextColor="#55585f"
                    keyboardType="decimal-pad"
                    value={price}
                    onChangeText={setPrice}
                    maxLength={9}
                  />
                </View>
                <View style={styles.pairCell}>
                  <Text style={styles.label}>CAPACITY</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Unlimited"
                    placeholderTextColor="#55585f"
                    keyboardType="number-pad"
                    value={capacity}
                    onChangeText={setCapacity}
                    maxLength={7}
                  />
                </View>
              </View>
            ) : salesMode === 'link' ? (
              <>
                <Text style={styles.label}>TICKET LINK</Text>
                <TextInput
                  style={styles.input}
                  placeholder="https://… (blank shows “Tickets soon”)"
                  placeholderTextColor="#55585f"
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={ticketUrl}
                  onChangeText={setTicketUrl}
                />
              </>
            ) : null}
            {priceHint ? <Text style={styles.hint}>{priceHint}</Text> : null}
            {capacityHint ? <Text style={styles.hint}>{capacityHint}</Text> : null}
            {!ticketOk ? (
              <Text style={styles.hint}>Ticket links need to start with http:// or https://.</Text>
            ) : null}
            <Text style={styles.sub}>{salesNote}</Text>
            {switchNote ? <Text style={styles.sub}>{switchNote}</Text> : null}

            {editing ? (
              <>
                <Text style={styles.label}>STATUS</Text>
                <View style={styles.statusRow}>
                  {STATUS_ORDER.map((value) => (
                    <Pressable
                      key={value}
                      style={[styles.statusChip, status === value && styles.statusChipOn]}
                      onPress={() => setStatus(value)}>
                      <Text style={[styles.statusText, status === value && styles.statusTextOn]}>
                        {SHOW_STATUS_LABEL[value].toUpperCase()}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            <Pressable
              style={[styles.create, (!valid || saving) && styles.createDisabled]}
              disabled={!valid || saving}
              onPress={handleSubmit}>
              {saving ? (
                <ActivityIndicator color="#0b0c0e" />
              ) : (
                <Text style={styles.createText}>
                  {editing ? 'SAVE CHANGES' : inPast ? 'ADD PAST SHOW' : 'POST SHOW · PUSH EVERY FAN'}
                </Text>
              )}
            </Pressable>
            <Text style={styles.subCenter}>
              {editing
                ? 'Edits are quiet — no push goes out. Fans see the change next time they open the app.'
                : inPast
                  ? 'Past dates go straight to the archive — no push.'
                  : 'Fans get a push the moment you post this.'}
            </Text>

            {editing && sold > 0 ? (
              // Sold tickets pin the show (the database refuses the delete), so
              // steer the artist to the CANCELLED status above instead.
              <Text style={[styles.subCenter, styles.deleteNote]}>
                Fans already bought tickets for this show — mark it cancelled instead of deleting
                it.
              </Text>
            ) : editing ? (
              confirmDelete ? (
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmText}>Delete this show?</Text>
                  <Pressable onPress={handleDelete}>
                    <Text style={styles.confirmYes}>DELETE</Text>
                  </Pressable>
                  <Pressable onPress={() => setConfirmDelete(false)}>
                    <Text style={styles.confirmNo}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={styles.deleteRow}
                  disabled={saving}
                  onPress={() => setConfirmDelete(true)}>
                  <Text style={styles.deleteText}>Delete show</Text>
                </Pressable>
              )
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { color: '#fff', fontSize: 17, fontFamily: DISPLAY_FONT, letterSpacing: 2 },
  cancel: { color: '#8f99a3', fontSize: 15 },
  error: { color: '#f87171', paddingHorizontal: 16, paddingBottom: 6, fontSize: 13 },
  // Deep enough that the price/capacity row and the button scroll above the keyboard.
  body: { padding: 16, paddingBottom: 160 },
  input: {
    backgroundColor: '#131519',
    color: '#fff',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    marginBottom: 12,
  },
  pairRow: { flexDirection: 'row', gap: 10 },
  pairCell: { flex: 1 },
  label: {
    color: '#6d7076',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginBottom: 7,
    marginTop: 6,
  },
  hint: { color: '#f87171', fontSize: 11.5, lineHeight: 16, marginTop: -4, marginBottom: 10 },
  // Same seat as a hint, but calm: we read the date fine, just say how.
  readAs: { color: '#c3cdd6', fontSize: 11.5, lineHeight: 16, marginTop: -4, marginBottom: 10 },
  zoneRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 },
  zoneChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#1a1d22',
  },
  zoneChipOn: { backgroundColor: '#c3cdd6' },
  zoneText: { color: '#8f99a3', fontWeight: '700', fontSize: 10.5, letterSpacing: 1 },
  zoneTextOn: { color: '#0b0c0e' },
  sub: { color: '#55585f', fontSize: 12, lineHeight: 17, marginBottom: 8 },
  statusRow: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  statusChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#1a1d22',
    alignItems: 'center',
  },
  statusChipOn: { backgroundColor: '#ffffff' },
  statusText: { color: '#8f99a3', fontWeight: '800', fontSize: 11, letterSpacing: 1.5 },
  statusTextOn: { color: '#0b0c0e' },
  modeRow: { marginBottom: 12 },
  // Three labels across a phone — a touch tighter than the two-word status chips.
  modeText: { fontSize: 10, letterSpacing: 1 },
  create: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    padding: 15,
    alignItems: 'center',
    marginTop: 18,
  },
  createDisabled: { opacity: 0.4 },
  createText: { color: '#0b0c0e', fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },
  subCenter: {
    color: '#55585f',
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 10,
  },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#131519',
    borderRadius: 12,
    padding: 13,
    marginTop: 22,
  },
  confirmText: { color: '#ccc', flex: 1, fontSize: 13 },
  confirmYes: { color: '#f87171', fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  confirmNo: { color: '#8f99a3', fontSize: 13 },
  deleteRow: { alignItems: 'center', marginTop: 22 },
  deleteText: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  deleteNote: { marginTop: 22 },
});
