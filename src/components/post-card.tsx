import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AudioPlayerCard } from '@/components/audio-player-card';
import { VideoPlayerCard } from '@/components/video-player-card';
import { deletePost, fileReport, REPORT_REASONS } from '@/lib/moderation';
import { timeAgo, type Post } from '@/lib/posts';

type Props = {
  post: Post;
  /** storage_path → signed URL, resolved by the feed */
  mediaUrls: Record<string, string>;
  /** The artist always sees their own locked content. */
  viewerIsArtist: boolean;
  /** True when this viewer has purchased this post. */
  unlocked?: boolean;
  /** Called after the artist deletes this post, so the feed can refresh. */
  onDeleted?: () => void;
};

type MenuState = 'closed' | 'confirm-delete' | 'report' | 'reported';

export function PostCard({ post, mediaUrls, viewerIsArtist, unlocked, onDeleted }: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const [menu, setMenu] = useState<MenuState>('closed');
  const [actionError, setActionError] = useState<string | null>(null);
  const [unlockNotice, setUnlockNotice] = useState(false);

  /** Locked from THIS viewer's perspective. */
  const locked = post.is_locked && !viewerIsArtist && !unlocked;

  async function handleDelete() {
    setMenu('closed');
    try {
      await deletePost(post.id);
      onDeleted?.();
    } catch (e) {
      setActionError((e as { message?: string })?.message ?? 'Could not delete the post.');
    }
  }

  async function handleReport(reason: string) {
    setMenu('reported');
    try {
      await fileReport('post', post.id, reason);
    } catch (e) {
      setMenu('closed');
      setActionError((e as { message?: string })?.message ?? 'Could not send the report.');
    }
  }
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
            <Ionicons name="flame" size={15} color="#2fd0e2" />
          ) : (
            <Ionicons name="disc" size={15} color="#ffffff" />
          )}
        </View>
        <Text style={styles.time}>{timeAgo(post.created_at)}</Text>
        <Pressable
          hitSlop={10}
          onPress={() =>
            setMenu(menu === 'closed' ? (viewerIsArtist ? 'confirm-delete' : 'report') : 'closed')
          }>
          <Ionicons
            name={viewerIsArtist ? 'trash-outline' : 'flag-outline'}
            size={16}
            color="#555"
          />
        </Pressable>
      </View>

      {menu === 'confirm-delete' ? (
        <View style={styles.menuRow}>
          <Text style={styles.menuLabel}>Delete this post for everyone?</Text>
          <Pressable style={styles.menuChip} onPress={handleDelete}>
            <Text style={styles.menuDanger}>Delete</Text>
          </Pressable>
          <Pressable style={styles.menuChip} onPress={() => setMenu('closed')}>
            <Text style={styles.menuText}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      {menu === 'report' ? (
        <View style={styles.menuRow}>
          {REPORT_REASONS.map((reason) => (
            <Pressable key={reason} style={styles.menuChip} onPress={() => handleReport(reason)}>
              <Text style={styles.menuText}>{reason}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {menu === 'reported' ? (
        <Text style={styles.reportedNote}>Reported — reviewed within 24 hours.</Text>
      ) : null}

      {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

      {post.body ? <Text style={styles.body}>{post.body}</Text> : null}

      {post.is_locked && (viewerIsArtist || unlocked) ? (
        <Text style={styles.unlockedTag}>
          {viewerIsArtist
            ? `🔒 Locked post · $${((post.price_cents ?? 0) / 100).toFixed(2)}`
            : '✓ Unlocked'}
        </Text>
      ) : null}

      {locked ? (
        <View style={styles.lockedBox}>
          <Ionicons name="lock-closed" size={22} color="#2fd0e2" />
          <View style={styles.lockedMeta}>
            {post.title ? <Text style={styles.lockedTitle}>{post.title}</Text> : null}
            <Pressable style={styles.unlockButton} onPress={() => setUnlockNotice(true)}>
              <Text style={styles.unlockButtonText}>
                Unlock for ${((post.price_cents ?? 0) / 100).toFixed(2)}
              </Text>
            </Pressable>
            {unlockNotice ? (
              <Text style={styles.lockedHint}>
                Purchases arrive with the App Store version — coming soon.
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}

      {locked ? null : post.kind === 'audio'
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

      {post.kind === 'video' && !locked
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

      {locked || post.kind === 'audio' || post.kind === 'video'
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
    backgroundColor: '#0d0e11',
    borderWidth: 1,
    borderColor: '#1e2026',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 },
  menuLabel: { color: '#999', fontSize: 13, flexShrink: 1 },
  menuChip: {
    backgroundColor: '#222226',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  menuText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  menuDanger: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  reportedNote: { color: '#4fc07a', fontSize: 13, marginBottom: 8 },
  actionError: { color: '#f87171', fontSize: 13, marginBottom: 8 },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.3 },
  time: { color: '#5a5b63', fontSize: 12 },
  body: { color: '#d8d9dd', fontSize: 15, lineHeight: 22, marginBottom: 4 },
  image: { borderRadius: 8, marginTop: 8, backgroundColor: '#14151a' },
  lockedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#081b1f',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#12798e',
    padding: 14,
    marginTop: 8,
  },
  lockedMeta: { flex: 1 },
  unlockedTag: { color: '#2fd0e2', fontSize: 12, fontWeight: '700', marginBottom: 6 },
  unlockButton: {
    backgroundColor: '#2fd0e2',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  unlockButtonText: { color: '#000', fontSize: 14, fontWeight: '800' },
  lockedTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  lockedText: { color: '#2fd0e2', fontSize: 14, fontWeight: '700', marginTop: 2 },
  lockedHint: { color: '#666', fontSize: 12, marginTop: 2 },
});
