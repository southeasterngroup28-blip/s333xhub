import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Component, useCallback, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorCard } from '@/components/empty-state';
import { PushedHeader } from '@/components/pushed-header';
import { Skeleton } from '@/components/skeleton';
import { TopNotice } from '@/components/top-notice';
import { DISPLAY_FONT, capLabel, eyebrowLg, sectionHead } from '@/constants/type';
import { fanCopy } from '@/lib/fan-error';
import { tapFeedback } from '@/lib/haptics';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { showDateParts, showRelative } from '@/lib/shows';
import { fetchTicket, peekTicketSeed, priceLabel, type Ticket } from '@/lib/tickets';

// The QR is drawn by react-native-qrcode-svg on top of react-native-svg,
// which looks up its native module the moment it's imported. A build made
// before the ticket screen was added would throw right there — and a route
// module that throws takes the whole router down with it. So the code is
// required lazily, inside the card, and a miss shows a note instead of a
// crash. (Only the type comes in at the top — types are erased.)
type QrModule = typeof import('react-native-qrcode-svg');
type QrComponent = QrModule['default'];
let qrComponent: QrComponent | null | undefined;

function loadQrCode(): QrComponent | null {
  if (qrComponent !== undefined) return qrComponent;
  try {
    qrComponent = (require('react-native-qrcode-svg') as QrModule).default ?? null;
  } catch (e) {
    console.warn('[ticket] QR code module is missing from this build; code hidden.', e);
    qrComponent = null;
  }
  return qrComponent;
}

/** The QR is the whole point — big enough for a scanner across a table. */
const QR_SIZE = 220;

/** While this screen is open, re-read every so often so a door scan shows up here. */
const WATCH_MS = 10_000;

export default function TicketScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  // The buy flow and the ticket strips seed the row they already hold, so
  // the payoff screen paints instantly; the fetch below still reconciles.
  const [ticket, setTicket] = useState<Ticket | null>(() => (id ? peekTicketSeed(id) : null));
  const [loading, setLoading] = useState(ticket === null);
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
      setError(fanCopy(e, 'Could not load the ticket.'));
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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <PushedHeader title="TICKET" fallback="/(tabs)/shows" />
      {error && ticket ? (
        <TopNotice tone="error" text={error} onDismiss={() => setError(null)} />
      ) : null}
      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <TicketSkeleton />
        ) : ticket ? (
          <TicketCard ticket={ticket} />
        ) : error ? (
          // Offline is not "gone": the ticket row is safe on the server.
          <ErrorCard
            title="COULDN'T LOAD YOUR TICKET"
            onRetry={() => {
              tapFeedback();
              // Before load(): load() alone never re-sets loading, and the
              // skeleton coming back instantly is the acknowledgment.
              setLoading(true);
              load();
            }}
          />
        ) : (
          // A fetch that genuinely came back empty. This one CAN say gone.
          <Text style={styles.goneTitle}>THIS TICKET IS GONE</Text>
        )}
      </ScrollView>
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

type BoundaryProps = { fallback: ReactNode; children: ReactNode };
type BoundaryState = { failed: boolean };

/**
 * If drawing the code blows up mid-render (a native view this build
 * doesn't have, a token the generator chokes on), show the note in its
 * place instead of losing the whole screen.
 */
class QrBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn('[ticket] QR code failed to draw; showing the note instead.', error);
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Solid stand-in for the QR when this build can't draw one: two lines in the QR-sized tile. */
function QrUnavailable() {
  return (
    <View style={styles.qrMissing}>
      <Text style={styles.qrMissingTitle}>UPDATE THE APP</Text>
      <Text style={styles.qrMissingSub}>
        This version of the app can&apos;t draw your ticket&apos;s code. Update the app to see it.
      </Text>
    </View>
  );
}

function TicketCard({ ticket }: { ticket: Ticket }) {
  const QRCode = loadQrCode();
  const reduceMotion = useReduceMotion();
  const show = ticket.show;
  const date = show ? showDateParts(show) : null;
  const relative = show ? showRelative(show) : null;
  const cancelled = show?.status === 'cancelled';
  const orderId = ticket.stripe_payment_intent_id.slice(-8).toUpperCase();

  const statusLine =
    ticket.status === 'checked_in'
      ? `CHECKED IN${ticket.checked_in_at ? ` · ${clockAt(ticket.checked_in_at, show?.timezone)}` : ''}`
      : ticket.status === 'refunded'
        ? 'REFUNDED'
        : `PAID · ${priceLabel(ticket.amount_cents)}`;

  return (
    // The card lands first; the QR pops a beat later (below). Reduce Motion
    // trades the slide/zoom for plain fades (house pattern).
    <Animated.View
      style={styles.card}
      entering={reduceMotion ? FadeIn.duration(280) : FadeInDown.duration(280)}>
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
              {date.weekday}, {date.monthAP} {date.day} · {date.time} {date.zone}
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
        {QRCode ? (
          <QrBoundary fallback={<QrUnavailable />}>
            {/* White on a white pad — scanners want the quiet zone, so the pad is the code's own margin. */}
            <Animated.View
              style={styles.qrPad}
              entering={
                reduceMotion
                  ? FadeIn.delay(120).duration(200)
                  : ZoomIn.delay(120).springify().damping(18)
              }>
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
            </Animated.View>
          </QrBoundary>
        ) : (
          <QrUnavailable />
        )}
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
          ? "Refunded. This ticket won't scan at the door."
          : ticket.status === 'checked_in'
            ? "You're in. Enjoy the show."
            : QRCode
              ? 'Show this at the door.'
              : 'Ticket saved. Update the app to see the code.'}
      </Text>
    </Animated.View>
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
  body: { padding: 14, paddingTop: 6, paddingBottom: 40 },
  goneTitle: { ...sectionHead, paddingVertical: 8 },
  card: {
    backgroundColor: '#1a1d22',
    borderRadius: 22,
    padding: 22,
    overflow: 'hidden',
  },
  eyebrow: { ...eyebrowLg, marginBottom: 6 },
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
  // Same footprint as the QR pad, so the card doesn't jump between builds.
  qrMissing: {
    width: QR_SIZE + 32,
    minHeight: QR_SIZE + 32,
    borderRadius: 18,
    backgroundColor: '#101216',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    paddingVertical: 24,
  },
  qrMissingTitle: {
    color: '#e8e9eb',
    fontSize: 18,
    lineHeight: 22,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  qrMissingSub: {
    color: '#8f99a3',
    fontSize: 12.5,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 8,
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
  order: { ...capLabel, color: '#55585f', textAlign: 'center', marginTop: 10 },
  note: { color: '#8f99a3', fontSize: 12.5, textAlign: 'center', marginTop: 16, lineHeight: 18 },
  skeletonGap: { marginTop: 12 },
  skeletonGapSmall: { marginTop: 7 },
});
