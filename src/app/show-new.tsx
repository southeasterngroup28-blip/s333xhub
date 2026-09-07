import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
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
  SHOW_STATUS_LABEL,
  SHOW_TIMEZONES,
  createShow,
  deleteShow,
  fetchShow,
  updateShow,
  type ShowStatus,
} from '@/lib/shows';

/** Segmented order for the edit screen; labels come from the lib so badges match. */
const STATUS_ORDER: ShowStatus[] = ['announced', 'sold_out', 'cancelled'];

// ---- The artist types the time as printed on the ticket (venue wall clock).
// ---- We store the real instant plus the zone, so every fan sees venue time.

function parseDate(raw: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Feb 30 and friends roll over when built, so a real date round-trips unchanged.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Accepts "8:00 PM", "8pm", "20:00" — whatever's on the flyer. */
function parseTime(raw: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m?\.?)?$/i.exec(raw.trim());
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

/** The stored instant, back into the form's "2026-10-18" / "8:00 PM" fields. */
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
    parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour'));
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${h12}:${get('minute')} ${hour >= 12 ? 'PM' : 'AM'}`,
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
  const [time, setTime] = useState('');
  /** One of SHOW_TIMEZONES' values, or 'other' to reveal the free-text field. */
  const [zoneChoice, setZoneChoice] = useState<string>(DEFAULT_SHOW_TIMEZONE);
  const [customZone, setCustomZone] = useState('');
  const [ticketUrl, setTicketUrl] = useState('');
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
        setStatus(show.status);
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
  const ticketOk = ticket.length === 0 || /^https?:\/\/\S+$/i.test(ticket);
  const valid = venue.trim().length > 0 && city.trim().length > 0 && !!startsAt && ticketOk;

  const whenHint =
    date.trim() && !dateParts
      ? 'Date should look like 2026-10-18.'
      : time.trim() && !timeParts
        ? 'Time should look like 8:00 PM (or 20:00).'
        : null;
  const zoneHint =
    zoneRaw && !timezone ? "That's not a timezone we recognize — try America/Chicago." : null;
  const inPast = !!startsAt && startsAt.getTime() < Date.now();

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
      ticket_url: ticket || null,
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
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
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
                style={styles.input}
                placeholder="2026-10-18"
                placeholderTextColor="#55585f"
                keyboardType="numbers-and-punctuation"
                value={date}
                onChangeText={setDate}
                maxLength={10}
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
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={8}
              />
            </View>
          </View>
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
          {!ticketOk ? (
            <Text style={styles.hint}>Ticket links need to start with http:// or https://.</Text>
          ) : null}

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

          {editing ? (
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
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
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
  body: { padding: 16, paddingBottom: 60 },
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
});
