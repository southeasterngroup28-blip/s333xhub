import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/app-background';
import { EdgeGlass, FadeMask } from '@/components/edge-fade';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import { DISPLAY_FONT } from '@/constants/type';
import { tapFeedback } from '@/lib/haptics';
import {
  fetchPastShows,
  fetchUpcomingShows,
  openTickets,
  showDateParts,
  showRelative,
  type Show,
} from '@/lib/shows';
import { useAuth } from '@/providers/auth-provider';

/** How far back the collapsed PAST section reaches. */
const PAST_LIMIT = 10;

export default function ShowsScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isArtist = profile?.role === 'artist';

  const [upcoming, setUpcoming] = useState<Show[]>([]);
  const [past, setPast] = useState<Show[]>([]);
  const [pastOpen, setPastOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // The past list is secondary - a hiccup there never blanks what's ahead.
      const [ahead, gone] = await Promise.all([
        fetchUpcomingShows(),
        fetchPastShows(PAST_LIMIT).catch(() => [] as Show[]),
      ]);
      setUpcoming(ahead);
      setPast(gone);
      setError(null);
    } catch (e) {
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
    router.push(`/show-new?id=${show.id}` as never);
  }

  // The relative eyebrow belongs to the one date fans are actually waiting on.
  const nextId = upcoming.find((s) => s.status !== 'cancelled')?.id ?? null;

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
            <Text style={styles.sectionLabel}>UPCOMING</Text>
            {upcoming.length === 0 ? (
              <EmptyState
                icon="ticket-outline"
                title="No shows announced yet"
                sub={
                  isArtist
                    ? 'Tap + to announce the first date.'
                    : "Mazze hasn't announced any shows — you'll get a push when he does."
                }
              />
            ) : (
              upcoming.map((show) => (
                <ShowRow
                  key={show.id}
                  show={show}
                  isNext={show.id === nextId}
                  editable={isArtist}
                  onEdit={() => handleEdit(show)}
                  onTickets={() => handleTickets(show)}
                />
              ))
            )}

            {past.length > 0 ? (
              <>
                <Pressable
                  style={styles.pastToggle}
                  onPress={() => {
                    tapFeedback();
                    setPastOpen((open) => !open);
                  }}
                  hitSlop={8}>
                  <Text style={styles.sectionLabel}>PAST</Text>
                  <Ionicons
                    name={pastOpen ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color="#6d7076"
                  />
                </Pressable>
                {pastOpen
                  ? past.map((show) => (
                      <ShowRow
                        key={show.id}
                        show={show}
                        past
                        editable={isArtist}
                        onEdit={() => handleEdit(show)}
                        onTickets={() => handleTickets(show)}
                      />
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
        {isArtist ? (
          <Pressable
            onPress={() => router.push('/show-new' as never)}
            hitSlop={12}
            style={styles.newButton}>
            <Ionicons name="add" size={22} color="#0b0c0e" />
          </Pressable>
        ) : null}
      </View>
      {error ? (
        <Text style={[styles.error, { top: insets.top + 48 }]}>{error}</Text>
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
  onEdit: () => void;
  onTickets: () => void;
};

/** One date, Spotify style: date block · title / venue / city · ticket pill. */
function ShowRow({ show, isNext = false, past = false, editable, onEdit, onTickets }: RowProps) {
  const date = showDateParts(show);
  const cancelled = show.status === 'cancelled';
  const soldOut = show.status === 'sold_out';

  return (
    <Pressable
      style={[styles.row, (cancelled || past) && styles.rowDim]}
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
      </View>

      <View style={styles.action}>
        {cancelled ? (
          <Text style={styles.chipMuted}>CANCELLED</Text>
        ) : soldOut ? (
          <View style={[styles.pill, styles.pillSold]}>
            <Text style={styles.pillSoldText}>SOLD OUT</Text>
          </View>
        ) : past ? null : show.ticket_url ? (
          <Pressable style={styles.pill} onPress={onTickets} hitSlop={6}>
            <Text style={styles.pillText}>TICKETS</Text>
          </Pressable>
        ) : (
          <Text style={styles.soon}>Tickets soon</Text>
        )}
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
  pillSold: { backgroundColor: 'rgba(195,205,214,0.1)' },
  pillSoldText: { color: '#c3cdd6', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5 },
  chipMuted: { color: '#6d7076', fontSize: 9.5, fontWeight: '700', letterSpacing: 1 },
  soon: { color: '#55585f', fontSize: 11 },
  editHint: { marginTop: 2 },
  skeletonGap: { marginTop: 7 },
});
