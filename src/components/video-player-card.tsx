import Ionicons from '@expo/vector-icons/Ionicons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { usePlayer } from '@/providers/player-provider';

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
      <Pressable style={[styles.poster, size]} onPress={() => setActivated(true)}>
        <View style={styles.playBadge}>
          <Ionicons name="play" size={22} color="#0b0c0e" style={styles.playNudge} />
        </View>
      </Pressable>
    );
  }

  return <ActiveVideo url={url} size={size} />;
}

function ActiveVideo({ url, size }: { url: string; size: { width: number; height: number } }) {
  const { pause: pauseMusic } = usePlayer();
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    // Keep the audio player's lock-screen card intact.
    p.showNowPlayingNotification = false;
    p.play();
  });

  // A video with sound shouldn't play on top of the music.
  useEffect(() => {
    pauseMusic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <VideoView player={player} style={[styles.video, size]} nativeControls contentFit="contain" />;
}

const styles = StyleSheet.create({
  video: { borderRadius: 12, marginTop: 12, backgroundColor: '#14151a', overflow: 'hidden' },
  poster: {
    borderRadius: 12,
    marginTop: 12,
    backgroundColor: '#14151a',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
});
