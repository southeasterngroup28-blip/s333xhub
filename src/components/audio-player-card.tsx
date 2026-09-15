import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { DISPLAY_FONT } from '@/constants/type';
import { pressFeedback, selectFeedback, tapFeedback } from '@/lib/haptics';
import type { Project } from '@/lib/posts';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { usePlayerControls, usePlayerStatus } from '@/providers/player-provider';

type Props = {
  postId: string;
  title: string;
  url: string;
  project: Project;
  coverUrl?: string;
  /** Which vertical slice of the cover shows: 0 top … 1 bottom. */
  coverFocus?: number;
};

export function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** The project's display name, as it reads in the eyebrow. */
export function projectLabel(project: Project): string {
  return project === 's333xgod' ? 'S333XGOD' : 'MAZZE';
}

const EMBLEMS = {
  mazze: require('../../assets/images/emblem-mazze.png'),
  s333xgod: require('../../assets/images/emblem-s333xgod.png'),
} as const;

// Dark scrim the type and controls sit on. Playing: bottom two thirds only,
// so the art still breathes up top. Locked: the whole cover, a little
// heavier, so the blurred art reads as "behind glass".
const SCRIM = ['rgba(4,6,8,0)', 'rgba(4,6,8,0.58)', 'rgba(4,6,8,0.9)'] as const;
const SCRIM_STOPS = [0, 0.42, 1] as const;
const SCRIM_LOCKED = ['rgba(4,6,8,0.25)', 'rgba(4,6,8,0.55)', 'rgba(4,6,8,0.88)'] as const;
const SCRIM_LOCKED_STOPS = [0, 0.5, 1] as const;

// Past this many characters a title will not fit two lines at 36 in Anton,
// so it steps down to 30 before the ellipsis has to kick in.
const LONG_TITLE = 40;

type CoverProps = {
  project: Project;
  /** Small silver line above the title: "MAZZE", "LOCKED · S333XGOD". */
  eyebrow: string;
  title: string;
  coverUrl?: string;
  coverFocus?: number;
  /** Blurs the art and darkens the whole cover (the paid tease). */
  locked?: boolean;
  /** The row under the title: playback controls, or the unlock row. */
  children?: ReactNode;
};

/**
 * The cover IS the post: a 4:3 block of art that runs edge to edge of the
 * card, with the title typeset into its bottom edge like a magazine
 * headline. The player and the locked tease both build on this.
 */
export function AudioCover({
  project,
  eyebrow,
  title,
  coverUrl,
  coverFocus = 0.5,
  locked = false,
  children,
}: CoverProps) {
  return (
    <View style={styles.bleed}>
      <View style={styles.cover}>
        {coverUrl ? (
          <Image
            source={{ uri: coverUrl }}
            style={[StyleSheet.absoluteFill, locked && styles.artLocked]}
            contentFit="cover"
            contentPosition={{ left: '50%', top: `${coverFocus * 100}%` }}
            blurRadius={locked ? 22 : undefined}
            transition={locked ? 200 : 150}
          />
        ) : (
          // No cover art: charcoal ground with the project emblem as a watermark.
          // Two flat, absolute layers of the cover — the same shape as the art
          // above — so the emblem is measured against the cover itself rather
          // than living inside the native gradient view.
          <>
            <LinearGradient
              pointerEvents="none"
              colors={['#262b32', '#0b0d10']}
              style={StyleSheet.absoluteFill}
            />
            <Image
              source={EMBLEMS[project]}
              style={styles.emblem}
              contentFit="contain"
              blurRadius={locked ? 3 : undefined}
            />
          </>
        )}
        <LinearGradient
          pointerEvents="none"
          colors={locked ? SCRIM_LOCKED : SCRIM}
          locations={locked ? SCRIM_LOCKED_STOPS : SCRIM_STOPS}
          style={[styles.scrim, locked ? styles.scrimFull : styles.scrimLower]}
        />
        <Text style={styles.eyebrow} numberOfLines={1}>
          {eyebrow}
        </Text>
        <Text
          style={[styles.title, title.length > LONG_TITLE && styles.titleSmall]}
          numberOfLines={2}>
          {title}
        </Text>
        {children}
      </View>
    </View>
  );
}

/**
 * The scrubber, isolated so its motion lives on the UI thread: the fill and
 * thumb are shared values (drags write them directly, status ticks glide
 * them), and the only React state is the drag timestamp's whole second.
 */
function SeekBar({
  isCurrent,
  duration,
  position,
  seekTo,
}: {
  isCurrent: boolean;
  duration: number;
  position: number;
  seekTo: (seconds: number) => void;
}) {
  const [barWidth, setBarWidth] = useState(0);
  /** The dragged spot's whole second — feeds the left timestamp only. */
  const [dragSeconds, setDragSeconds] = useState<number | null>(null);
  const reduceMotion = useReduceMotion();

  const progressSV = useSharedValue(0);
  const draggingSV = useSharedValue(false);

  const widthRef = useRef(0);
  const activeRef = useRef(false);
  const durationRef = useRef(0);
  /** Where we just seeked to — held until the player's clock catches up. */
  const pendingSeekRef = useRef<number | null>(null);
  /** The bar's left edge in screen coords, captured at touch-down. */
  const leftEdgeRef = useRef(0);
  const dragFracRef = useRef(0);
  const dragSecRef = useRef(-1);
  const draggingRef = useRef(false);
  const seekToRef = useRef(seekTo);

  widthRef.current = barWidth;
  activeRef.current = isCurrent && duration > 0;
  durationRef.current = duration;
  seekToRef.current = seekTo;

  // After a seek, the status lags a beat — keep showing the seek target
  // until playback reaches it (no snap-back flicker).
  let shownPosition = position;
  if (pendingSeekRef.current != null) {
    if (Math.abs(position - pendingSeekRef.current) < 1) {
      pendingSeekRef.current = null;
    } else {
      shownPosition = pendingSeekRef.current;
    }
  }

  // At rest, each 500ms status tick glides the fill to the new spot so
  // progress sweeps instead of stepping. Drags own the value while down.
  useEffect(() => {
    if (draggingRef.current) return;
    const fraction = duration > 0 ? Math.min(1, shownPosition / duration) : 0;
    if (reduceMotion || pendingSeekRef.current != null || fraction === 0) {
      // Reduce Motion steps to each tick instead of gliding between them.
      progressSV.value = fraction;
    } else {
      progressSV.value = withTiming(fraction, { duration: 500, easing: Easing.linear });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownPosition, duration, reduceMotion]);

  function clampFraction(x: number): number {
    const width = widthRef.current;
    if (width <= 0) return 0;
    return Math.max(0, Math.min(1, x / width));
  }

  function applyDrag(fraction: number) {
    dragFracRef.current = fraction;
    // Direct write — the bar answers the finger with zero re-renders.
    progressSV.value = fraction;
    const sec = Math.floor(fraction * durationRef.current);
    if (sec !== dragSecRef.current) {
      dragSecRef.current = sec;
      setDragSeconds(sec);
    }
  }

  function endDrag() {
    draggingRef.current = false;
    draggingSV.value = false;
    dragSecRef.current = -1;
    setDragSeconds(null);
  }

  // The seek bar claims the touch the moment your finger lands on it, and
  // KEEPS it — the scroll view is refused when it tries to steal the
  // gesture, so a drag can wander anywhere on screen and keep scrubbing
  // (finger position is tracked in screen coordinates, not view-local).
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => activeRef.current,
      onMoveShouldSetPanResponder: () => activeRef.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        // locationX is view-local and pageX is screen-global: their
        // difference IS the bar's left edge, measured synchronously.
        leftEdgeRef.current = e.nativeEvent.pageX - e.nativeEvent.locationX;
        draggingRef.current = true;
        draggingSV.value = true;
        tapFeedback();
        applyDrag(clampFraction(e.nativeEvent.locationX));
      },
      onPanResponderMove: (_e, g) => {
        applyDrag(clampFraction(g.moveX - leftEdgeRef.current));
      },
      onPanResponderRelease: () => {
        const fraction = dragFracRef.current;
        endDrag();
        pendingSeekRef.current = fraction * durationRef.current;
        selectFeedback();
        seekToRef.current(fraction * durationRef.current);
      },
      onPanResponderTerminate: () => endDrag(),
    })
  ).current;

  const fillStyle = useAnimatedStyle(
    () => ({ width: progressSV.value * barWidth }),
    [barWidth]
  );
  const thumbStyle = useAnimatedStyle(
    () => ({
      transform: [
        { translateX: progressSV.value * Math.max(0, barWidth - 12) },
        {
          // Reduce Motion keeps the grab acknowledgment but drops the ease.
          scale: reduceMotion
            ? draggingSV.value
              ? 1.33
              : 1
            : withTiming(draggingSV.value ? 1.33 : 1, { duration: 120 }),
        },
      ],
    }),
    [barWidth, reduceMotion]
  );

  return (
    <View style={styles.seekCol}>
      {/* Seek bar: thin track, round thumb, grabs on touch. */}
      <View
        style={styles.seekTouch}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        {...pan.panHandlers}>
        <View style={styles.track} pointerEvents="none">
          <Animated.View style={[styles.fill, fillStyle]} />
        </View>
        {isCurrent ? (
          <Animated.View pointerEvents="none" style={[styles.thumb, thumbStyle]} />
        ) : null}
      </View>
      {/* The row keeps its height at rest so nothing jumps when play starts. */}
      <View style={styles.timesRow} pointerEvents="none">
        {isCurrent ? (
          <>
            <Text style={styles.timeStamp}>{formatTime(dragSeconds ?? shownPosition)}</Text>
            <Text style={styles.timeStamp}>{formatTime(duration)}</Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

export function AudioPlayerCard({ postId, title, url, project, coverUrl, coverFocus = 0.5 }: Props) {
  const { current, playTrack, toggle, seekTo } = usePlayerControls();
  const { status, starting, startingSlow } = usePlayerStatus();

  const isCurrent = current?.postId === postId;
  // `starting` keeps the button honest during the load gap after a tap —
  // and hides the PREVIOUS track's leftover clock while the new one loads.
  const isPlaying = isCurrent && (!!status?.playing || starting);
  const duration = isCurrent && !starting ? status?.duration ?? 0 : 0;
  const position = isCurrent && !starting ? status?.currentTime ?? 0 : 0;
  // First 600ms keeps the instant glyph flip; past that, an honest spinner.
  const spinner = isCurrent && starting && startingSlow;

  function handlePress() {
    pressFeedback();
    if (isCurrent) {
      toggle();
    } else {
      playTrack({ postId, title, url, artworkUrl: coverUrl });
    }
  }

  return (
    <AudioCover
      project={project}
      eyebrow={projectLabel(project)}
      title={title}
      coverUrl={coverUrl}
      coverFocus={coverFocus}>
      {/* Controls on the art's bottom edge: play, then the seek bar beside it. */}
      <View style={styles.controls}>
        <Pressable style={styles.play} onPress={handlePress} hitSlop={8}>
          {spinner ? (
            <ActivityIndicator size="small" color="#0b0c0e" />
          ) : (
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={20}
              color="#0b0c0e"
              style={!isPlaying && styles.playNudge}
            />
          )}
        </Pressable>

        <SeekBar isCurrent={isCurrent} duration={duration} position={position} seekTo={seekTo} />
      </View>
    </AudioCover>
  );
}

const styles = StyleSheet.create({
  // Runs edge to edge of the post card (cancels the card's 16px padding).
  bleed: { marginTop: 12, marginHorizontal: -16 },
  cover: {
    aspectRatio: 4 / 3,
    justifyContent: 'flex-end',
    paddingTop: 14,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: '#07090b',
    overflow: 'hidden',
  },
  // A blurred image goes soft at its edges; a touch of scale hides that.
  artLocked: { transform: [{ scale: 1.06 }] },
  // Centred 55% × 75% of the cover, written as insets (like the art's
  // absoluteFill) so it sizes against the cover the same way the art does.
  emblem: {
    position: 'absolute',
    top: '12.5%',
    bottom: '12.5%',
    left: '22.5%',
    right: '22.5%',
    opacity: 0.16,
  },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  scrimLower: { height: '66%' },
  scrimFull: { top: 0 },
  eyebrow: {
    color: '#c3cdd6',
    fontFamily: DISPLAY_FONT,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: 4,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  title: {
    color: '#fff',
    fontFamily: DISPLAY_FONT,
    fontSize: 36,
    // Anton's ascenders overshoot a tight line box and iOS clips them, so the
    // leading stays roomy (about 1.2x) even though the mockup drew it tighter.
    lineHeight: 44,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 8,
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  titleSmall: { fontSize: 30, lineHeight: 37 },
  controls: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
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
  // paddingTop 7: the bar's centre (7 + 15) meets the play button's (22).
  seekCol: { flex: 1, minWidth: 0, paddingTop: 7 },
  seekTouch: { height: 30, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: '#ffffff' },
  thumb: {
    position: 'absolute',
    top: 9,
    left: 0,
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
  timesRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -2, height: 14 },
  timeStamp: { color: 'rgba(255,255,255,0.72)', fontSize: 11, fontVariant: ['tabular-nums'] },
});
