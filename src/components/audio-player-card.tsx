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
    <View style={styles.wrap}>
      {/* Art panel: deep teal ground with the white play control, the way
          a cover would sit. Real cover art can drop in here later. */}
      <View style={styles.art}>
        <View style={styles.artGlow} />
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
            <Text style={styles.trackTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.time}>
              {isCurrent ? `${formatTime(position)} / ${formatTime(duration)}` : 'Tap to play'}
            </Text>
          </View>
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
  wrap: { marginTop: 12 },
  art: {
    borderRadius: 12,
    backgroundColor: '#0e181d',
    minHeight: 110,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  artGlow: {
    position: 'absolute',
    top: -40,
    right: -20,
    width: 180,
    height: 140,
    borderRadius: 90,
    backgroundColor: 'rgba(55, 200, 216, 0.14)',
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
  trackTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  time: { color: '#9fb6bb', fontSize: 12, marginTop: 2 },
  barTouch: { paddingVertical: 10 },
  barTrack: { height: 3, borderRadius: 2, backgroundColor: '#23262b' },
  barFill: { height: 3, borderRadius: 2, backgroundColor: '#37c8d8' },
});
