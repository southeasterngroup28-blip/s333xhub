import Ionicons from '@expo/vector-icons/Ionicons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { usePlayer } from '@/providers/player-provider';

function formatSeconds(total: number): string {
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
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
};

type Look = Pick<Props, 'mine' | 'artist'>;

/** The slim hairline pill every state of the note sits inside. */
function Pill({ mine, artist, children }: Look & { children: ReactNode }) {
  return (
    <View style={[styles.pill, artist && styles.pillArtist, mine && styles.pillMine]}>{children}</View>
  );
}

/** The level line; `progress` (0–1) lights the bars already played. */
function Line({ progress = 0 }: { progress?: number }) {
  return (
    <View style={styles.line}>
      {BAR_HEIGHTS.map((height, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            { height },
            progress > i / BAR_HEIGHTS.length ? styles.barOn : null,
          ]}
        />
      ))}
    </View>
  );
}

/**
 * A play/pause voice-note pill. The actual audio player is only created
 * on first tap — a chat full of voice notes must not hold dozens of
 * live buffering players for messages nobody is listening to.
 */
export function VoiceNoteBubble({ url, durationSeconds, mine, artist }: Props) {
  const [activated, setActivated] = useState(false);

  if (!url) {
    return (
      <Pill mine={mine} artist={artist}>
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
      <Pill mine={mine} artist={artist}>
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
  return <Loaded url={url} durationSeconds={durationSeconds} mine={mine} artist={artist} />;
}

function Loaded({ url, durationSeconds, mine, artist }: Props & { url: string }) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const { pause: pauseMusic } = usePlayer();
  const [autoplayed, setAutoplayed] = useState(false);

  const playing = status.playing;
  const total = durationSeconds ?? (status.duration || 0);
  const shown = playing || status.currentTime > 0 ? status.currentTime : total;

  function startPlayback() {
    // The music player and other voice notes step aside.
    pauseMusic();
    pauseCurrentVoice?.();
    pauseCurrentVoice = () => {
      try {
        player.pause();
      } catch {}
    };
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

  // If this bubble unmounts while registered as the active voice, drop
  // the stale pause handle.
  useEffect(() => {
    return () => {
      pauseCurrentVoice = null;
    };
  }, []);

  function toggle() {
    if (playing) {
      player.pause();
      pauseCurrentVoice = null;
      return;
    }
    startPlayback();
  }

  return (
    <Pill mine={mine} artist={artist}>
      <Pressable
        style={styles.play}
        onPress={toggle}
        hitSlop={8}
        accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}>
        <Ionicons
          name={playing ? 'pause' : 'play'}
          size={12}
          color="#000"
          style={playing ? undefined : styles.playGlyph}
        />
      </Pressable>
      <Line progress={total > 0 && playing ? shown / total : 0} />
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
    // Solid over the photo background — the same fill as the chat bubbles.
    backgroundColor: '#131519',
  },
  pillArtist: { borderColor: 'rgba(195,205,214,0.6)' },
  // Mine reads like my text bubbles: filled one shade up, no visible hairline.
  pillMine: { backgroundColor: '#23262b', borderColor: '#23262b' },
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
  bar: { width: 1, backgroundColor: 'rgba(255,255,255,0.38)' },
  barOn: { backgroundColor: '#ffffff' },
  time: { color: '#8a8a92', fontSize: 11, fontVariant: ['tabular-nums'] },
});
