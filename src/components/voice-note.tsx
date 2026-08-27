import Ionicons from '@expo/vector-icons/Ionicons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

function formatSeconds(total: number): string {
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

type Props = {
  /** Signed URL — undefined while it's still being fetched. */
  url?: string;
  durationSeconds?: number | null;
  mine?: boolean;
};

/** A play/pause voice-note row inside a chat bubble. */
export function VoiceNoteBubble({ url, durationSeconds, mine }: Props) {
  if (!url) {
    return (
      <View style={styles.row}>
        <ActivityIndicator color="#8f99a3" size="small" />
        <Text style={styles.time}>voice note…</Text>
      </View>
    );
  }
  return <Loaded url={url} durationSeconds={durationSeconds} mine={mine} />;
}

function Loaded({ url, durationSeconds, mine }: Props & { url: string }) {
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);

  const playing = status.playing;
  const total = durationSeconds ?? (status.duration || 0);
  const shown = playing || status.currentTime > 0 ? status.currentTime : total;

  function toggle() {
    if (playing) {
      player.pause();
      return;
    }
    // Replay from the start once it has finished.
    if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
      player.seekTo(0);
    }
    player.play();
  }

  return (
    <View style={styles.row}>
      <Pressable style={[styles.button, mine && styles.buttonMine]} onPress={toggle} hitSlop={8}>
        <Ionicons name={playing ? 'pause' : 'play'} size={16} color="#0b0c0e" />
      </Pressable>
      <View style={styles.bars}>
        {Array.from({ length: 14 }, (_, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { height: 6 + ((i * 7) % 12) },
              total > 0 && shown / total > i / 14 && playing ? styles.barActive : null,
            ]}
          />
        ))}
      </View>
      <Text style={styles.time}>{formatSeconds(shown)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 2, minWidth: 170 },
  button: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#c3cdd6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonMine: { backgroundColor: '#e6feff' },
  bars: { flexDirection: 'row', alignItems: 'center', gap: 2, flex: 1 },
  bar: { width: 3, borderRadius: 2, backgroundColor: '#565d66' },
  barActive: { backgroundColor: '#c3cdd6' },
  time: { color: '#8f99a3', fontSize: 11, fontVariant: ['tabular-nums'] },
});
