import Ionicons from '@expo/vector-icons/Ionicons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { usePlayerControls } from '@/providers/player-provider';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { CHAT_HAIRLINE_MINE, CHAT_SURFACE, CHAT_SURFACE_MINE } from '@/constants/chat-surfaces';

/** "0:12" — the one time format for voice notes, recording included. */
export function formatSeconds(total: number): string {
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A quiet breathing white wash over a bubble that's still uploading.
 * Sits on top of whatever the bubble shows (no spinner, no dimming).
 */
export function UploadShimmer({ radius = 16 }: { radius?: number }) {
  const reduceMotion = useReduceMotion();
  const pulse = useSharedValue(0.05);

  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 0.08;
      return;
    }
    pulse.value = withRepeat(withTiming(0.16, { duration: 700 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [reduceMotion, pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: '#ffffff', borderRadius: radius },
        animated,
      ]}
    />
  );
}

// One voice note at a time: starting a new one pauses whichever was playing.
let pauseCurrentVoice: (() => void) | null = null;

// The static level line: 1px bars, drawn once — this is a picture of a
// voice note, not a scrubber (tap the play button; there's no seeking).
const BAR_HEIGHTS = [
  4, 9, 6, 12, 8, 13, 10, 5, 11, 7, 12, 9, 4, 10, 6, 12, 8, 5, 11, 7, 9, 4, 10, 6, 12, 8, 5, 9, 7,
  11, 4, 8,
];

type Props = {
  /** Signed URL — undefined while it's still being fetched. */
  url?: string;
  durationSeconds?: number | null;
  mine?: boolean;
  /** Sent by the artist — the pill's hairline turns GHOST SILVER. */
  artist?: boolean;
  /** Optimistic send still uploading — the pill wears a soft shimmer. */
  pending?: boolean;
};

type Look = Pick<Props, 'mine' | 'artist' | 'pending'>;

/** The slim hairline pill every state of the note sits inside. */
function Pill({ mine, artist, pending, children }: Look & { children: ReactNode }) {
  return (
    <View style={[styles.pill, artist && styles.pillArtist, mine && styles.pillMine]}>
      {children}
      {pending ? <UploadShimmer radius={999} /> : null}
    </View>
  );
}

/**
 * The level line. Without `progress` it's the resting picture; with it,
 * a white copy of the bars is clipped to an animated width, so playback
 * sweeps smoothly across the line instead of stepping bar by bar.
 */
function Line({ progress }: { progress?: SharedValue<number> }) {
  const [width, setWidth] = useState(0);

  const clip = useAnimatedStyle(
    () => ({ width: width * (progress ? progress.value : 0) }),
    [width, progress]
  );

  return (
    <View style={styles.line} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {BAR_HEIGHTS.map((height, i) => (
        <View key={i} style={[styles.bar, { height }]} />
      ))}
      {progress && width > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.lineClip, clip]}>
          <View style={[styles.lineRow, { width }]}>
            {BAR_HEIGHTS.map((height, i) => (
              <View key={i} style={[styles.bar, styles.barOn, { height }]} />
            ))}
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * A play/pause voice-note pill. The actual audio player is only created
 * on first tap — a chat full of voice notes must not hold dozens of
 * live buffering players for messages nobody is listening to.
 */
export function VoiceNoteBubble({ url, durationSeconds, mine, artist, pending }: Props) {
  const [activated, setActivated] = useState(false);

  if (!url) {
    return (
      <Pill mine={mine} artist={artist} pending={pending}>
        <View style={styles.play}>
          <ActivityIndicator color="#000" size="small" />
        </View>
        <Line />
        <Text style={styles.time}>{formatSeconds(durationSeconds ?? 0)}</Text>
      </Pill>
    );
  }
  if (!activated) {
    return (
      <Pill mine={mine} artist={artist} pending={pending}>
        <Pressable
          style={styles.play}
          onPress={() => setActivated(true)}
          hitSlop={8}
          accessibilityLabel="Play voice note">
          <Ionicons name="play" size={12} color="#000" style={styles.playGlyph} />
        </Pressable>
        <Line />
        <Text style={styles.time}>{formatSeconds(durationSeconds ?? 0)}</Text>
      </Pill>
    );
  }
  return (
    <Loaded url={url} durationSeconds={durationSeconds} mine={mine} artist={artist} pending={pending} />
  );
}

function Loaded({ url, durationSeconds, mine, artist, pending }: Props & { url: string }) {
  const player = useAudioPlayer(url, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  const { pause: pauseMusic } = usePlayerControls();
  const [autoplayed, setAutoplayed] = useState(false);
  // The glyph answers the TAP, not the next status poll. `intent` wins
  // until the player catches up, then hands back to the real state.
  // This component only mounts because the fan just tapped play.
  const [intent, setIntent] = useState<boolean | null>(true);
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(0);
  /** The pause handle THIS instance registered — never touch another's. */
  const myPauseRef = useRef<(() => void) | null>(null);

  const playing = status.playing;
  const total = durationSeconds ?? (status.duration || 0);
  const shown = playing || status.currentTime > 0 ? status.currentTime : total;

  useEffect(() => {
    if (intent !== null && playing === intent) setIntent(null);
  }, [intent, playing]);

  // Smooth fill: on every status tick, glide to where playback will be at
  // the NEXT tick, so the sweep never visibly steps.
  useEffect(() => {
    if (playing && total > 0) {
      const next = Math.min(1, (status.currentTime + 0.25) / total);
      progress.value = reduceMotion
        ? Math.min(1, status.currentTime / total)
        : withTiming(next, { duration: 250, easing: Easing.linear });
    } else {
      cancelAnimation(progress);
      progress.value = reduceMotion ? 0 : withTiming(0, { duration: 150 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, status.currentTime, total, reduceMotion]);

  function startPlayback() {
    // The music player and other voice notes step aside.
    pauseMusic();
    pauseCurrentVoice?.();
    const handle = () => {
      try {
        player.pause();
      } catch {}
    };
    myPauseRef.current = handle;
    pauseCurrentVoice = handle;
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
      player.seekTo(0);
    }
    player.play();
  }

  // First tap created this component — begin playing as soon as ready.
  useEffect(() => {
    if (!autoplayed && status.isLoaded) {
      setAutoplayed(true);
      startPlayback();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplayed, status.isLoaded]);

  // If this bubble unmounts while registered as the active voice, drop the
  // stale pause handle — but only OURS. Scrolling an old note out of the
  // list window must not clear the handle of the one still playing, or two
  // notes could end up playing at once.
  useEffect(() => {
    return () => {
      if (pauseCurrentVoice && pauseCurrentVoice === myPauseRef.current) {
        pauseCurrentVoice = null;
      }
    };
  }, []);

  function toggle() {
    if (playing) {
      setIntent(false);
      player.pause();
      if (pauseCurrentVoice === myPauseRef.current) pauseCurrentVoice = null;
      return;
    }
    setIntent(true);
    startPlayback();
  }

  const showPause = intent ?? playing;

  return (
    <Pill mine={mine} artist={artist} pending={pending}>
      <Pressable
        style={styles.play}
        onPress={toggle}
        hitSlop={8}
        accessibilityLabel={showPause ? 'Pause voice note' : 'Play voice note'}>
        <Ionicons
          name={showPause ? 'pause' : 'play'}
          size={12}
          color="#000"
          style={showPause ? undefined : styles.playGlyph}
        />
      </Pressable>
      <Line progress={progress} />
      <Text style={styles.time}>{formatSeconds(shown)}</Text>
    </Pill>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 34,
    minWidth: 206,
    paddingLeft: 5,
    paddingRight: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    // The same translucent fill as the chat bubbles.
    backgroundColor: CHAT_SURFACE,
  },
  pillArtist: { borderColor: 'rgba(195,205,214,0.6)' },
  // Mine reads like my text bubbles: filled one shade up, no visible hairline.
  pillMine: { backgroundColor: CHAT_SURFACE_MINE, borderColor: CHAT_HAIRLINE_MINE },
  play: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The play triangle sits optically left of centre; nudge it back.
  playGlyph: { marginLeft: 1.5 },
  line: { flex: 1, height: 14, flexDirection: 'row', alignItems: 'center', gap: 2 },
  // The playback sweep: a white copy of the bars, clipped to the played width.
  lineClip: { position: 'absolute', left: 0, top: 0, bottom: 0, overflow: 'hidden' },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 14 },
  bar: { width: 1, backgroundColor: 'rgba(255,255,255,0.38)' },
  barOn: { backgroundColor: '#ffffff' },
  time: { color: '#8a8a92', fontSize: 11, fontVariant: ['tabular-nums'] },
});
