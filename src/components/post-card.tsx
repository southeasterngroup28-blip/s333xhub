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

  // Card width minus the card's horizontal padding.
  const imageWidth = Math.min(windowWidth, 800) - 32 - 32;

  const media = [...post.post_media].sort((a, b) => a.position - b.position);
  const authorName = post.author?.display_name ?? 'Unknown';

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

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Text style={styles.avatarLetter}>{authorName.slice(0, 1).toUpperCase()}</Text>
        </View>
        <View style={styles.who}>
          <View style={styles.nameRow}>
            <Text style={styles.author}>{authorName}</Text>
            {/* Project emblems: Mazze = upright cross, S333XGOD = inverted. */}
            <Text
              style={[
                styles.cross,
                post.project === 's333xgod' ? styles.crossGod : styles.crossMazze,
              ]}>
              †
            </Text>
          </View>
          <Text style={styles.sub}>{timeAgo(post.created_at)}</Text>
        </View>
        <Pressable
          hitSlop={10}
          onPress={() =>
            setMenu(menu === 'closed' ? (viewerIsArtist ? 'confirm-delete' : 'report') : 'closed')
          }>
          <Ionicons
            name={viewerIsArtist ? 'trash-outline' : 'flag-outline'}
            size={15}
            color="#4a4d53"
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

      {post.is_locked && (viewerIsArtist || unlocked) ? (
        <Text style={styles.unlockedTag}>
          {viewerIsArtist
            ? `Locked post · $${((post.price_cents ?? 0) / 100).toFixed(2)}`
            : 'Unlocked'}
        </Text>
      ) : null}

      {post.body ? <Text style={styles.body}>{post.body}</Text> : null}

      {locked ? (
        <View style={styles.lockCard}>
          <View style={styles.lockIcon}>
            <Ionicons name="lock-closed" size={17} color="#37c8d8" />
          </View>
          <View style={styles.lockMeta}>
            <Text style={styles.lockTitle}>{post.title ?? 'Exclusive drop'}</Text>
            <Text style={styles.lockSub}>
              {unlockNotice ? 'Purchases arrive with the App Store version' : 'One-time unlock'}
            </Text>
          </View>
          <Pressable style={styles.unlockPill} onPress={() => setUnlockNotice(true)}>
            <Text style={styles.unlockPillText}>
              ${((post.price_cents ?? 0) / 100).toFixed(2)}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {locked
        ? null
        : post.kind === 'audio'
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
    backgroundColor: '#131519',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 14,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#1e2126',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: '#9a9ba3', fontWeight: '700', fontSize: 14 },
  who: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { color: '#fff', fontWeight: '600', fontSize: 14 },
  sub: { color: '#6d7076', fontSize: 11.5, marginTop: 1 },
  cross: { fontSize: 15, fontWeight: '700', lineHeight: 17 },
  crossMazze: { color: '#c9cbd0' },
  crossGod: { color: '#37c8d8', transform: [{ rotate: '180deg' }] },
  body: { color: '#cbcdd1', fontSize: 14, lineHeight: 22 },
  image: { borderRadius: 12, marginTop: 12, backgroundColor: '#1a1d22' },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  menuLabel: { color: '#9a9ba3', fontSize: 13, flexShrink: 1 },
  menuChip: {
    backgroundColor: '#1e2126',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  menuText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  menuDanger: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  reportedNote: { color: '#4fc07a', fontSize: 13, marginBottom: 8 },
  actionError: { color: '#f87171', fontSize: 13, marginBottom: 8 },
  unlockedTag: {
    color: '#37c8d8',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  lockCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#10181b',
    borderWidth: 1,
    borderColor: '#1c2b30',
    borderRadius: 16,
    padding: 14,
    marginTop: 10,
  },
  lockIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(55, 200, 216, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockMeta: { flex: 1 },
  lockTitle: { color: '#fff', fontWeight: '600', fontSize: 14 },
  lockSub: { color: '#6d7076', fontSize: 12, marginTop: 2 },
  unlockPill: {
    backgroundColor: '#37c8d8',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  unlockPillText: { color: '#06272c', fontWeight: '700', fontSize: 13 },
});
