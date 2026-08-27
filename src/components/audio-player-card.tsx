import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { usePlayer } from '@/providers/player-provider';

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

export function AudioPlayerCard({ postId, title, url, coverUrl, coverFocus = 0.5 }: Props) {
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
      playTrack({ postId, title, url, artworkUrl: coverUrl });
    }
  }

  return (
    <View style={styles.wrap}>
      {/* Art panel: real cover art when the post has one, styled ground otherwise. */}
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
    backgroundColor: '#171b20',
    minHeight: 110,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  artWithCover: { aspectRatio: 16 / 9 },
  artScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 80,
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
  trackTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  time: { color: '#99a1a9', fontSize: 12, marginTop: 2 },
  barTouch: { paddingVertical: 10 },
  barTrack: { height: 3, borderRadius: 2, backgroundColor: '#23262b' },
  barFill: { height: 3, borderRadius: 2, backgroundColor: '#c3cdd6' },
});
