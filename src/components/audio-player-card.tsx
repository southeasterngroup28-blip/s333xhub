import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { usePlayer } from '@/providers/player-provider';

type Props = {
  postId: string;
  title: string;
  url: string;
};

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function AudioPlayerCard({ postId, title, url }: Props) {
  const { current, status, playTrack, toggle, seekTo } = usePlayer();
  const [barWidth, setBarWidth] = useState(0);

  const isCurrent = current?.postId === postId;
  const isPlaying = isCurrent && !!status?.playing;
  const duration = isCurrent ? status?.duration ?? 0 : 0;
  const position = isCurrent ? status?.currentTime ?? 0 : 0;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  function handlePress() {
    if (isCurrent) {
      toggle();
    } else {
      playTrack({ postId, title, url });
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Pressable style={styles.playButton} onPress={handlePress} hitSlop={8}>
          <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color="#000" style={!isPlaying && styles.playNudge} />
        </Pressable>
        <View style={styles.meta}>
          <Text style={styles.trackTitle} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.time}>
            {isCurrent ? `${formatTime(position)} / ${formatTime(duration)}` : 'Tap to play'}
          </Text>
        </View>
      </View>

      {/* Tap anywhere on the bar to jump there. */}
      <Pressable
        style={styles.barTouch}
        onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
        onPress={(e) => {
          if (!isCurrent || duration <= 0 || barWidth <= 0) return;
          const fraction = Math.max(0, Math.min(1, e.nativeEvent.locationX / barWidth));
          seekTo(fraction * duration);
        }}>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: `${progress * 100}%` }]} />
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1a1e',
    borderRadius: 12,
    padding: 14,
    marginTop: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  playButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#3fd8ea',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playNudge: { marginLeft: 2 },
  meta: { flex: 1, marginLeft: 12 },
  trackTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  time: { color: '#777', fontSize: 12, marginTop: 2 },
  barTouch: { paddingVertical: 10, marginTop: 4 },
  barTrack: { height: 4, borderRadius: 2, backgroundColor: '#26262c' },
  barFill: { height: 4, borderRadius: 2, backgroundColor: '#3fd8ea' },
});
