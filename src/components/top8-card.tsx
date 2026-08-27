import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { TopFan } from '@/lib/social';

type Props = {
  fans: TopFan[];
  viewerIsArtist: boolean;
};

/** The MySpace classic, distilled: the artist's hand-picked Top 3, atop the feed. */
export function Top8Card({ fans, viewerIsArtist }: Props) {
  const router = useRouter();
  if (fans.length === 0 && !viewerIsArtist) return null;

  const slots = Array.from({ length: 3 }, (_, i) => fans.find((f) => f.position === i + 1) ?? null);

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>TOP 3</Text>
        <Text style={styles.sub}>picked by the artist</Text>
        {viewerIsArtist ? (
          <Pressable onPress={() => router.push('/top8')} hitSlop={10} style={styles.edit}>
            <Ionicons name="pencil" size={14} color="#8f99a3" />
          </Pressable>
        ) : null}
      </View>
      <View style={styles.grid}>
        {slots.map((fan, index) => (
          <View key={index} style={styles.slot}>
            <View style={[styles.avatar, fan && styles.avatarFilled]}>
              <Text style={styles.letter}>
                {fan ? (fan.profile?.display_name ?? '?').slice(0, 1).toUpperCase() : '?'}
              </Text>
            </View>
            <Text style={styles.name} numberOfLines={1}>
              {fan ? fan.profile?.display_name ?? '?' : 'you?'}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(16, 18, 22, 0.8)',
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
  title: { color: '#f4f5f6', fontFamily: 'Anton_400Regular', fontSize: 15, letterSpacing: 2 },
  sub: { color: '#6d7076', fontSize: 11 },
  edit: { marginLeft: 'auto' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 12 },
  slot: { width: '30%', flexGrow: 1, alignItems: 'center' },
  avatar: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: '#1a1d22',
    borderWidth: 1,
    borderColor: '#23262b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFilled: { borderColor: '#c3cdd6' },
  letter: { color: '#8f99a3', fontWeight: '700', fontSize: 17 },
  name: { color: '#9a9ba3', fontSize: 10, marginTop: 4, maxWidth: '100%' },
});
