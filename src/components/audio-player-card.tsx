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
import { DISPLAY_FONT } from '@/constants/type';

type Props = {
  postId: string;
  title: string;
  url: string;
  coverUrl?: string;
  /** Which vertical slice of the cover shows: 0 top … 1 bottom. */
  coverFocus?: number;
};

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
    return () => cancelAnimation(height);
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
  /** Where we just seeked to — shown until the player's clock catches up. */
  const pendingSeekRef = useRef<number | null>(null);

  const isCurrent = current?.postId === postId;
  // `starting` keeps the button honest during the load gap after a tap —
  // and hides the PREVIOUS track's leftover clock while the new one loads.
  const isPlaying = isCurrent && (!!status?.playing || starting);
  const duration = isCurrent && !starting ? status?.duration ?? 0 : 0;
  const rawPosition = isCurrent && !starting ? status?.currentTime ?? 0 : 0;

  // After a seek, the status lags a beat — keep showing the seek target
  // until playback reaches it (no snap-back flicker).
  let position = rawPosition;
  if (pendingSeekRef.current != null) {
    if (Math.abs(rawPosition - pendingSeekRef.current) < 1) {
      pendingSeekRef.current = null;
    } else {
      position = pendingSeekRef.current;
    }
  }
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;
  const shownFraction = dragFraction ?? progress;

  widthRef.current = barWidth;
  currentRef.current = isCurrent;
  durationRef.current = duration;

  /** The bar's left edge in screen coords, captured at touch-down. */
  const leftEdgeRef = useRef(0);
  const dragFracRef = useRef(0);

  // The seek bar claims the touch the moment your finger lands on it, and
  // KEEPS it — the scroll view is refused when it tries to steal the
  // gesture, so a drag can wander anywhere on screen and keep scrubbing
  // (finger position is tracked in screen coordinates, not view-local).
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => currentRef.current && durationRef.current > 0,
      onMoveShouldSetPanResponder: () => currentRef.current && durationRef.current > 0,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        // locationX is view-local and pageX is screen-global: their
        // difference IS the bar's left edge, measured synchronously.
        leftEdgeRef.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
        const fraction = clampFraction(e.nativeEvent.locationX);
        dragFracRef.current = fraction;
        setDragFraction(fraction);
      },
      onPanResponderMove: (_e, g) => {
        const fraction = clampFraction(g.moveX - leftEdgeRef.current);
        dragFracRef.current = fraction;
        setDragFraction(fraction);
      },
      onPanResponderRelease: () => {
        const fraction = dragFracRef.current;
        setDragFraction(null);
        pendingSeekRef.current = fraction * durationRef.current;
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
            {!isCurrent ? <Text style={styles.time}>Tap to play</Text> : null}
          </View>
        </View>
      </View>

      {/* Seek bar: thin track, round thumb, grabs on touch. */}
      <View
        style={styles.seekTouch}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        {...pan.panHandlers}>
        <View style={styles.track} pointerEvents="none">
          <View style={[styles.fill, { width: `${shownFraction * 100}%` }]} />
        </View>
        {isCurrent ? (
          <View
            pointerEvents="none"
            style={[
              styles.thumb,
              dragFraction != null && styles.thumbActive,
              {
                left: Math.max(
                  0,
                  Math.min(
                    barWidth - (dragFraction != null ? 16 : 12),
                    shownFraction * barWidth - (dragFraction != null ? 8 : 6)
                  )
                ),
              },
            ]}
          />
        ) : null}
      </View>
      {isCurrent ? (
        <View style={styles.timesRow} pointerEvents="none">
          <Text style={styles.timeStamp}>
            {formatTime(dragFraction != null ? dragFraction * duration : position)}
          </Text>
          <Text style={styles.timeStamp}>{formatTime(duration)}</Text>
        </View>
      ) : null}
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
    fontFamily: DISPLAY_FONT,
    fontWeight: 'normal',
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 6,
  },
  time: { color: '#99a1a9', fontSize: 12, marginTop: 2 },
  eq: { flexDirection: 'row', alignItems: 'flex-end', gap: 2.5, height: 16 },
  eqBar: { width: 3, borderRadius: 2, backgroundColor: '#c3cdd6' },
  seekTouch: { height: 30, justifyContent: 'center', marginTop: 4 },
  track: { height: 4, borderRadius: 2, backgroundColor: '#2a2f36', overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: '#ffffff' },
  thumb: {
    position: 'absolute',
    top: 9,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  thumbActive: { top: 7, width: 16, height: 16, borderRadius: 8 },
  timesRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -2 },
  timeStamp: { color: '#8f99a3', fontSize: 11, fontVariant: ['tabular-nums'] },
});
