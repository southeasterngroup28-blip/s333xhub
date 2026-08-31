import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pressFeedback } from '@/lib/haptics';
import { usePlayer } from '@/providers/player-provider';

/** Compact now-playing bar pinned above the tab bar while a track is loaded. */
export function MiniPlayer() {
  const { current, status, starting, toggle } = usePlayer();
  const insets = useSafeAreaInsets();

  if (!current) return null;
  const playing = !!status?.playing || starting;

  return (
    <Animated.View
      entering={FadeInUp.duration(220)}
      style={[styles.wrap, { bottom: insets.bottom + 76 }]}>
      {current.artworkUrl ? (
        <Image source={{ uri: current.artworkUrl }} style={styles.art} contentFit="cover" />
      ) : (
        <View style={[styles.art, styles.artFallback]}>
          <Ionicons name="musical-notes" size={15} color="#8f99a3" />
        </View>
      )}
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={1}>
          {current.title}
        </Text>
        <Text style={styles.sub}>{playing ? 'Now playing' : 'Paused'}</Text>
      </View>
      <Pressable
        style={styles.button}
        onPress={() => {
          pressFeedback();
          toggle();
        }}
        hitSlop={10}>
        <Ionicons
          name={playing ? 'pause' : 'play'}
          size={17}
          color="#0b0c0e"
          style={!playing && styles.nudge}
        />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: '#171b20',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#262a30',
    paddingHorizontal: 11,
    paddingVertical: 9,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  art: { width: 34, height: 34, borderRadius: 8, backgroundColor: '#1e2126' },
  artFallback: { alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1 },
  title: { color: '#fff', fontSize: 13.5, fontWeight: '700' },
  sub: { color: '#8f99a3', fontSize: 11, marginTop: 1 },
  button: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  nudge: { marginLeft: 2 },
});
