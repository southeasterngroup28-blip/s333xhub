import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { pressFeedback } from '@/lib/haptics';
import { usePlayer } from '@/providers/player-provider';

type Props = {
  postId: string;
  title: string;
  url: string;
  coverUrl?: string;
  /** Which vertical slice of the cover shows: 0 top … 1 bottom. */
  coverFocus?: number;
};

const WAVE_BARS = 36;
/** Deterministic pseudo-waveform so every track keeps its own shape. */
function barHeight(index: number): number {
  return 7 + ((index * 37) % 19);
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** One dancing equalizer bar (the classic "this one's playing" tell). */
function EqBar({ active, delay }: { active: boolean; delay: number }) {
  const height = useSharedValue(4);

  useEffect(() => {
    if (active) {
      height.value = withDelay(
        delay,
        withRepeat(
          withSequence(
            withTiming(15, { duration: 240 }),
            withTiming(5, { duration: 220 }),
            withTiming(11, { duration: 200 })
          ),
          -1,
          true
        )
      );
    } else {
      cancelAnimation(height);
      height.value = withTiming(4, { duration: 150 });
    }
  }, [active, delay, height]);

  const style = useAnimatedStyle(() => ({ height: height.value }));
  return <Animated.View style={[styles.eqBar, style]} />;
}

export function AudioPlayerCard({ postId, title, url, coverUrl, coverFocus = 0.5 }: Props) {
  const { current, status, starting, playTrack, toggle, seekTo } = usePlayer();
  const [barWidth, setBarWidth] = useState(0);
  /** While the thumb is being dragged, the waveform previews that spot. */
  const [dragFraction, setDragFraction] = useState<number | null>(null);
  const widthRef = useRef(0);
  const currentRef = useRef(false);
  const durationRef = useRef(0);

  const isCurrent = current?.postId === postId;
  // `starting` keeps the button honest during the load gap after a tap.
  const isPlaying = isCurrent && (!!status?.playing || starting);
  const duration = isCurrent ? status?.duration ?? 0 : 0;
  const position = isCurrent ? status?.currentTime ?? 0 : 0;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const shownFraction = dragFraction ?? progress;

  widthRef.current = barWidth;
  currentRef.current = isCurrent;
  durationRef.current = duration;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => currentRef.current && durationRef.current > 0,
      onMoveShouldSetPanResponder: () => currentRef.current && durationRef.current > 0,
      onPanResponderGrant: (e) => {
        setDragFraction(clampFraction(e.nativeEvent.locationX));
      },
      onPanResponderMove: (e) => {
        setDragFraction(clampFraction(e.nativeEvent.locationX));
      },
      onPanResponderRelease: (e) => {
        const fraction = clampFraction(e.nativeEvent.locationX);
        setDragFraction(null);
        seekTo(fraction * durationRef.current);
      },
      onPanResponderTerminate: () => setDragFraction(null),
    })
  ).current;

  function clampFraction(x: number): number {
    const width = widthRef.current;
    if (width <= 0) return 0;
    return Math.max(0, Math.min(1, x / width));
  }

  function handlePress() {
    pressFeedback();
    if (isCurrent) {
      toggle();
    } else {
      playTrack({ postId, title, url, artworkUrl: coverUrl });
    }
  }

  return (
    <View style={styles.wrap}>
      {/* Art panel: album-drop sized cover when the post has one. */}
      <View style={[styles.art, coverUrl && styles.artWithCover]}>
        {coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition={{ left: '50%', top: `${coverFocus * 100}%` }}
            transition={150}
          />
        ) : (
          <View style={styles.artGlow} />
        )}
        {coverUrl ? <View style={styles.artScrim} /> : null}
        <View style={styles.artRow}>
          <Pressable style={styles.play} onPress={handlePress} hitSlop={8}>
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={20}
              color="#0b0c0e"
              style={!isPlaying && styles.playNudge}
            />
          </Pressable>
          <View style={styles.titleWrap}>
            <View style={styles.titleRow}>
              <Text
                style={[styles.trackTitle, coverUrl && styles.trackTitleBig]}
                numberOfLines={1}>
                {title}
              </Text>
              {isPlaying ? (
                <View style={styles.eq}>
                  <EqBar active delay={0} />
                  <EqBar active delay={120} />
                  <EqBar active delay={240} />
                </View>
              ) : null}
            </View>
            <Text style={styles.time}>
              {isCurrent
                ? `${formatTime(dragFraction != null ? dragFraction * duration : position)} / ${formatTime(duration)}`
                : 'Tap to play'}
            </Text>
          </View>
        </View>
      </View>

      {/* Waveform scrubber: tap or drag anywhere to move through the track. */}
      <View
        style={styles.wave}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        {...pan.panHandlers}>
        {Array.from({ length: WAVE_BARS }, (_, i) => {
          const lit = isCurrent && shownFraction >= (i + 0.5) / WAVE_BARS;
          return (
            <View
              key={i}
              style={[
                styles.waveBar,
                { height: barHeight(i) },
                lit ? styles.waveBarLit : null,
              ]}
            />
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  art: {
    borderRadius: 12,
    backgroundColor: '#171b20',
    minHeight: 110,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  artWithCover: { aspectRatio: 4 / 3 },
  artScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 96,
    backgroundColor: 'rgba(4, 6, 8, 0.55)',
  },
  artGlow: {
    position: 'absolute',
    top: -40,
    right: -20,
    width: 180,
    height: 140,
    borderRadius: 90,
    backgroundColor: 'rgba(195, 205, 214, 0.14)',
  },
  artRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  play: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  playNudge: { marginLeft: 2 },
  titleWrap: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  trackTitle: { color: '#fff', fontSize: 15, fontWeight: '700', flexShrink: 1 },
  trackTitleBig: {
    fontSize: 18,
    fontFamily: 'Anton_400Regular',
    fontWeight: 'normal',
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  time: { color: '#99a1a9', fontSize: 12, marginTop: 2 },
  eq: { flexDirection: 'row', alignItems: 'flex-end', gap: 2.5, height: 16 },
  eqBar: { width: 3, borderRadius: 2, backgroundColor: '#c3cdd6' },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
    paddingVertical: 10,
    height: 46,
  },
  waveBar: { flex: 1, borderRadius: 2, backgroundColor: '#262b31' },
  waveBarLit: { backgroundColor: '#c3cdd6' },
});
