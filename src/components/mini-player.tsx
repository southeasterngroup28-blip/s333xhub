import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pressFeedback, tapFeedback } from '@/lib/haptics';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { usePlayerControls, usePlayerStatus } from '@/providers/player-provider';

/** Compact now-playing bar pinned above the tab bar while a track is loaded. */
export function MiniPlayer() {
  const { current, toggle } = usePlayerControls();
  const { status, starting, startingSlow, failed } = usePlayerStatus();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const reduceMotion = useReduceMotion();

  const currentTime = status?.currentTime ?? 0;
  const duration = status?.duration ?? 0;

  // Position hairline: glides between the 500ms status ticks on the UI
  // thread, so the line sweeps instead of stepping.
  const prog = useSharedValue(0);
  useEffect(() => {
    // A new track starts the line over — jump, never glide backwards.
    prog.value = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.postId]);
  useEffect(() => {
    if (duration > 0 && !starting) {
      // Reduce Motion steps straight to the spot; otherwise glide there.
      prog.value = reduceMotion
        ? currentTime / duration
        : withTiming(currentTime / duration, {
            duration: 500,
            easing: Easing.linear,
          });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, duration, starting, reduceMotion]);
  const hairline = useAnimatedStyle(() => ({ width: `${prog.value * 100}%` as `${number}%` }));

  if (!current) return null;
  const playing = !!status?.playing || starting;
  const spinner = starting && startingSlow;
  const showPlayGlyph = failed || !playing;

  return (
    <Animated.View
      entering={FadeInUp.duration(220)}
      style={[styles.wrap, { bottom: insets.bottom + 76 }]}>
      <Pressable
        style={({ pressed }) => [styles.body, pressed && styles.bodyPressed]}
        onPress={() => {
          if (failed) {
            // The sub line reads "Tap to retry" — so this tap retries,
            // exactly like the disc, instead of yanking to the post.
            pressFeedback();
            toggle();
            return;
          }
          tapFeedback();
          router.push(`/post/${current.postId}` as never);
        }}>
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
          <Text style={styles.sub}>
            {failed ? 'Could not play. Tap to retry.' : playing ? 'Now playing' : 'Paused'}
          </Text>
        </View>
      </Pressable>
      <Pressable
        style={styles.button}
        onPress={() => {
          pressFeedback();
          toggle();
        }}
        hitSlop={10}>
        {spinner ? (
          <ActivityIndicator size="small" color="#0b0c0e" />
        ) : (
          <Ionicons
            name={showPlayGlyph ? 'play' : 'pause'}
            size={17}
            color="#0b0c0e"
            style={showPlayGlyph && styles.nudge}
          />
        )}
      </Pressable>
      {!starting && duration > 0 ? (
        // Inset 11px so the wrap's iOS shadow is not clipped by the track.
        <View style={styles.hairTrack} pointerEvents="none">
          <Animated.View style={[styles.hairFill, hairline]} />
        </View>
      ) : null}
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
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 },
  bodyPressed: { opacity: 0.7 },
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
  hairTrack: {
    position: 'absolute',
    left: 11,
    right: 11,
    bottom: 3,
    height: 2,
    borderRadius: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    overflow: 'hidden',
  },
  hairFill: { height: 2, backgroundColor: '#ffffff' },
});
