import Ionicons from '@expo/vector-icons/Ionicons';
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { Skeleton } from '@/components/skeleton';
import { pressFeedback, tapFeedback } from '@/lib/haptics';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { usePlayerControls } from '@/providers/player-provider';

type Props = {
  url: string;
  /** Display width, computed by the post card. */
  width: number;
  /** Source dimensions, for aspect ratio; falls back to 16:9. */
  sourceWidth: number | null;
  sourceHeight: number | null;
};

/**
 * Lazy video: no native player exists until the viewer taps. This keeps
 * feeds fast AND stops idle video players from stealing the lock-screen
 * Now Playing slot away from the audio player.
 */
export function VideoPlayerCard({ url, width, sourceWidth, sourceHeight }: Props) {
  const [activated, setActivated] = useState(false);
  const aspect = sourceWidth && sourceHeight ? sourceWidth / sourceHeight : 16 / 9;
  const size = { width, height: width / aspect };

  if (!activated) {
    return (
      <Pressable
        style={({ pressed }) => [styles.poster, size, pressed && styles.posterPressed]}
        onPress={() => {
          pressFeedback();
          setActivated(true);
        }}>
        <View style={styles.playBadge}>
          <Ionicons name="play" size={22} color="#0b0c0e" style={styles.playNudge} />
        </View>
      </Pressable>
    );
  }

  return <ActiveVideo url={url} size={size} />;
}

function ActiveVideo({ url, size }: { url: string; size: { width: number; height: number } }) {
  const { pause: pauseMusic } = usePlayerControls();
  const reduceMotion = useReduceMotion();
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    // Keep the audio player's lock-screen card intact.
    p.showNowPlayingNotification = false;
    p.play();
  });
  const { status } = useEvent(player, 'statusChange', { status: player.status });

  // A video with sound shouldn't play on top of the music.
  useEffect(() => {
    pauseMusic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.videoWrap}>
      <VideoView player={player} style={[styles.video, size]} nativeControls contentFit="contain" />
      {status === 'error' ? (
        <Pressable
          style={[styles.overlay, size]}
          onPress={() => {
            tapFeedback();
            player
              .replaceAsync(url)
              .then(() => player.play())
              .catch(() => {});
          }}>
          <View style={styles.badgeSeat}>
            <Ionicons name="refresh" size={22} color="#ffffff" />
          </View>
          <Text style={styles.overlayText}>This video did not load. Tap to try again.</Text>
        </Pressable>
      ) : status !== 'readyToPlay' ? (
        // Buffering: the house shimmer over the reserved frame, spinner in
        // the badge's seat, dissolving the moment frames are ready.
        <Animated.View
          exiting={reduceMotion ? undefined : FadeOut.duration(180)}
          pointerEvents="none"
          style={[styles.overlay, size]}>
          <Skeleton
            width={size.width}
            height={size.height}
            radius={12}
            style={styles.overlayFill}
          />
          <View style={styles.badgeSeat}>
            <ActivityIndicator size="small" color="#ffffff" />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  videoWrap: { marginTop: 12 },
  video: { borderRadius: 12, backgroundColor: '#14151a', overflow: 'hidden' },
  poster: {
    borderRadius: 12,
    marginTop: 12,
    backgroundColor: '#14151a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  posterPressed: { opacity: 0.85 },
  playBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  playNudge: { marginLeft: 3 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#14151a',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  overlayFill: { position: 'absolute', top: 0, left: 0 },
  // The play badge's 52pt seat, translucent so the shimmer reads through.
  badgeSeat: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: 'rgba(4,6,8,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlayText: { color: '#aab2ba', fontSize: 12.5, textAlign: 'center', paddingHorizontal: 20 },
});
