import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/app-background';
import { EdgeGlass, FadeMask } from '@/components/edge-fade';
import { EmptyState } from '@/components/empty-state';
import { MyTicketsStrip, useFanTickets, type RowTicketing } from '@/components/fan-tickets';
import { Skeleton } from '@/components/skeleton';
import { ScalePressable } from '@/components/ui/scale-pressable';
import { DISPLAY_FONT } from '@/constants/type';
import { tapFeedback } from '@/lib/haptics';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import {
  fetchPastShows,
  fetchUpcomingShows,
  openTickets,
  showDateParts,
  showRelative,
  type Show,
} from '@/lib/shows';
import { priceLabel, salesMode, ticketsSold } from '@/lib/tickets';
import { useAuth } from '@/providers/auth-provider';

/** How far back the collapsed PAST section reaches. */
const PAST_LIMIT = 10;

export default function ShowsScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isArtist = profile?.role === 'artist';
  const scrollRef = useRef<ScrollView>(null);
  const reduceMotion = useReduceMotion();

  // Re-tapping the Shows tab scrolls back to the top (switch-to is ignored).
  useEffect(
    () =>
      navigation.addListener('tabPress' as never, (() => {
        if (!navigation.isFocused()) return;
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }) as never),
    [navigation]
  );

  const [upcoming, setUpcoming] = useState<Show[]>([]);
  const [past, setPast] = useState<Show[]>([]);
  const [pastOpen, setPastOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A paid-but-lagging buy — calm copy in a neutral color, never the red slot. */
  const [notice, setNotice] = useState<string | null>(null);
  /** The last load() itself failed — the empty branch owns the story then. */
  const [loadFailed, setLoadFailed] = useState(false);
  /** Artist only: tickets sold per in-app show, for the "12 / 200 sold" line. */
  const [soldByShow, setSoldByShow] = useState<Record<string, number>>({});

  // The PAST chevron rotates instead of swapping glyphs. Reduce Motion
  // snaps it to its resting angle instead (house shared-value pattern).
  const pastChevron = useSharedValue(0);
  useEffect(() => {
    pastChevron.value = reduceMotion
      ? (pastOpen ? 180 : 0)
      : withTiming(pastOpen ? 180 : 0, { duration: 180 });
  }, [pastOpen, pastChevron, reduceMotion]);
  const pastChevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${pastChevron.value}deg` }],
  }));

  // Fan side of ticketing: what I hold, seats left, and the buy flow.
  const ticketing = useFanTickets({
    shows: upcoming,
    enabled: !isArtist,
    buyerName: profile?.display_name,
    onError: setError,
    onNotice: (message) => {
      // A retry that PAID must never sit under the previous try's red line —
      // the calm notice owns the floating slot the moment money moves.
      setError(null);
      setNotice(message);
    },
  });

  // Artist: refresh the sold counts whenever the upcoming list does. Fans
  // never fetch these; a miss just leaves that row's count blank.
  useEffect(() => {
    if (!isArtist) return;
    const inApp = upcoming.filter((show) => show.sales_mode === 'in_app');
    if (inApp.length === 0) return;
    let gone = false;
    Promise.all(
      inApp.map((show) =>
        ticketsSold(show.id)
          .then((count) => [show.id, count] as const)
          .catch(() => null)
      )
    ).then((pairs) => {
      if (gone) return;
      const counts: Record<string, number> = {};
      for (const pair of pairs) if (pair) counts[pair[0]] = pair[1];
      setSoldByShow(counts);
    });
    return () => {
      gone = true;
    };
  }, [upcoming, isArtist]);

  const load = useCallback(async () => {
    try {
      // The past list is secondary - a hiccup there never blanks what's ahead.
      const [ahead, gone] = await Promise.all([
        fetchUpcomingShows(),
        fetchPastShows(PAST_LIMIT).catch(() => [] as Show[]),
      ]);
      setUpcoming(ahead);
      setPast(gone);
      setLoadFailed(false);
      setError(null);
      setNotice(null);
    } catch (e) {
      setLoadFailed(true);
      setError((e as { message?: string })?.message ?? 'Could not load the shows.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function handleTickets(show: Show) {
    tapFeedback();
    openTickets(show).catch((e) => {
      setError((e as { message?: string })?.message ?? 'Could not open the ticket page.');
    });
  }

  // Typed routes only regenerate while the dev server runs; the casts go when they do.
  function handleEdit(show: Show) {
    tapFeedback();
    router.push(`/show-new?id=${show.id}` as never);
  }

  // Artist: the door scanner, labelled with the show it was opened from.
  function handleScan(show?: Show) {
    tapFeedback();
    router.push((show ? `/scan?show=${show.id}` : '/scan') as never);
  }

  // The relative eyebrow belongs to the one date fans are actually waiting on.
  const nextId = upcoming.find((s) => s.status !== 'cancelled')?.id ?? null;
  // Every scan entry point is the artist's alone — the header shortcut here,
  // and each row's chip below (fans get no scan handler, so the chip has
  // nothing to render). The shortcut also waits for a door worth working.
  const canScan =
    isArtist && upcoming.some((s) => s.sales_mode === 'in_app' && s.status !== 'cancelled');

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBackground />

      {loading ? (
        <View style={styles.list}>
          <ShowRowSkeleton />
          <ShowRowSkeleton />
          <ShowRowSkeleton />
        </View>
      ) : (
        <FadeMask>
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  load();
                }}
                tintColor="#fff"
              />
            }>
            <MyTicketsStrip tickets={ticketing.owned} />
            <Text style={styles.sectionLabel}>UPCOMING</Text>
            {upcoming.length === 0 ? (
              loadFailed ? (
                <EmptyState
                  icon="cloud-offline-outline"
                  title="Couldn't load shows"
                  sub="Check your connection."
                  action={{
                    label: 'RETRY',
                    onPress: () => {
                      tapFeedback();
                      setLoading(true);
                      load();
                    },
                  }}
                />
              ) : (
                <EmptyState
                  icon="ticket-outline"
                  title="No shows announced yet"
                  sub={
                    isArtist
                      ? 'Tap + to announce the first date.'
                      : "Mazze hasn't announced any shows — you'll get a push when he does."
                  }
                />
              )
            ) : (
              upcoming.map((show) => (
                <ShowRow
                  key={show.id}
                  show={show}
                  isNext={show.id === nextId}
                  editable={isArtist}
                  sold={isArtist ? soldByShow[show.id] : undefined}
                  onEdit={() => handleEdit(show)}
                  onTickets={() => handleTickets(show)}
                  onScan={isArtist ? () => handleScan(show) : undefined}
                  ticketing={isArtist ? undefined : ticketing.forRow(show)}
                />
              ))
            )}

            {past.length > 0 ? (
              <>
                <Pressable
                  style={({ pressed }) => [styles.pastToggle, pressed && styles.pressedDim]}
                  onPress={() => {
                    tapFeedback();
                    setPastOpen((open) => !open);
                  }}
                  hitSlop={8}>
                  <Text style={styles.sectionLabel}>PAST</Text>
                  <Animated.View style={pastChevronStyle}>
                    <Ionicons name="chevron-down" size={14} color="#6d7076" />
                  </Animated.View>
                </Pressable>
                {pastOpen
                  ? past.map((show, i) => (
                      <Animated.View
                        key={show.id}
                        entering={
                          reduceMotion
                            ? undefined
                            : FadeInDown.duration(160).delay(Math.min(i * 25, 150))
                        }>
                        <ShowRow
                          show={show}
                          past
                          editable={isArtist}
                          onEdit={() => handleEdit(show)}
                          onTickets={() => handleTickets(show)}
                          ticketing={isArtist ? undefined : ticketing.forRow(show)}
                        />
                      </Animated.View>
                    ))
                  : null}
              </>
            ) : null}
          </ScrollView>
        </FadeMask>
      )}

      <EdgeGlass />
      <View style={[styles.topBar, { top: insets.top }]} pointerEvents="box-none">
        <Text style={styles.title}>SHOWS</Text>
        {canScan ? (
          <Pressable
            onPress={() => handleScan()}
            hitSlop={12}
            style={({ pressed }) => [styles.scanButton, pressed && styles.pressedDim]}>
            <Ionicons name="scan-outline" size={14} color="#c3cdd6" />
            <Text style={styles.scanButtonText}>SCAN TICKETS</Text>
          </Pressable>
        ) : null}
        {isArtist ? (
          <ScalePressable
            onPress={() => router.push('/show-new' as never)}
            hitSlop={12}
            style={styles.newButton}>
            <Ionicons name="add" size={22} color="#0b0c0e" />
          </ScalePressable>
        ) : null}
      </View>
      {error && !(loadFailed && upcoming.length === 0) ? (
        <Text style={[styles.error, { top: insets.top + 48 }]}>{error}</Text>
      ) : notice ? (
        <Text style={[styles.noticeLine, { top: insets.top + 48 }]}>{notice}</Text>
      ) : null}
    </SafeAreaView>
  );
}

type RowProps = {
  show: Show;
  /** The soonest live date - gets the "Tonight" / "In 12 days" eyebrow. */
  isNext?: boolean;
  /** Already played - quieter, and no ticket pill. */
  past?: boolean;
  /** Artist only: tapping the row opens the editor. */
  editable: boolean;
  /** Artist only, in-app shows: tickets sold so far (undefined while loading). */
  sold?: number;
  onEdit: () => void;
  onTickets: () => void;
  /** Artist only, in-app shows: opens the door scanner for this date. */
  onScan?: () => void;
  /** Fan side: my ticket, seats left, the buy flow. Absent (artist) = no buy pill. */
  ticketing?: RowTicketing;
};

/** "12 / 200 sold" or "12 sold · no cap" — the artist's read on an in-app date. */
function soldLabel(show: Show, sold: number | undefined): string {
  const count = sold ?? '–';
  return show.capacity ? `${count} / ${show.capacity} sold` : `${count} sold · no cap`;
}

/** One date, Spotify style: date block · title / venue / city · ticket pill. */
function ShowRow({
  show,
  isNext = false,
  past = false,
  editable,
  sold,
  onEdit,
  onTickets,
  onScan,
  ticketing,
}: RowProps) {
  const date = showDateParts(show);
  const cancelled = show.status === 'cancelled';
  const soldOut = show.status === 'sold_out';
  const mode = salesMode(show);
  const price = show.ticket_price_cents ?? 0;
  // Artist: the sold line + the scanner live on in-app dates that haven't
  // wrapped. `editable` is the artist flag, so fans never see either.
  const artistSales = editable && !past && show.sales_mode === 'in_app';

  return (
    <Pressable
      // Disabled for fans, so a fan's row never dims under a stray touch.
      style={({ pressed }) => [
        styles.row,
        (cancelled || past) && styles.rowDim,
        pressed && styles.pressedDim,
      ]}
      disabled={!editable}
      onPress={onEdit}>
      <View style={[styles.dateBlock, isNext && styles.dateBlockNext]}>
        <Text style={styles.month}>{date.month.toUpperCase()}</Text>
        <Text style={styles.day}>{date.day}</Text>
      </View>

      <View style={styles.meta}>
        {isNext ? <Text style={styles.eyebrow}>{showRelative(show).toUpperCase()}</Text> : null}
        {show.title ? (
          <Text style={styles.showTitle} numberOfLines={1}>
            {show.title}
          </Text>
        ) : null}
        <Text style={[styles.venue, cancelled && styles.venueCancelled]} numberOfLines={1}>
          {show.venue}
        </Text>
        <Text style={styles.city} numberOfLines={1}>
          {show.city} · {date.weekday} {date.time}
        </Text>
        {artistSales ? (
          <View style={styles.salesLine}>
            <Text style={styles.salesText}>{soldLabel(show, sold)}</Text>
            {onScan && !cancelled ? (
              <Pressable
                style={({ pressed }) => [styles.scanChip, pressed && styles.pressedDim]}
                onPress={onScan}
                hitSlop={12}>
                <Ionicons name="scan-outline" size={11} color="#c3cdd6" />
                <Text style={styles.scanChipText}>SCAN</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.action}>
        {cancelled ? (
          <Text style={styles.chipMuted}>CANCELLED</Text>
        ) : ticketing?.ticket ? (
          <ScalePressable style={styles.pill} onPress={ticketing.onTicket} hitSlop={6}>
            <Text style={styles.pillText}>YOUR TICKET</Text>
          </ScalePressable>
        ) : soldOut ? (
          <View style={[styles.pill, styles.pillSold]}>
            <Text style={styles.pillSoldText}>SOLD OUT</Text>
          </View>
        ) : past ? null : mode === 'in_app' ? (
          price <= 0 ? (
            <Text style={styles.soon}>Tickets soon</Text>
          ) : !ticketing ? (
            <Text style={styles.soon}>{priceLabel(price)} · in app</Text>
          ) : ticketing.buying ? (
            // 'sheet' dims a touch; a CONFIRMED payment renders full strength —
            // paid must never look more disabled than idle.
            <View
              style={[
                styles.pill,
                styles.pillRow,
                ticketing.phase !== 'issuing' && styles.pillBusy,
              ]}>
              <ActivityIndicator
                size="small"
                color="#0b0c0e"
                style={styles.pillSpinner}
              />
              <Text style={styles.pillText}>
                {ticketing.phase === 'issuing' ? 'PAID. GETTING YOUR TICKET' : 'BUYING…'}
              </Text>
            </View>
          ) : ticketing.left === 0 ? (
            <View style={[styles.pill, styles.pillSold]}>
              <Text style={styles.pillSoldText}>SOLD OUT</Text>
            </View>
          ) : (
            <ScalePressable style={styles.pill} onPress={ticketing.onBuy} hitSlop={6}>
              <Text style={styles.pillText}>{`BUY TICKET · ${priceLabel(price)}`}</Text>
            </ScalePressable>
          )
        ) : mode === 'link' ? (
          show.ticket_url ? (
            <ScalePressable style={styles.pill} onPress={onTickets} hitSlop={6}>
              <Text style={styles.pillText}>TICKETS</Text>
            </ScalePressable>
          ) : (
            <Text style={styles.soon}>Tickets soon</Text>
          )
        ) : null /* 'none': a free / walk-up night has no ticket affordance at all */}
        {editable ? (
          <Ionicons name="pencil" size={12} color="#55585f" style={styles.editHint} />
        ) : null}
      </View>
    </Pressable>
  );
}

/** Ghost of a show row while the dates load. */
function ShowRowSkeleton() {
  return (
    <View style={styles.row}>
      <Skeleton width={52} height={56} radius={12} />
      <View style={styles.meta}>
        <Skeleton width="55%" height={13} />
        <Skeleton width="72%" height={10} style={styles.skeletonGap} />
      </View>
      <Skeleton width={68} height={26} radius={999} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
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
  title: { color: '#f4f5f6', fontSize: 22, fontFamily: DISPLAY_FONT, letterSpacing: 2 },
  newButton: {
    position: 'absolute',
    right: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanButton: {
    position: 'absolute',
    left: 16,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    backgroundColor: '#1a1d22',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  scanButtonText: { color: '#c3cdd6', fontSize: 9.5, fontWeight: '800', letterSpacing: 1 },
  salesLine: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  salesText: { color: '#c3cdd6', fontSize: 11, fontWeight: '700' },
  scanChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1a1d22',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  scanChipText: { color: '#c3cdd6', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
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
  // Same seat as the red line, calmer voice: money moved, nothing is wrong.
  noticeLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    textAlign: 'center',
    color: '#c3cdd6',
    paddingHorizontal: 16,
    fontSize: 13,
  },
  pressedDim: { opacity: 0.6 },
  list: { padding: 14, paddingTop: 52, paddingBottom: 150, flexGrow: 1 },
  sectionLabel: {
    color: '#6d7076',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginTop: 10,
    marginBottom: 10,
  },
  pastToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#101216',
    borderRadius: 16,
    padding: 13,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  rowDim: { opacity: 0.45 },
  dateBlock: {
    width: 52,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: '#1a1d22',
    borderWidth: 1,
    borderColor: '#23262b',
    alignItems: 'center',
  },
  dateBlockNext: { borderColor: '#c3cdd6' },
  month: { color: '#c3cdd6', fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4 },
  day: { color: '#fff', fontFamily: DISPLAY_FONT, fontSize: 24, letterSpacing: 0.5, marginTop: 1 },
  meta: { flex: 1 },
  eyebrow: { color: '#c3cdd6', fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, marginBottom: 3 },
  showTitle: { color: '#8f99a3', fontSize: 11.5, marginBottom: 1 },
  venue: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
  venueCancelled: { textDecorationLine: 'line-through', color: '#8f99a3' },
  city: { color: '#8f99a3', fontSize: 12, marginTop: 2 },
  action: { alignItems: 'flex-end', gap: 6 },
  pill: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  pillText: { color: '#0b0c0e', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5 },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pillSpinner: { transform: [{ scale: 0.7 }], marginVertical: -3 },
  pillSold: { backgroundColor: 'rgba(195,205,214,0.1)' },
  pillSoldText: { color: '#c3cdd6', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5 },
  pillBusy: { opacity: 0.85 },
  chipMuted: { color: '#6d7076', fontSize: 9.5, fontWeight: '700', letterSpacing: 1 },
  soon: { color: '#55585f', fontSize: 11 },
  editHint: { marginTop: 2 },
  skeletonGap: { marginTop: 7 },
});
