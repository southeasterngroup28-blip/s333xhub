import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/app-background';
import { Avatar } from '@/components/avatar';
import { EmptyState } from '@/components/empty-state';
import { PostCard } from '@/components/post-card';
import { useProfileCard } from '@/components/profile-card';
import { CommentSkeleton, PostSkeleton } from '@/components/skeleton';
import { fileReport, REPORT_REASONS } from '@/lib/moderation';
import {
  fetchPostById,
  markFeedStale,
  signedUrlsFor,
  timeAgo,
  type Post,
} from '@/lib/posts';
import { cleanMessage } from '@/lib/profanity';
import { fetchMyPurchasedPostIds } from '@/lib/purchases';
import {
  addComment,
  deleteComment,
  fetchComments,
  fetchPolls,
  fetchSocialSummary,
  setPinned,
  type Comment,
  type PollState,
  type ReactionSummary,
  type SocialSummary,
} from '@/lib/social';
import { useAuth } from '@/providers/auth-provider';
import { DISPLAY_FONT } from '@/constants/type';

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const router = useRouter();
  const { showProfile } = useProfileCard();
  const isArtist = profile?.role === 'artist';
  const myUserId = session?.user.id;

  const [post, setPost] = useState<Post | null>(null);
  /** True when the post was deleted (or a bad deep link) — not a fetch error. */
  const [postGone, setPostGone] = useState(false);
  const [postLoading, setPostLoading] = useState(true);
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(new Set());
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [reactions, setReactions] = useState<ReactionSummary | undefined>(undefined);
  const [poll, setPoll] = useState<PollState | undefined>(undefined);

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionTarget, setActionTarget] = useState<Comment | null>(null);
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const resolveMedia = useCallback(
    async (target: Post, purchased: Set<string>) => {
      // Mirrors the feed: only request viewing links this viewer may
      // actually see — but a locked post still gets its cover, which
      // shows blurred as a teaser (the storage rules allow covers through).
      const canSee = isArtist || !target.is_locked || purchased.has(target.id);
      const paths = canSee
        ? [
            ...target.post_media.map((m) => m.storage_path),
            ...(target.cover_path ? [target.cover_path] : []),
          ]
        : target.cover_path
          ? [target.cover_path]
          : [];
      if (paths.length === 0) return;
      const urls = await signedUrlsFor(paths);
      setMediaUrls((prev) => ({ ...prev, ...urls }));
    },
    [isArtist]
  );

  const loadPost = useCallback(async () => {
    if (!id) return;
    try {
      const purchased = isArtist
        ? new Set<string>()
        : await fetchMyPurchasedPostIds().catch(() => new Set<string>());
      setPurchasedIds(purchased);

      const fresh = await fetchPostById(id);
      if (!fresh) {
        // Deleted post — the deep-link-from-a-push path lands here too.
        setPostGone(true);
        return;
      }
      setPost(fresh);

      const [summary, pollStates] = await Promise.all([
        fetchSocialSummary([id]).catch(
          (): SocialSummary => ({ reactions: {}, commentCounts: {} })
        ),
        fetchPolls(fresh.kind === 'poll' ? [id] : []).catch(
          (): Record<string, PollState> => ({})
        ),
      ]);
      setReactions(summary.reactions[id]);
      setPoll(pollStates[id]);

      await resolveMedia(fresh, purchased);
    } catch (e) {
      // A mangled deep link (non-uuid id) is Postgres 22P02 — treat it like a
      // missing post rather than surfacing the raw database text.
      const err = e as { code?: string; message?: string };
      if (err?.code === '22P02' || /invalid input syntax for type uuid/i.test(err?.message ?? '')) {
        setPostGone(true);
      } else {
        setError('Could not load this post.');
      }
    } finally {
      setPostLoading(false);
    }
  }, [id, isArtist, resolveMedia]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setComments(await fetchComments(id));
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not load comments.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadPost();
    load();
  }, [loadPost, load]);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flash(text: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  }

  function handlePostDeleted() {
    // The card just deleted the post server-side; the feed must refetch,
    // and there is nothing left to look at here.
    markFeedStale();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  async function handleSend() {
    const body = cleanMessage(draft.trim());
    if (!body || sending || !id) return;
    setSending(true);
    try {
      const comment = await addComment(id, body);
      setComments((prev) => [...prev, comment]);
      setDraft('');
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Comment failed to post.');
    } finally {
      setSending(false);
    }
  }

  async function handlePin() {
    if (!actionTarget) return;
    const target = actionTarget;
    setActionTarget(null);
    try {
      await setPinned(target, !target.pinned);
      await load();
      flash(target.pinned ? 'Unpinned.' : 'Pinned to the top.');
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not pin.');
    }
  }

  async function handleDelete() {
    if (!actionTarget) return;
    const target = actionTarget;
    setActionTarget(null);
    try {
      await deleteComment(target.id);
      setComments((prev) => prev.filter((c) => c.id !== target.id));
      flash('Comment deleted.');
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not delete.');
    }
  }

  async function handleReport(reason: string) {
    if (!actionTarget) return;
    const target = actionTarget;
    setReporting(false);
    setActionTarget(null);
    try {
      await fileReport('comment', target.id, reason);
      flash('Reported. Reviewed within 24 hours.');
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not report.');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <AppBackground />
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Post</Text>
        <View style={{ width: 24 }} />
      </View>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {postLoading || loading ? (
          <View style={styles.list}>
            <PostSkeleton />
            <View style={styles.commentPad}>
              <CommentSkeleton />
              <CommentSkeleton />
              <CommentSkeleton />
            </View>
          </View>
        ) : postGone ? (
          <View style={styles.goneWrap}>
            <EmptyState
              icon="eye-off-outline"
              title="This post is gone"
              sub="It may have been taken down. The feed has the latest."
            />
          </View>
        ) : !post ? (
          <View style={styles.goneWrap}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load this post"
              sub="Check your connection and try again."
            />
          </View>
        ) : (
          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <>
                <PostCard
                  post={post}
                  mediaUrls={mediaUrls}
                  viewerIsArtist={isArtist}
                  unlocked={purchasedIds.has(post.id)}
                  reactions={reactions}
                  commentCount={comments.length}
                  poll={poll}
                  onDeleted={handlePostDeleted}
                  onUnlocked={() => {
                    const next = new Set(purchasedIds).add(post.id);
                    setPurchasedIds(next);
                    resolveMedia(post, next);
                    // The feed's purchased set is stale now - make it refetch
                    // on return so the unlock shows there too.
                    markFeedStale();
                  }}
                />
                {comments.length > 0 ? (
                  <Text style={styles.commentsLabel}>COMMENTS</Text>
                ) : null}
              </>
            }
            renderItem={({ item }) => {
              const mine = item.user_id === myUserId;
              const isArtistComment = item.author?.role === 'artist';
              return (
                <Pressable
                  style={styles.comment}
                  onLongPress={() => {
                    if (!mine || isArtist) setActionTarget(item);
                  }}
                  delayLongPress={300}>
                  <Pressable onPress={() => showProfile(item.user_id)} hitSlop={6}>
                    <Avatar
                      path={item.author?.avatar_path}
                      focus={item.author?.avatar_focus}
                      name={item.author?.display_name}
                      size={30}
                    />
                  </Pressable>
                  <View style={styles.bubble}>
                    <View style={styles.whoRow}>
                      <Text style={styles.who}>{item.author?.display_name ?? 'Deleted user'}</Text>
                      {isArtistComment ? (
                        <Text style={styles.artistCross}>†</Text>
                      ) : null}
                      {item.pinned ? <Text style={styles.pin}>PINNED</Text> : null}
                    </View>
                    <Text style={styles.body}>{item.body}</Text>
                    <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <EmptyState
                icon="chatbubble-outline"
                title="No comments yet"
                sub="Be the first to say something."
              />
            }
          />
        )}

        {actionTarget ? (
          <View style={styles.actionBar}>
            <Text style={styles.actionTitle} numberOfLines={1}>
              {actionTarget.author?.display_name}: “{actionTarget.body}”
            </Text>
            {reporting ? (
              <View style={styles.actionRow}>
                {REPORT_REASONS.map((reason) => (
                  <Pressable key={reason} style={styles.chip} onPress={() => handleReport(reason)}>
                    <Text style={styles.chipText}>{reason}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.actionRow}>
                {actionTarget.user_id !== myUserId ? (
                  <Pressable style={styles.chip} onPress={() => setReporting(true)}>
                    <Text style={styles.chipText}>Report</Text>
                  </Pressable>
                ) : null}
                {isArtist ? (
                  <>
                    <Pressable style={styles.chip} onPress={handlePin}>
                      <Text style={styles.chipText}>{actionTarget.pinned ? 'Unpin' : 'Pin'}</Text>
                    </Pressable>
                    <Pressable style={styles.chip} onPress={handleDelete}>
                      <Text style={styles.chipDanger}>Delete</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            )}
            <Pressable
              onPress={() => {
                setActionTarget(null);
                setReporting(false);
              }}
              hitSlop={8}
              style={styles.actionClose}>
              <Ionicons name="close" size={18} color="#888" />
            </Pressable>
          </View>
        ) : null}

        {post ? (
          <View style={styles.composer}>
            <TextInput
              style={styles.input}
              placeholder="Add a comment…"
              placeholderTextColor="#55585f"
              value={draft}
              onChangeText={setDraft}
              maxLength={500}
              multiline
            />
            <Pressable
              style={[styles.send, (!draft.trim() || sending) && styles.sendDisabled]}
              onPress={handleSend}
              disabled={!draft.trim() || sending}>
              {sending ? (
                <ActivityIndicator color="#0b0c0e" size="small" />
              ) : (
                <Ionicons name="arrow-up" size={18} color="#0b0c0e" />
              )}
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerTitle: { color: '#fff', fontSize: 17, fontFamily: DISPLAY_FONT, letterSpacing: 1.5 },
  notice: { color: '#4fc07a', paddingHorizontal: 16, paddingVertical: 4, fontSize: 13 },
  error: { color: '#f87171', paddingHorizontal: 16, paddingVertical: 4, fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  empty: { color: '#55585f' },
  goneWrap: { flex: 1, justifyContent: 'center' },
  // The PostCard brings its own 14px side margins; the comment rows pad
  // themselves so both line up on the same edge.
  list: { paddingVertical: 14, flexGrow: 1 },
  commentPad: { paddingHorizontal: 14, paddingTop: 4 },
  commentsLabel: {
    color: '#6d7076',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.2,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  comment: { flexDirection: 'row', gap: 9, marginBottom: 12, paddingHorizontal: 14 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1e2126',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: '#8f99a3', fontWeight: '700', fontSize: 12 },
  bubble: {
    flex: 1,
    backgroundColor: '#131519',
    borderRadius: 4,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    padding: 11,
  },
  whoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  who: { color: '#fff', fontWeight: '600', fontSize: 12.5 },
  artistCross: { color: '#dce3ea', fontSize: 12, fontWeight: '700' },
  mood: { color: '#8f99a3', fontSize: 11, fontStyle: 'italic', flexShrink: 1 },
  pin: {
    color: '#c3cdd6',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    backgroundColor: 'rgba(195, 205, 214, 0.1)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 'auto',
  },
  body: { color: '#cbcdd1', fontSize: 13.5, lineHeight: 19 },
  time: { color: '#55585f', fontSize: 10.5, marginTop: 4 },
  actionBar: {
    backgroundColor: '#131519',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#23262b',
  },
  actionTitle: { color: '#8f99a3', fontSize: 12, marginBottom: 8, paddingRight: 24 },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: '#1e2126', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  chipDanger: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  actionClose: { position: 'absolute', top: 10, right: 12 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#23262b',
  },
  input: {
    flex: 1,
    color: '#fff',
    backgroundColor: '#131519',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    fontSize: 14,
    maxHeight: 110,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
});
