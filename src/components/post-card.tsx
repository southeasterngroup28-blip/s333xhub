import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AudioPlayerCard } from '@/components/audio-player-card';
import { VideoPlayerCard } from '@/components/video-player-card';
import { timeAgo, type Post } from '@/lib/posts';

type Props = {
  post: Post;
  /** storage_path → signed URL, resolved by the feed */
  mediaUrls: Record<string, string>;
  /** The artist always sees their own locked content. */
  viewerIsArtist: boolean;
};

export function PostCard({ post, mediaUrls, viewerIsArtist }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  // Card width minus the card's horizontal padding.
  const imageWidth = Math.min(windowWidth, 800) - 32;

  const media = [...post.post_media].sort((a, b) => a.position - b.position);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.authorRow}>
          <Text style={styles.author}>{post.author?.display_name ?? 'Unknown'}</Text>
          {/* Project symbol, Twitter-checkmark style. Placeholder icons until
              the artist picks the real ones — swap the `name` values below. */}
          {post.project === 's333xgod' ? (
            <Ionicons name="flame" size={15} color="#ef4444" />
          ) : (
            <Ionicons name="disc" size={15} color="#3b82f6" />
          )}
        </View>
        <Text style={styles.time}>{timeAgo(post.created_at)}</Text>
      </View>

      {post.body ? <Text style={styles.body}>{post.body}</Text> : null}

      {post.is_locked && !viewerIsArtist ? (
        <View style={styles.lockedBox}>
          <Ionicons name="lock-closed" size={22} color="#fbbf24" />
          <View style={styles.lockedMeta}>
            {post.title ? <Text style={styles.lockedTitle}>{post.title}</Text> : null}
            <Text style={styles.lockedText}>
              Unlock for ${((post.price_cents ?? 0) / 100).toFixed(2)}
            </Text>
            <Text style={styles.lockedHint}>Unlocks are coming soon.</Text>
          </View>
        </View>
      ) : null}

      {post.is_locked && !viewerIsArtist ? null : post.kind === 'audio'
        ? media.map((item) => {
            const url = mediaUrls[item.storage_path];
            if (!url) return null;
            return (
              <AudioPlayerCard
                key={item.id}
                postId={post.id}
                title={post.title ?? 'Untitled track'}
                url={url}
              />
            );
          })
        : null}

      {post.kind === 'video' && !(post.is_locked && !viewerIsArtist)
        ? media.map((item) => {
            const url = mediaUrls[item.storage_path];
            if (!url) return null;
            return (
              <VideoPlayerCard
                key={item.id}
                url={url}
                width={imageWidth}
                sourceWidth={item.width}
                sourceHeight={item.height}
              />
            );
          })
        : null}

      {(post.is_locked && !viewerIsArtist) || post.kind === 'audio' || post.kind === 'video'
        ? null
        : media.map((item) => {
        const url = mediaUrls[item.storage_path];
        if (!url) return null;
        const aspect = item.width && item.height ? item.width / item.height : 1;
        return (
          <Image
            key={item.id}
            source={{ uri: url }}
            style={[styles.image, { width: imageWidth, height: imageWidth / aspect }]}
            contentFit="cover"
            transition={150}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#111113',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { color: '#fff', fontWeight: '700', fontSize: 15 },
  time: { color: '#666', fontSize: 13 },
  body: { color: '#ddd', fontSize: 15, lineHeight: 22, marginBottom: 4 },
  image: { borderRadius: 12, marginTop: 8, backgroundColor: '#1a1a1c' },
  lockedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1a1a1e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a20',
    padding: 14,
    marginTop: 8,
  },
  lockedMeta: { flex: 1 },
  lockedTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  lockedText: { color: '#fbbf24', fontSize: 14, fontWeight: '700', marginTop: 2 },
  lockedHint: { color: '#666', fontSize: 12, marginTop: 2 },
});
