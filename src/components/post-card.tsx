import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';

import { AudioPlayerCard } from '@/components/audio-player-card';
import { Avatar } from '@/components/avatar';
import { pressFeedback, tapFeedback } from '@/lib/haptics';
import { VideoPlayerCard } from '@/components/video-player-card';
import { deletePost, fileReport, REPORT_REASONS } from '@/lib/moderation';
import { timeAgo, type Post } from '@/lib/posts';
import {
  REACTION_EMOJIS,
  toggleReaction,
  votePoll,
  type PollState,
  type ReactionSummary,
} from '@/lib/social';

type Props = {
  post: Post;
  /** storage_path → signed URL, resolved by the feed */
  mediaUrls: Record<string, string>;
  /** The artist always sees their own locked content. */
  viewerIsArtist: boolean;
  /** True when this viewer has purchased this post. */
  unlocked?: boolean;
  /** Reaction counts + my reactions, resolved by the feed. */
  reactions?: ReactionSummary;
  /** How many comments this post has. */
  commentCount?: number;
  /** Poll options + votes when this is a poll post. */
  poll?: PollState;
  /** Called after the artist deletes this post, so the feed can refresh. */
  onDeleted?: () => void;
};

/** One reaction chip that pops when tapped. */
function ReactionChip({
  emoji,
  count,
  mine,
  onPress,
}: {
  emoji: string;
  count: number;
  mine: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animated}>
      <Pressable
        style={[styles.react, mine && styles.reactOn]}
        onPress={() => {
          scale.value = withSequence(
            withSpring(1.35, { damping: 9, stiffness: 400 }),
            withSpring(1, { damping: 12, stiffness: 300 })
          );
          tapFeedback();
          onPress();
        }}
        hitSlop={4}>
        <Text style={styles.reactEmoji}>{emoji}</Text>
        {count > 0 ? <Text style={styles.reactCount}>{count}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

function formatEndsIn(endsAt: string | null): string {
  if (!endsAt) return '';
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'ended';
  const hours = Math.round(ms / 3600000);
  if (hours < 1) return 'ends soon';
  if (hours < 48) return `ends in ${hours}h`;
  return `ends in ${Math.round(hours / 24)}d`;
}

type MenuState = 'closed' | 'confirm-delete' | 'report' | 'reported';

export function PostCard({
  post,
  mediaUrls,
  viewerIsArtist,
  unlocked,
  reactions,
  commentCount,
  poll,
  onDeleted,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const router = useRouter();
  const [menu, setMenu] = useState<MenuState>('closed');
  const [actionError, setActionError] = useState<string | null>(null);
  const [unlockNotice, setUnlockNotice] = useState(false);

  // Local optimistic copies of reaction and poll state (synced from props).
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({});
  const [pollState, setPollState] = useState<PollState | undefined>(undefined);

  useEffect(() => {
    setMyReactions(new Set(reactions?.mine ?? []));
    setReactionCounts({ ...(reactions?.counts ?? {}) });
  }, [post.id, reactions]);

  useEffect(() => {
    setPollState(poll ? { ...poll, options: poll.options.map((o) => ({ ...o })) } : undefined);
  }, [post.id, poll]);

  async function handleReaction(emoji: (typeof REACTION_EMOJIS)[number]) {
    const isOn = myReactions.has(emoji);
    // Optimistic flip; revert on failure.
    setMyReactions((prev) => {
      const next = new Set(prev);
      if (isOn) next.delete(emoji);
      else next.add(emoji);
      return next;
    });
    setReactionCounts((prev) => ({ ...prev, [emoji]: Math.max(0, (prev[emoji] ?? 0) + (isOn ? -1 : 1)) }));
    try {
      await toggleReaction(post.id, emoji, isOn);
    } catch {
      setMyReactions((prev) => {
        const next = new Set(prev);
        if (isOn) next.add(emoji);
        else next.delete(emoji);
        return next;
      });
      setReactionCounts((prev) => ({ ...prev, [emoji]: Math.max(0, (prev[emoji] ?? 0) + (isOn ? 1 : -1)) }));
    }
  }

  async function handleVote(optionId: string) {
    if (!pollState) return;
    const open = !pollState.ends_at || new Date(pollState.ends_at).getTime() > Date.now();
    if (!open || pollState.myOptionId === optionId) return;
    const previous = pollState;
    setPollState({
      ...pollState,
      totalVotes: pollState.myOptionId ? pollState.totalVotes : pollState.totalVotes + 1,
      myOptionId: optionId,
      options: pollState.options.map((o) => ({
        ...o,
        votes:
          o.id === optionId
            ? o.votes + 1
            : o.id === pollState.myOptionId
              ? Math.max(0, o.votes - 1)
              : o.votes,
      })),
    });
    try {
      await votePoll(post.id, optionId);
    } catch (e) {
      setPollState(previous);
      setActionError((e as { message?: string })?.message ?? 'Vote failed.');
    }
  }

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
    <Animated.View
      entering={FadeInDown.duration(280)}
      style={[
        styles.card,
        post.project === 's333xgod' ? styles.cardGod : styles.cardMazze,
      ]}>
      <View style={styles.header}>
        <Avatar path={post.author?.avatar_path} focus={post.author?.avatar_focus} name={authorName} size={34} />
        <View style={styles.who}>
          <View style={styles.nameRow}>
            <Text style={styles.author}>{authorName}</Text>
            {/* Project emblems: S333XGOD = blue star, Mazze = green skull. */}
            <Image
              source={
                post.project === 's333xgod'
                  ? require('../../assets/images/emblem-s333xgod.png')
                  : require('../../assets/images/emblem-mazze.png')
              }
              style={styles.emblem}
              contentFit="contain"
            />
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

      {post.kind === 'poll' && pollState ? (
        <View style={styles.poll}>
          {pollState.options.map((option) => {
            const pct =
              pollState.totalVotes > 0 ? Math.round((option.votes / pollState.totalVotes) * 100) : 0;
            const isMine = pollState.myOptionId === option.id;
            return (
              <Pressable key={option.id} style={styles.pollBar} onPress={() => handleVote(option.id)}>
                <View style={[styles.pollFill, { width: `${pct}%` }]} />
                <View style={styles.pollRow}>
                  <Text style={[styles.pollLabel, isMine && styles.pollLabelMine]}>
                    {isMine ? '● ' : ''}
                    {option.label}
                  </Text>
                  <Text style={styles.pollPct}>{pct}%</Text>
                </View>
              </Pressable>
            );
          })}
          <Text style={styles.pollMeta}>
            {pollState.totalVotes} vote{pollState.totalVotes === 1 ? '' : 's'}
            {pollState.ends_at ? ` · ${formatEndsIn(pollState.ends_at)}` : ''}
          </Text>
        </View>
      ) : null}

      {locked ? (
        <View style={styles.teaseWrap}>
          {post.cover_path && mediaUrls[post.cover_path] ? (
            // The real cover art, heavily blurred — a tease of what's inside.
            <Image
              source={{ uri: mediaUrls[post.cover_path] }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              blurRadius={22}
              transition={200}
            />
          ) : (
            <Image
              source={
                post.project === 's333xgod'
                  ? require('../../assets/images/emblem-s333xgod.png')
                  : require('../../assets/images/emblem-mazze.png')
              }
              style={styles.teaseEmblem}
              contentFit="contain"
              blurRadius={3}
            />
          )}
          <View style={styles.teaseScrim} />
          <View style={styles.teaseContent}>
            <Ionicons name="lock-closed" size={20} color="#e8e9eb" />
            <Text style={styles.teaseTitle} numberOfLines={1}>
              {post.title ?? 'Exclusive drop'}
            </Text>
            <Pressable
              style={styles.unlockPill}
              onPress={() => {
                pressFeedback();
                setUnlockNotice(true);
              }}>
              <Text style={styles.unlockPillText}>
                Unlock · ${((post.price_cents ?? 0) / 100).toFixed(2)}
              </Text>
            </Pressable>
            {unlockNotice ? (
              <Text style={styles.teaseSub}>Purchases arrive with the App Store version</Text>
            ) : null}
          </View>
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
                  coverUrl={post.cover_path ? mediaUrls[post.cover_path] : undefined}
                  coverFocus={post.cover_focus ?? 0.5}
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

      <View style={styles.socialRow}>
        {REACTION_EMOJIS.map((emoji) => (
          <ReactionChip
            key={emoji}
            emoji={emoji}
            count={reactionCounts[emoji] ?? 0}
            mine={myReactions.has(emoji)}
            onPress={() => handleReaction(emoji)}
          />
        ))}
        <Pressable
          style={styles.commentsChip}
          onPress={() => router.push(`/post/${post.id}` as never)}
          hitSlop={4}>
          <Ionicons name="chatbubble-outline" size={13} color="#9a9ba3" />
          <Text style={styles.commentsText}>
            {commentCount && commentCount > 0 ? commentCount : 'Comment'}
          </Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#101216',
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
  cardGod: { borderWidth: 1, borderColor: 'rgba(88, 178, 235, 0.22)' },
  cardMazze: { borderWidth: 1, borderColor: 'rgba(126, 211, 84, 0.18)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  who: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { color: '#fff', fontWeight: '600', fontSize: 14 },
  sub: { color: '#6d7076', fontSize: 11.5, marginTop: 1 },
  emblem: { width: 20, height: 20 },
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
    color: '#c3cdd6',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  teaseWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#14171b',
    aspectRatio: 16 / 9,
    marginTop: 10,
    justifyContent: 'center',
  },
  teaseEmblem: {
    position: 'absolute',
    alignSelf: 'center',
    width: '55%',
    height: '75%',
    opacity: 0.16,
  },
  teaseScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5, 7, 9, 0.45)',
  },
  teaseContent: { alignItems: 'center', gap: 8, paddingHorizontal: 20 },
  teaseTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 8,
  },
  teaseSub: { color: '#aab2ba', fontSize: 11.5, textAlign: 'center' },
  unlockPill: {
    backgroundColor: '#c3cdd6',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  unlockPillText: { color: '#14161a', fontWeight: '700', fontSize: 13 },
  socialRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12, flexWrap: 'wrap' },
  react: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1a1d22',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  reactOn: {
    backgroundColor: '#2a2f36',
    borderWidth: 1,
    borderColor: '#c3cdd6',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  reactEmoji: { fontSize: 13, color: '#e8e9eb' },
  reactCount: { fontSize: 11, color: '#8f99a3', fontWeight: '600' },
  commentsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  commentsText: { fontSize: 12, color: '#9a9ba3', fontWeight: '600' },
  poll: { marginTop: 10 },
  pollBar: {
    backgroundColor: '#1a1d22',
    borderRadius: 10,
    marginBottom: 7,
    overflow: 'hidden',
  },
  pollFill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: '#2a2f36' },
  pollRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  pollLabel: { color: '#cbcdd1', fontSize: 13 },
  pollLabelMine: { color: '#e8f0f4', fontWeight: '700' },
  pollPct: { color: '#8f99a3', fontSize: 12, fontWeight: '600' },
  pollMeta: { color: '#6d7076', fontSize: 11.5, marginTop: 2 },
});
