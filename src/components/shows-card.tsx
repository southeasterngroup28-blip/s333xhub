import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { DISPLAY_FONT } from '@/constants/type';
import { showDateParts, showRelative, type Show } from '@/lib/shows';

type Props = {
  /** Upcoming shows, soonest first (the feed fetches; this card only paints). */
  shows: Show[];
  viewerIsArtist: boolean;
};

/** Spotify's "On tour" card, in our chrome: the next stop on the road, atop the feed. */
export function ShowsCard({ shows, viewerIsArtist }: Props) {
  const router = useRouter();
  // A cancelled date never headlines the card - the full list still shows it.
  const next = shows.find((s) => s.status !== 'cancelled') ?? null;

  // Typed routes only regenerate while the dev server runs; the cast goes when they do.
  const openShows = () => router.push('/shows' as never);

  if (!next) {
    return (
      <Pressable style={styles.card} onPress={openShows}>
        <View style={styles.head}>
          <Text style={styles.title}>ON TOUR</Text>
          <Text style={[styles.sub, viewerIsArtist && styles.subArtist]} numberOfLines={1}>
            {viewerIsArtist ? 'Add a show' : 'No shows announced'}
          </Text>
          <Ionicons
            name={viewerIsArtist ? 'add' : 'chevron-forward'}
            size={14}
            color="#8f99a3"
            style={styles.affordance}
          />
        </View>
      </Pressable>
    );
  }

  const date = showDateParts(next);

  return (
    <Pressable style={styles.card} onPress={openShows}>
      <View style={styles.head}>
        <Text style={styles.title}>ON TOUR</Text>
        {next.title ? (
          <Text style={styles.sub} numberOfLines={1}>
            {next.title}
          </Text>
        ) : null}
        <View style={styles.affordance}>
          <Text style={styles.all}>All shows</Text>
          <Ionicons name="arrow-forward" size={12} color="#8f99a3" />
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.dateBlock}>
          <Text style={styles.month}>{date.month.toUpperCase()}</Text>
          <Text style={styles.day}>{date.day}</Text>
        </View>
        <View style={styles.meta}>
          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow}>{showRelative(next).toUpperCase()}</Text>
            {next.status === 'sold_out' ? <Text style={styles.chip}>SOLD OUT</Text> : null}
          </View>
          <Text style={styles.venue} numberOfLines={1}>
            {next.venue}
          </Text>
          <Text style={styles.city} numberOfLines={1}>
            {next.city} · {date.weekday} {date.time}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#101216',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 14,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  head: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  title: { color: '#f4f5f6', fontFamily: DISPLAY_FONT, fontSize: 15, letterSpacing: 2 },
  sub: { color: '#6d7076', fontSize: 11, flexShrink: 1 },
  subArtist: { color: '#c3cdd6' },
  affordance: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4 },
  all: { color: '#8f99a3', fontSize: 11 },
  body: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14 },
  dateBlock: {
    width: 56,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#1a1d22',
    borderWidth: 1,
    borderColor: '#c3cdd6',
    alignItems: 'center',
  },
  month: { color: '#c3cdd6', fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4 },
  day: { color: '#fff', fontFamily: DISPLAY_FONT, fontSize: 26, letterSpacing: 0.5, marginTop: 1 },
  meta: { flex: 1 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 },
  eyebrow: { color: '#c3cdd6', fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4 },
  chip: {
    fontSize: 8.5,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#c3cdd6',
    backgroundColor: 'rgba(195,205,214,0.1)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  venue: { color: '#fff', fontSize: 15.5, fontWeight: '700' },
  city: { color: '#8f99a3', fontSize: 12, marginTop: 2 },
});
