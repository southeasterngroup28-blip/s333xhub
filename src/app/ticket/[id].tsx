import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import { DISPLAY_FONT } from '@/constants/type';
import { showDateParts, showRelative } from '@/lib/shows';
import { fetchTicket, priceLabel, type Ticket } from '@/lib/tickets';

/** The QR is the whole point — big enough for a scanner across a table. */
const QR_SIZE = 220;

/** While this screen is open, re-read every so often so a door scan shows up here. */
const WATCH_MS = 10_000;

export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      setTicket(await fetchTicket(id));
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not load the ticket.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
      const timer = setInterval(load, WATCH_MS);
      return () => clearInterval(timer);
    }, [load])
  );

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/shows' as never);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <TicketSkeleton />
        ) : ticket ? (
          <TicketCard ticket={ticket} />
        ) : (
          <EmptyState
            icon="ticket-outline"
            title="No ticket here"
            sub="This ticket isn't yours, or it doesn't exist."
          />
        )}
      </ScrollView>

      <View style={[styles.topBar, { top: insets.top }]} pointerEvents="box-none">
        <Pressable onPress={goBack} hitSlop={12} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.title}>TICKET</Text>
      </View>
      {error ? <Text style={[styles.error, { top: insets.top + 48 }]}>{error}</Text> : null}
    </SafeAreaView>
  );
}

/** "9:52 PM" in the venue's zone; the phone's zone if the venue's is unknown. */
function clockAt(iso: string, timeZone: string | undefined): string {
  const when = new Date(iso);
  const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  try {
    return new Intl.DateTimeFormat(undefined, { ...options, timeZone }).format(when);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(when);
  }
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const show = ticket.show;
  const date = show ? showDateParts(show) : null;
  const relative = show ? showRelative(show) : null;
  const cancelled = show?.status === 'cancelled';
  const orderId = ticket.stripe_payment_intent_id.slice(-8).toUpperCase();

  const statusLine =
    ticket.status === 'checked_in'
      ? `CHECKED IN${ticket.checked_in_at ? ` at ${clockAt(ticket.checked_in_at, show?.timezone)}` : ''}`
      : ticket.status === 'refunded'
        ? 'REFUNDED'
        : `PAID · ${priceLabel(ticket.amount_cents)}`;

  return (
    <View style={styles.card}>
      {relative ? (
        <Text style={styles.eyebrow}>
          {cancelled ? 'CANCELLED' : relative.toUpperCase()}
        </Text>
      ) : null}
      <Text style={styles.showTitle}>{show?.title || show?.venue || 'Show'}</Text>
      {show ? (
        <>
          {show.title ? <Text style={styles.venue}>{show.venue}</Text> : null}
          <Text style={styles.city}>{show.city}</Text>
          {date ? (
            <Text style={styles.when}>
              {date.weekday}, {date.month} {date.day} · {date.time} {date.zone}
            </Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.city}>Show details unavailable</Text>
      )}

      {/* The tear line. */}
      <View style={styles.perforation}>
        <View style={[styles.notch, styles.notchLeft]} />
        <View style={styles.dashes} />
        <View style={[styles.notch, styles.notchRight]} />
      </View>

      <View style={styles.qrWrap}>
        {/* White on a white pad — scanners want the quiet zone, so the pad is the code's own margin. */}
        <View style={styles.qrPad}>
          <QRCode
            value={ticket.qr_token}
            size={QR_SIZE}
            color="#000000"
            backgroundColor="#ffffff"
            ecl="M"
          />
          {ticket.status === 'refunded' ? (
            <View style={styles.qrWash}>
              <Text style={styles.qrStamp}>REFUNDED</Text>
            </View>
          ) : null}
        </View>
      </View>

      {ticket.buyer_name ? <Text style={styles.buyer}>{ticket.buyer_name}</Text> : null}
      <Text
        style={[
          styles.status,
          ticket.status === 'checked_in' && styles.statusIn,
          ticket.status === 'refunded' && styles.statusRefunded,
        ]}>
        {statusLine}
      </Text>
      <Text style={styles.order}>ORDER {orderId}</Text>
      <Text style={styles.note}>
        {ticket.status === 'refunded'
          ? 'This ticket was refunded — it won’t scan at the door.'
          : ticket.status === 'checked_in'
            ? 'You’re in. Enjoy the show.'
            : 'Show this at the door.'}
      </Text>
    </View>
  );
}

/** Ghost of the ticket while it loads. */
function TicketSkeleton() {
  return (
    <View style={styles.card}>
      <Skeleton width="30%" height={10} />
      <Skeleton width="80%" height={28} style={styles.skeletonGap} />
      <Skeleton width="55%" height={14} style={styles.skeletonGap} />
      <Skeleton width="65%" height={12} style={styles.skeletonGapSmall} />
      <View style={styles.qrWrap}>
        <Skeleton width={QR_SIZE + 32} height={QR_SIZE + 32} radius={18} />
      </View>
      <Skeleton width="45%" height={14} style={styles.skeletonGap} />
      <Skeleton width="35%" height={11} style={styles.skeletonGapSmall} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Solid black on purpose: the QR needs contrast, not atmosphere.
  safe: { flex: 1, backgroundColor: '#000000' },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  back: { position: 'absolute', left: 12 },
  title: {
    color: '#f4f5f6',
    fontSize: 22,
    lineHeight: 27,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 2,
  },
  error: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    textAlign: 'center',
    color: '#f87171',
    paddingHorizontal: 16,
    fontSize: 13,
  },
  body: { padding: 14, paddingTop: 60, paddingBottom: 40 },
  card: {
    backgroundColor: '#1a1d22',
    borderRadius: 22,
    padding: 22,
    overflow: 'hidden',
  },
  eyebrow: { color: '#c3cdd6', fontSize: 10, fontWeight: '700', letterSpacing: 1.6, marginBottom: 6 },
  showTitle: {
    color: '#fff',
    fontFamily: DISPLAY_FONT,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: 1.5,
  },
  venue: { color: '#fff', fontSize: 15, fontWeight: '700', marginTop: 6 },
  city: { color: '#8f99a3', fontSize: 13, marginTop: 3 },
  when: { color: '#c3cdd6', fontSize: 13, fontWeight: '600', marginTop: 8 },
  perforation: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 18,
    marginHorizontal: -22,
  },
  dashes: {
    flex: 1,
    height: 0,
    borderTopWidth: 1.5,
    borderColor: '#2b2f36',
    borderStyle: 'dashed',
  },
  notch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#000000',
  },
  notchLeft: { marginLeft: -11 },
  notchRight: { marginRight: -11 },
  qrWrap: { alignItems: 'center', marginVertical: 4 },
  qrPad: {
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
  },
  qrWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.82)',
  },
  qrStamp: {
    fontFamily: DISPLAY_FONT,
    color: '#0b0c0e',
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: 4,
    borderWidth: 3,
    borderColor: '#0b0c0e',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 4,
    transform: [{ rotate: '-9deg' }],
  },
  buyer: { color: '#fff', fontSize: 15, fontWeight: '700', textAlign: 'center', marginTop: 18 },
  status: {
    color: '#c3cdd6',
    fontSize: 11.5,
    fontWeight: '800',
    letterSpacing: 1.4,
    textAlign: 'center',
    marginTop: 6,
  },
  statusIn: { color: '#7ed354' },
  statusRefunded: { color: '#f87171' },
  order: {
    color: '#55585f',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    textAlign: 'center',
    marginTop: 10,
  },
  note: { color: '#8f99a3', fontSize: 12.5, textAlign: 'center', marginTop: 16, lineHeight: 18 },
  skeletonGap: { marginTop: 12 },
  skeletonGapSmall: { marginTop: 7 },
});
