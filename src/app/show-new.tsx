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

import { Chip, ChipRow, Field, FieldLabel, FormNote, PrimaryButton } from '@/components/form';
import { PushedHeader } from '@/components/pushed-header';
import { TopNotice } from '@/components/top-notice';
import { chip, confirmDanger, confirmQuestion, confirmWord } from '@/constants/type';
import { shortDateYear } from '@/lib/dates';
import { fanCopy } from '@/lib/fan-error';
import { errorFeedback, pressFeedback, successFeedback, tapFeedback } from '@/lib/haptics';
import {
  DEFAULT_SHOW_TIMEZONE,
  SALES_MODE_LABEL,
  SHOW_STATUS_LABEL,
  SHOW_TIMEZONES,
  createShow,
  datePartsAt,
  deleteShow,
  fetchShow,
  updateShow,
  type SalesMode,
  type ShowStatus,
} from '@/lib/shows';
import { ticketsSold } from '@/lib/tickets';

/** Segmented order for the edit screen; labels come from the lib so badges match. */
const STATUS_ORDER: ShowStatus[] = ['announced', 'sold_out', 'cancelled'];

/** In-app first. Selling in the app is the whole point of the feature. */
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
// ---- on blur the field tidies itself to "Sept 15, 2026".

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

/** The field's tidy form: "Sept 15, 2026", which parseDate reads straight back. */
function dateLabel(d: DateParts): string {
  return shortDateYear(new Date(d.year, d.month - 1, d.day));
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

/** "Sat, Oct 18 · 8:00 PM EDT", composed exactly as the ticket and the strip read it. */
function previewLabel(at: Date, tz: string): string {
  const d = datePartsAt(at, tz);
  return `${d.weekday}, ${d.monthAP} ${d.day} · ${d.time} ${d.zone}`;
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
  /** "Read that as Sept 15, 2026. Tap to change." after a guessed date; tap focuses the field. */
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
   * with sales can't be deleted (sold tickets pin it), only cancelled.
   */
  const [sold, setSold] = useState(0);
  const [status, setStatus] = useState<ShowStatus>('announced');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Red hints wait for a field's first blur — nobody gets scolded mid-word
   * ("htt" is not a broken link yet). Once a field has blurred once, its
   * hint re-validates live. Never pre-set, not even in edit mode.
   */
  const [blurred, setBlurred] = useState<
    Partial<Record<'date' | 'time' | 'price' | 'capacity' | 'zone' | 'ticket', boolean>>
  >({});
  function markBlurred(field: 'date' | 'time' | 'price' | 'capacity' | 'zone' | 'ticket') {
    setBlurred((prev) => (prev[field] ? prev : { ...prev, [field]: true }));
  }

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
        // switched to a link still has fans holding tickets. Best effort: a
        // miss only loosens the capacity check and lets Delete fall through
        // to the database's own (friendly) refusal.
        ticketsSold(show.id).then(setSold).catch(() => {});
      })
      .catch((e) => setError(fanCopy(e, 'Could not load the show.')))
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
    blurred.price && salesMode === 'in_app' && price.trim() && !priceOk
      ? priceCents === null
        ? 'Price should look like 45 or 45.50.'
        : 'Tickets need a price of at least $0.50.'
      : null;
  const capacityHint =
    blurred.capacity && salesMode === 'in_app' && capacity.trim() && !capacityOk
      ? capacityValue !== null && Number.isInteger(capacityValue) && capacityValue < sold
        ? `${sold} already sold. Capacity can't go below that.`
        : 'Capacity should be a whole number, like 200 (or blank for unlimited).'
      : null;
  const salesNote =
    salesMode === 'in_app'
      ? `${price.trim() ? '' : 'Set a ticket price to post. '}Fans pay in the app with Apple Pay or a card.${
          capacityValue && capacityOk ? ` Sales stop at ${capacityValue}.` : ' No cap on sales.'
        }${editing && sold > 0 ? ` ${sold} sold so far.` : ''}`
      : salesMode === 'link'
        ? 'Fans tap TICKETS and land on that page. Blank shows "Tickets soon".'
        : 'No ticket button. Fans just see the date and place.';
  // Switching an in-app show away from in-app doesn't touch tickets already sold.
  const switchNote =
    editing && sold > 0 && salesMode !== 'in_app'
      ? `${sold} fan${sold === 1 ? '' : 's'} already bought in the app. They keep their tickets; new in-app sales stop.`
      : null;

  const whenHint =
    blurred.date && date.trim() && !dateParts
      ? 'Could not read that date. Try Sept 15 or 9/15/2026.'
      : blurred.time && time.trim() && !timeParts
        ? 'Time should look like 8:00 PM, 8pm, or 20:00.'
        : null;
  const zoneHint =
    blurred.zone && zoneRaw && !timezone
      ? "That's not a timezone we recognize. Try America/Chicago."
      : null;
  const inPast = !!startsAt && startsAt.getTime() < Date.now();

  /** On blur: "9/15" becomes "Sept 15, 2026". A guessed reading gets a note the artist can tap to fix. */
  function tidyDate() {
    // Flag first, unconditionally: a parse fail is exactly the case that needs the hint.
    markBlurred('date');
    const parsed = parseDate(date);
    if (!parsed) return;
    const label = dateLabel(parsed);
    setDate(label);
    setDateNote(parsed.guessed ? `Read that as ${label}. Tap to change.` : null);
  }

  /** On blur: "10pm" becomes "10:00 PM". */
  function tidyTime() {
    markBlurred('time');
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
    pressFeedback();
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
        successFeedback();
        goBack();
      } else {
        await createShow(fields);
        successFeedback();
        goBack(); // /shows refetches on focus, so the new row is already there
      }
    } catch (e) {
      errorFeedback();
      setError(fanCopy(e, editId ? 'Could not save the show.' : 'Could not post the show.'));
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!editId || saving) return;
    pressFeedback();
    setConfirmDelete(false);
    setSaving(true);
    setError(null);
    try {
      await deleteShow(editId);
      successFeedback();
      goBack();
    } catch (e) {
      errorFeedback();
      setError(fanCopy(e, 'Could not delete the show.'));
      setSaving(false);
    }
  }

  // Artist-only surface; a deep-linked fan sees nothing, not a broken form.
  if (profile?.role !== 'artist') {
    return <SafeAreaView style={styles.safe} />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <PushedHeader
        title={editing ? 'EDIT SHOW' : 'NEW SHOW'}
        left={
          <Pressable
            onPress={goBack}
            hitSlop={12}
            style={({ pressed }) => (pressed ? styles.pressedDim : null)}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        }
      />

      {error ? <TopNotice tone="error" text={error} onDismiss={() => setError(null)} /> : null}

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
            keyboardShouldPersistTaps="handled">
            <Field
              placeholder="Tour or show name (optional)"
              value={title}
              onChangeText={setTitle}
              maxLength={80}
            />

            <FieldLabel>VENUE</FieldLabel>
            <Field
              placeholder="The Fillmore"
              value={venue}
              onChangeText={setVenue}
              autoCapitalize="words"
              maxLength={80}
            />

            <FieldLabel>CITY</FieldLabel>
            <Field
              placeholder="Miami, FL"
              value={city}
              onChangeText={setCity}
              autoCapitalize="words"
              maxLength={60}
            />

            <View style={styles.pairRow}>
              <View style={styles.pairCell}>
                <FieldLabel>DATE</FieldLabel>
                <Field
                  ref={dateRef}
                  placeholder="Sept 15, 2026"
                  value={date}
                  onChangeText={(text) => {
                    setDate(text);
                    setDateNote(null);
                  }}
                  onBlur={tidyDate}
                  autoCapitalize="words"
                  autoCorrect={false}
                  maxLength={40}
                />
              </View>
              <View style={styles.pairCell}>
                <FieldLabel>TIME</FieldLabel>
                <Field
                  placeholder="8:00 PM"
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

            <FieldLabel>TIMEZONE</FieldLabel>
            <ChipRow>
              {SHOW_TIMEZONES.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label.toUpperCase()}
                  on={zoneChoice === option.value}
                  onPress={() => {
                    tapFeedback();
                    setZoneChoice(option.value);
                  }}
                />
              ))}
              <Chip
                label="OTHER"
                on={zoneChoice === 'other'}
                onPress={() => {
                  tapFeedback();
                  setZoneChoice('other');
                }}
              />
            </ChipRow>
            {zoneChoice === 'other' ? (
              <Field
                placeholder="America/Anchorage"
                value={customZone}
                onChangeText={setCustomZone}
                onBlur={() => markBlurred('zone')}
                autoCapitalize="none"
                autoCorrect={false}
              />
            ) : null}
            {zoneHint ? <Text style={styles.hint}>{zoneHint}</Text> : null}
            <FormNote>
              {startsAt && timezone
                ? `Fans will see: ${previewLabel(startsAt, timezone)}.${
                    inPast ? ' That date has already passed.' : ''
                  }`
                : "Use the time printed on the ticket, the venue's local time."}
            </FormNote>

            <FieldLabel>TICKETS</FieldLabel>
            <ChipRow segmented>
              {SALES_MODES.map((mode) => (
                <Chip
                  key={mode}
                  segmented
                  label={SALES_MODE_LABEL[mode].toUpperCase()}
                  on={salesMode === mode}
                  onPress={() => {
                    tapFeedback();
                    setSalesMode(mode);
                  }}
                />
              ))}
            </ChipRow>

            {salesMode === 'in_app' ? (
              <View style={styles.pairRow}>
                <View style={styles.pairCell}>
                  <FieldLabel>PRICE ($)</FieldLabel>
                  <Field
                    placeholder="45"
                    keyboardType="decimal-pad"
                    value={price}
                    onChangeText={setPrice}
                    onBlur={() => markBlurred('price')}
                    maxLength={9}
                  />
                </View>
                <View style={styles.pairCell}>
                  <FieldLabel>CAPACITY</FieldLabel>
                  <Field
                    placeholder="Unlimited"
                    keyboardType="number-pad"
                    value={capacity}
                    onChangeText={setCapacity}
                    onBlur={() => markBlurred('capacity')}
                    maxLength={7}
                  />
                </View>
              </View>
            ) : salesMode === 'link' ? (
              <>
                <FieldLabel>TICKET LINK</FieldLabel>
                <Field
                  placeholder='https://… (blank shows "Tickets soon")'
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={ticketUrl}
                  onChangeText={setTicketUrl}
                  onBlur={() => markBlurred('ticket')}
                />
              </>
            ) : null}
            {priceHint ? <Text style={styles.hint}>{priceHint}</Text> : null}
            {capacityHint ? <Text style={styles.hint}>{capacityHint}</Text> : null}
            {blurred.ticket && !ticketOk ? (
              <Text style={styles.hint}>Ticket links need to start with http:// or https://.</Text>
            ) : null}
            <FormNote>{salesNote}</FormNote>
            {switchNote ? <FormNote>{switchNote}</FormNote> : null}

            {editing ? (
              <>
                <FieldLabel>STATUS</FieldLabel>
                <ChipRow segmented>
                  {STATUS_ORDER.map((value) => (
                    <Chip
                      key={value}
                      segmented
                      label={SHOW_STATUS_LABEL[value].toUpperCase()}
                      on={status === value}
                      onPress={() => {
                        tapFeedback();
                        setStatus(value);
                      }}
                    />
                  ))}
                </ChipRow>
              </>
            ) : null}

            <PrimaryButton
              label={editing ? 'SAVE CHANGES' : inPast ? 'ADD PAST SHOW' : 'POST SHOW · PUSH EVERY FAN'}
              disabled={!valid}
              busy={saving}
              onPress={handleSubmit}
            />
            <FormNote center>
              {editing
                ? 'Edits are quiet. No push goes out. Fans see the change next time they open the app.'
                : inPast
                  ? 'Past dates go straight to the archive. No push.'
                  : 'Fans get a push the moment you post this.'}
            </FormNote>

            {editing && sold > 0 ? (
              // Sold tickets pin the show (the database refuses the delete), so
              // steer the artist to the CANCELLED status above instead.
              <FormNote center style={styles.deleteNote}>
                Fans already bought tickets for this show. Mark it cancelled instead of deleting
                it.
              </FormNote>
            ) : editing ? (
              confirmDelete ? (
                // The inline confirm: question, go word, Cancel, in chips (post-card's).
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmText}>Delete this show?</Text>
                  <Pressable
                    onPress={handleDelete}
                    style={({ pressed }) => [styles.confirmChip, pressed && styles.pressedDim]}>
                    <Text style={styles.confirmDanger}>Delete</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setConfirmDelete(false)}
                    style={({ pressed }) => [styles.confirmChip, pressed && styles.pressedDim]}>
                    <Text style={styles.confirmGo}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [styles.deleteRow, pressed && styles.pressedDim]}
                  disabled={saving}
                  onPress={() => {
                    tapFeedback();
                    setConfirmDelete(true);
                  }}>
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
  cancel: { color: '#8f99a3', fontSize: 15 },
  // Deep enough that the price/capacity row and the button scroll above the keyboard.
  body: { padding: 16, paddingBottom: 160 },
  pairRow: { flexDirection: 'row', gap: 10 },
  pairCell: { flex: 1 },
  hint: { color: '#f87171', fontSize: 11.5, lineHeight: 16, marginTop: -4, marginBottom: 10 },
  // Same seat as a hint, but calm: we read the date fine, just say how.
  readAs: { color: '#c3cdd6', fontSize: 11.5, lineHeight: 16, marginTop: -4, marginBottom: 10 },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 22,
  },
  confirmText: { ...confirmQuestion, flexShrink: 1 },
  confirmChip: chip,
  confirmGo: confirmWord,
  confirmDanger,
  deleteRow: { alignItems: 'center', marginTop: 22 },
  deleteText: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  deleteNote: { marginTop: 22 },
  pressedDim: { opacity: 0.6 },
});
