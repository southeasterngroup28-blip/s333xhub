import { useVideoPlayer, VideoView } from 'expo-video';
import { StyleSheet } from 'react-native';

type Props = {
  url: string;
  /** Display width, computed by the post card. */
  width: number;
  /** Source dimensions, for aspect ratio; falls back to 16:9. */
  sourceWidth: number | null;
  sourceHeight: number | null;
};

export function VideoPlayerCard({ url, width, sourceWidth, sourceHeight }: Props) {
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
  });

  const aspect = sourceWidth && sourceHeight ? sourceWidth / sourceHeight : 16 / 9;

  return (
    <VideoView
      player={player}
      style={[styles.video, { width, height: width / aspect }]}
      nativeControls
      contentFit="contain"
    />
  );
}

const styles = StyleSheet.create({
  video: { borderRadius: 12, marginTop: 8, backgroundColor: '#1a1a1c', overflow: 'hidden' },
});
