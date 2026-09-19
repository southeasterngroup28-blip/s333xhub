import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  LinearTransition,
  useAnimatedKeyboard,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/app-background';
import { Avatar } from '@/components/avatar';
import { EdgeGlass, FadeMask } from '@/components/edge-fade';
import { EmptyState } from '@/components/empty-state';
import { useProfileCard } from '@/components/profile-card';
import { CommentSkeleton, Skeleton } from '@/components/skeleton';
import { OFFLINE_SUB, REPORT_FAILED, REPORT_SENT, RETRY } from '@/constants/copy';
import { DISPLAY_FONT } from '@/constants/type';
import { errorFeedback, pressFeedback, successFeedback, tapFeedback } from '@/lib/haptics';
import { fileReport, REPORT_REASONS } from '@/lib/moderation';
import { fetchPostById, timeAgo, type Post, type Project } from '@/lib/posts';
import { cleanMessage } from '@/lib/profanity';
import { displayName } from '@/lib/profiles';
import {
  addComment,
  COMMENT_PAGE_SIZE,
  deleteComment,
  fetchCommentCount,
  fetchComments,
  setPinned,
  subscribeToComments,
  type Comment,
} from '@/lib/social';
import { supabase } from '@/lib/supabase';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { useAuth } from '@/providers/auth-provider';

// Project emblems: S333XGOD = blue star, Mazze = green skull.
const EMBLEMS = {
  mazze: require('../../../assets/images/emblem-mazze.png'),
  s333xgod: require('../../../assets/images/emblem-s333xgod.png'),
} as const;

// The artist's comments sit on a "stage" panel tinted with the post's
// project accent — the same green / blue the feed cards wear as borders.
const STAGE_TINT: Record<Project, { fill: string; line: string }> = {
  // Solid fills on purpose: fans set photo backgrounds, and anything translucent
  // turns unreadable over them (same lesson as the chat rows).
  mazze: { fill: '#121a14', line: 'rgba(126, 211, 84, 0.3)' },
  s333xgod: { fill: '#101720', line: 'rgba(88, 178, 235, 0.3)' },
};

const SILVER = '#c3cdd6';
/** The floating header's height below the status bar. */
const HEADER_HEIGHT = 52;
/** The load-failure pill copy, matched on success so only IT clears. */
const LOAD_FAILED_COPY = 'Could not load comments.';

/**
 * A rendered thread row: a server comment, or my own send still on its
 * way. clientKey is the row's render identity — it survives the
 * temp-to-server id swap so the row never remounts (which would replay
 * its entrance mid-rise).
 */
type Row = Comment & { pending?: boolean; clientKey?: string };

/** Pinned first, then oldest to newest — the server's thread order. */
function byThreadOrder(a: Row, b: Row): number {
  return Number(b.pinned) - Number(a.pinned) || a.created_at.localeCompare(b.created_at);
}

/**
 * The comments thread for one post. The post itself lives in the feed —
 * this screen is the conversation alone: a floating header, the thread,
 * and a pill composer riding over a bottom fade.
 */
export default function CommentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showProfile } = useProfileCard();
  const reduceMotion = useReduceMotion();
  const isArtist = profile?.role === 'artist';
  const myUserId = session?.user.id;

  // The post is fetched only for its title (header) and project (tint +
  // emblem) — and to notice when it has been deleted out from under us.
  const [post, setPost] = useState<Post | null>(null);
  /** True when the post was deleted (or a bad deep link) — not a fetch error. */
  const [postGone, setPostGone] = useState(false);
  const [postLoading, setPostLoading] = useState(true);

  const [comments, setComments] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  /** Send/pin/delete/report problems — the flash pill under the header. */
  const [error, setError] = useState<string | null>(null);
  /**
   * The comments fetch itself failed. Dedicated on purpose: `error` is
   * shared with the user actions, and keying the retry card off it would
   * flip the whole thread into a reload card after a failed send.
   */
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState('');
  const [actionTarget, setActionTarget] = useState<Row | null>(null);
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** The server's full thread size — honest while only one page is loaded. */
  const [commentCount, setCommentCount] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [endReached, setEndReached] = useState(true);

  const listRef = useRef<FlatList<Row>>(null);
  /** Mirror for callbacks that outlive a render (realtime, load catch). */
  const commentsRef = useRef<Row[]>([]);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  // ---- optimistic send + realtime bookkeeping ----
  /** Ids that arrived live THIS session — only these animate in. */
  const liveIds = useRef(new Set<string>());
  /** Sends still waiting on the server. */
  const inFlightRef = useRef(0);
  /**
   * Our own realtime echoes that raced an in-flight send: held until every
   * send settles (the temp-to-server swaps land first), then folded back
   * in — the append dedupes by id, so nothing doubles.
   */
  const heldEchoesRef = useRef<Comment[]>([]);
  /** The newest PAGED created_at — pages continue from here, never from
   * a sent or live row that jumped past the loaded window. */
  const cursorRef = useRef<string | null>(null);
  const loadingMoreRef = useRef(false);
  /** Bumps on every full (re)load; a stale page fetch that raced it gets
   * discarded whole — cursor write included — so pages never skip. */
  const fetchSeq = useRef(0);
  /** Full reloads in flight — paging pauses so its cursor stays coherent. */
  const loadsInFlightRef = useRef(0);

  // The composer rides the keyboard frame for frame; the spacer in the
  // list footer grows by the same amount so the thread's end stays
  // reachable above the pill.
  const keyboard = useAnimatedKeyboard();
  const insetsBottom = insets.bottom;
  const composerLift = useAnimatedStyle(
    () => ({
      transform: [{ translateY: -Math.max(keyboard.height.value - insetsBottom, 0) }],
    }),
    [insetsBottom]
  );
  const keyboardSpacer = useAnimatedStyle(
    () => ({ height: Math.max(keyboard.height.value - insetsBottom, 0) }),
    [insetsBottom]
  );

  const loadPost = useCallback(async () => {
    if (!id) return;
    try {
      const fresh = await fetchPostById(id);
      if (!fresh) {
        // Deleted post — nothing to comment on any more.
        setPostGone(true);
        return;
      }
      setPost(fresh);
    } catch (e) {
      // A mangled deep link (non-uuid id) is Postgres 22P02 — treat it like a
      // missing post rather than surfacing the raw database text.
      const err = e as { code?: string; message?: string };
      if (err?.code === '22P02' || /invalid input syntax for type uuid/i.test(err?.message ?? '')) {
        setPostGone(true);
      } else {
        console.warn('[comments] post fetch failed', e);
        setError('Could not load this post.');
      }
    } finally {
      setPostLoading(false);
    }
  }, [id]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoadFailed(false);
    const seq = ++fetchSeq.current;
    loadsInFlightRef.current += 1;
    try {
      const [rows, count] = await Promise.all([fetchComments(id), fetchCommentCount(id)]);
      if (seq !== fetchSeq.current) return;
      const page = rows.filter((r) => !r.pinned);
      const pageEnd = page.length > 0 ? page[page.length - 1].created_at : null;
      cursorRef.current = pageEnd;
      setEndReached(page.length < COMMENT_PAGE_SIZE);
      setCommentCount(count);
      // An old load-failure pill comes down now that a load succeeded; a
      // send/pin/delete failure the fan has not read yet stays up.
      setError((prev) => (prev === LOAD_FAILED_COPY ? null : prev));
      setComments((prev) => {
        const prevById = new Map(prev.map((c) => [c.id, c] as const));
        const pendingKeys = new Set(
          prev.filter((c) => c.pending).map((c) => `${c.user_id}\n${c.body}`)
        );
        const fresh = rows
          // A fetched row that is really an in-flight send's committed
          // copy stays hidden behind its temp — the reconcile swaps the
          // server row in under the temp's key, so it never doubles.
          .filter((r) => prevById.has(r.id) || !pendingKeys.has(`${r.user_id}\n${r.body}`))
          // Carry a reconciled send's render identity forward, so the
          // refresh never remounts that row (and never paints its ghost).
          .map((r) => {
            const old = prevById.get(r.id);
            return old?.clientKey ? { ...r, clientKey: old.clientKey } : r;
          });
        const ids = new Set(rows.map((r) => r.id));
        // Keep sends still in flight, plus loaded rows past the refreshed
        // window (later pages, reconciled sends, live arrivals) — replacing
        // them would eat a fan's just-posted comment on a long thread.
        const extras = prev.filter(
          (c) =>
            !ids.has(c.id) &&
            (c.pending || (pageEnd !== null && !c.pinned && c.created_at > pageEnd))
        );
        return [...fresh, ...extras].sort(byThreadOrder);
      });
    } catch {
      if (seq !== fetchSeq.current) return;
      setLoadFailed(true);
      // A populated thread keeps its comments; the pill says what happened.
      if (commentsRef.current.length > 0) setError(LOAD_FAILED_COPY);
    } finally {
      loadsInFlightRef.current -= 1;
      setLoading(false);
    }
  }, [id]);

  const loadNewer = useCallback(async () => {
    if (
      loadingMoreRef.current ||
      loadsInFlightRef.current > 0 ||
      endReached ||
      loading ||
      !id ||
      !cursorRef.current
    )
      return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = fetchSeq.current;
    try {
      const page = await fetchComments(id, cursorRef.current);
      // A refresh reset the thread mid-flight: this page belongs to the
      // old cursor. Drop it whole — cursor write included.
      if (seq !== fetchSeq.current) return;
      if (page.length > 0) cursorRef.current = page[page.length - 1].created_at;
      setEndReached(page.length < COMMENT_PAGE_SIZE);
      setComments((prev) => {
        const seen = new Set(prev.map((c) => c.id));
        const pendingKeys = new Set(
          prev.filter((c) => c.pending).map((c) => `${c.user_id}\n${c.body}`)
        );
        const fresh = page.filter(
          (c) => !seen.has(c.id) && !pendingKeys.has(`${c.user_id}\n${c.body}`)
        );
        if (fresh.length === 0) return prev;
        // Re-sort: a just-sent or live-arrived row already sits at the end
        // and glides to its true slot as its page scrolls in.
        return [...prev, ...fresh].sort(byThreadOrder);
      });
    } catch {
      // Network blip — the next scroll retries.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [id, endReached, loading]);

  useEffect(() => {
    loadPost();
  }, [loadPost]);

  useEffect(() => {
    load();
  }, [load]);

  /** New comments arrive via realtime AND our own sends — dedupe by id. */
  const appendLive = useCallback((incoming: Comment, fresh = true) => {
    if (fresh && !commentsRef.current.some((c) => c.id === incoming.id)) {
      // Genuinely new this session: entitled to its entrance animation.
      liveIds.current.add(incoming.id);
      setTimeout(() => liveIds.current.delete(incoming.id), 1500);
      setCommentCount((count) => (count === null ? count : count + 1));
    }
    setComments((prev) => {
      if (prev.some((c) => c.id === incoming.id)) return prev;
      // Sorted in, not appended: two live refetches can resolve out of
      // order, and an inverted pair would otherwise stand forever. Safe
      // for temps — they are stamped at least the newest loaded time.
      return [...prev, incoming].sort(byThreadOrder);
    });
  }, []);

  useEffect(() => {
    if (!id) return;
    const sub = subscribeToComments(id, (incoming) => {
      if (incoming.user_id === myUserId && inFlightRef.current > 0) {
        // My own echo racing an in-flight send: hold it until every send
        // settles, so the temp-to-server swap wins and nothing doubles.
        heldEchoesRef.current.push(incoming);
        return;
      }
      appendLive(incoming);
    });
    return () => {
      supabase.removeChannel(sub);
    };
  }, [id, myUserId, appendLive]);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    []
  );
  function flash(text: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function closeActions() {
    setActionTarget(null);
    setReporting(false);
  }

  function scrollToLatest() {
    listRef.current?.scrollToEnd({ animated: !reduceMotion });
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      // Both together, so a deleted post is noticed on the same gesture.
      await Promise.all([load(), loadPost()]);
    } finally {
      setRefreshing(false);
    }
  }

  function handleSend() {
    const body = cleanMessage(draft.trim());
    if (!body || !id || !myUserId) return;
    pressFeedback();
    const tempId = `temp-${Date.now()}`;
    // Stamp the temp no earlier than the newest loaded comment: a device
    // clock trailing the server must not seat my row above newer arrivals,
    // only for it to jump when the server timestamp lands.
    let stampMs = Date.now();
    for (const c of commentsRef.current) {
      const t = new Date(c.created_at).getTime() + 1;
      if (t > stampMs) stampMs = t;
    }
    const temp: Row = {
      id: tempId,
      clientKey: tempId,
      pending: true,
      post_id: id,
      user_id: myUserId,
      body,
      pinned: false,
      created_at: new Date(stampMs).toISOString(),
      deleted_at: null,
      author: profile
        ? {
            display_name: profile.display_name,
            role: profile.role,
            status: profile.status,
            avatar_path: profile.avatar_path,
            avatar_focus: profile.avatar_focus,
          }
        : null,
    };
    const wasEndReached = endReached;
    setComments((prev) => [...prev, temp]);
    setCommentCount((count) => (count === null ? count : count + 1));
    setDraft('');
    // Same-tick scrollToEnd measures stale content height — wait a frame.
    requestAnimationFrame(() => scrollToLatest());
    inFlightRef.current += 1;
    addComment(id, body)
      .then((server) => {
        setComments((prev) => {
          if (prev.some((c) => c.id === server.id)) {
            // The realtime echo landed first: keep its row, retire the temp.
            return prev.filter((c) => c.id !== tempId);
          }
          // Swap in the server row under the temp's render identity, so
          // the row never remounts and its entrance never replays.
          return prev.map((c) => (c.id === tempId ? { ...server, clientKey: tempId } : c));
        });
        if (!wasEndReached) {
          // Pages between the loaded window and my new comment are still
          // on the server — keep walking the cursor so the row can settle
          // into its true place without jumping or doubling.
          loadNewer();
        }
      })
      .catch(() => {
        setComments((prev) => prev.filter((c) => c.id !== tempId));
        setCommentCount((count) => (count === null ? count : Math.max(0, count - 1)));
        errorFeedback();
        setError('Could not post the comment.');
        // Give the words back — unless they already started typing again.
        setDraft((d) => (d.trim() ? d : body));
      })
      .finally(() => {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        if (inFlightRef.current === 0 && heldEchoesRef.current.length > 0) {
          const held = heldEchoesRef.current;
          heldEchoesRef.current = [];
          held.forEach((c) => appendLive(c, false));
        }
      });
  }

  function handlePin() {
    if (!actionTarget) return;
    const target = actionTarget;
    closeActions();
    const next = !target.pinned;
    // Optimistic, with the map clearing every other pin to match
    // setPinned's exclusive one-per-post semantics.
    setComments((prev) =>
      prev
        .map((c) => ({ ...c, pinned: c.id === target.id ? next : false }))
        .sort(byThreadOrder)
    );
    successFeedback();
    flash(next ? 'Pinned to the top.' : 'Unpinned.');
    setPinned(target, next).catch(async () => {
      errorFeedback();
      setError(next ? 'Could not pin the comment.' : 'Could not unpin the comment.');
      // Resync rather than snapshot-revert — a concurrent send would be
      // dropped by a snapshot.
      await load();
    });
  }

  function handleDelete() {
    if (!actionTarget) return;
    const target = actionTarget;
    closeActions();
    setComments((prev) => prev.filter((c) => c.id !== target.id));
    setCommentCount((count) => (count === null ? count : Math.max(0, count - 1)));
    successFeedback();
    flash('Comment deleted.');
    deleteComment(target.id).catch(() => {
      // Re-insert just the deleted row, back in order — a snapshot rewind
      // would drop anything that arrived while the delete was in flight.
      setComments((prev) =>
        prev.some((c) => c.id === target.id) ? prev : [...prev, target].sort(byThreadOrder)
      );
      setCommentCount((count) => (count === null ? count : count + 1));
      errorFeedback();
      setError('Could not delete the comment.');
    });
  }

  async function handleReport(reason: string) {
    if (!actionTarget) return;
    const target = actionTarget;
    closeActions();
    try {
      await fileReport('comment', target.id, reason);
      successFeedback();
      flash(REPORT_SENT);
    } catch (e) {
      console.warn('[comments] report failed', e);
      errorFeedback();
      setError(REPORT_FAILED);
    }
  }

  function retryLoad() {
    tapFeedback();
    setLoadFailed(false);
    setLoading(true);
    load();
  }

  const project: Project = post?.project ?? 'mazze';
  const tint = STAGE_TINT[project];
  const emblem = EMBLEMS[project];
  const listTop = insets.top + HEADER_HEIGHT + 12;
  const canSend = !!draft.trim();

  /** The small floating toolbar raised over the held comment. */
  function renderToolbar(target: Row) {
    const canReport = target.user_id !== myUserId;
    return (
      <Animated.View
        style={[styles.toolbar, reporting && styles.toolbarMenu]}
        layout={reduceMotion ? undefined : LinearTransition.duration(140)}>
        {reporting ? (
          REPORT_REASONS.map((reason, index) => (
            <Animated.View
              key={reason}
              entering={reduceMotion ? undefined : FadeIn.duration(100)}>
              <Pressable
                style={[styles.toolItem, index > 0 && styles.toolItemRuleTop]}
                onPress={() => handleReport(reason)}>
                <Text style={styles.toolText}>{reason}</Text>
              </Pressable>
            </Animated.View>
          ))
        ) : (
          <>
            {isArtist ? (
              <>
                <Pressable style={styles.toolItem} onPress={handlePin}>
                  <Text style={styles.toolText}>{target.pinned ? 'Unpin' : 'Pin'}</Text>
                </Pressable>
                <Pressable style={[styles.toolItem, styles.toolItemRule]} onPress={handleDelete}>
                  <Text style={[styles.toolText, styles.toolDanger]}>Delete</Text>
                </Pressable>
              </>
            ) : null}
            {canReport ? (
              <Pressable
                style={[styles.toolItem, isArtist && styles.toolItemRule]}
                onPress={() => setReporting(true)}>
                <Text style={styles.toolText}>Report</Text>
              </Pressable>
            ) : null}
          </>
        )}
        <View style={styles.toolbarArrow} />
      </Animated.View>
    );
  }

  function renderComment({ item }: { item: Row }) {
    const mine = item.user_id === myUserId;
    const isArtistComment = item.author?.role === 'artist';
    const held = actionTarget?.id === item.id;
    const name = displayName(item.author);
    const when = timeAgo(item.created_at);
    // Entrances belong to genuinely new rows only: my own pending sends
    // and live arrivals — never a page load, a refetch, or a scroll-back.
    const animateIn = !reduceMotion && (item.pending || liveIds.current.has(item.id));

    return (
      <Animated.View
        style={held ? styles.heldWrap : undefined}
        entering={animateIn ? FadeInDown.duration(item.pending ? 200 : 220) : undefined}
        exiting={reduceMotion ? undefined : FadeOut.duration(160)}>
        {held ? (
          <Animated.View
            style={styles.toolbarStrip}
            entering={reduceMotion ? undefined : FadeInUp.duration(140)}
            exiting={reduceMotion ? undefined : FadeOut.duration(100)}>
            {renderToolbar(item)}
          </Animated.View>
        ) : null}
        {/* itemLayoutAnimation only moves item positions — this inner
            layout transition animates the held row's own content as the
            toolbar strip blooms above it. */}
        <Animated.View layout={reduceMotion ? undefined : LinearTransition.duration(160)}>
          <Pressable
            style={({ pressed }) => [
              held ? (isArtistComment ? styles.heldBandStage : styles.heldBandFan) : undefined,
              item.pending && styles.pendingRow,
              pressed && styles.rowPressed,
            ]}
            onPress={() => {
              if (actionTarget) closeActions();
            }}
            onLongPress={() => {
              // A pending row has no server id yet — actions would 404.
              if (item.pending) return;
              if (!mine || isArtist) {
                tapFeedback();
                setActionTarget(item);
              }
            }}
            delayLongPress={300}>
            {isArtistComment ? (
              <View style={[styles.stage, { backgroundColor: tint.fill, borderColor: tint.line }]}>
                <View style={styles.stageTop}>
                  <Pressable onPress={() => showProfile(item.user_id)} hitSlop={6}>
                    <Image source={emblem} style={styles.stageEmblem} contentFit="contain" />
                  </Pressable>
                  <Text style={styles.stageName} numberOfLines={1}>
                    {name}
                  </Text>
                  {item.pinned ? <Text style={styles.pinned}>PINNED</Text> : null}
                  <Text style={styles.stageTime}>{when}</Text>
                </View>
                <Text style={styles.stageBody}>{item.body}</Text>
              </View>
            ) : (
              <View style={styles.fan}>
                <Pressable
                  onPress={() => showProfile(item.user_id)}
                  hitSlop={6}
                  style={styles.fanAvatar}>
                  <Avatar
                    path={item.author?.avatar_path}
                    focus={item.author?.avatar_focus}
                    name={item.author?.display_name}
                    size={26}
                  />
                </Pressable>
                <View style={styles.fanBody}>
                  <View style={styles.fanMeta}>
                    <Text style={styles.fanName} numberOfLines={1}>
                      {name}
                    </Text>
                    {item.pinned ? <Text style={styles.pinned}>PINNED</Text> : null}
                    <Text style={styles.fanTime}>{when}</Text>
                  </View>
                  <Text style={styles.fanText}>{item.body}</Text>
                </View>
              </View>
            )}
          </Pressable>
        </Animated.View>
      </Animated.View>
    );
  }

  return (
    <View style={styles.safe}>
      <AppBackground />
      <View style={styles.flex}>
        {postLoading || loading ? (
          <View style={[styles.skeletons, { paddingTop: listTop }]}>
            <Skeleton width={96} height={12} radius={4} style={styles.skeletonLabel} />
            {[0, 1, 2, 3].map((n) => (
              <View key={n} style={styles.skeletonRow}>
                <CommentSkeleton />
              </View>
            ))}
          </View>
        ) : postGone ? (
          <View style={styles.goneWrap}>
            <EmptyState icon="eye-off-outline" title="This post is gone" />
          </View>
        ) : !post ? (
          <View style={styles.goneWrap}>
            <EmptyState
              icon="cloud-offline-outline"
              title="Couldn't load this post"
              sub={OFFLINE_SUB}
              action={{
                label: RETRY,
                onPress: () => {
                  tapFeedback();
                  setError(null);
                  setPostLoading(true);
                  loadPost();
                  if (loadFailed) {
                    // The comments fetch failed too; retry both at once.
                    setLoadFailed(false);
                    setLoading(true);
                    load();
                  }
                },
              }}
            />
          </View>
        ) : (
          <FadeMask top={insets.top + HEADER_HEIGHT + 8} bottom={insets.bottom + 120}>
            <Animated.FlatList
              ref={listRef}
              data={comments}
              keyExtractor={(item: Row) => item.clientKey ?? item.id}
              renderItem={renderComment}
              extraData={[actionTarget, reporting, project]}
              itemLayoutAnimation={
                reduceMotion ? undefined : LinearTransition.duration(actionTarget ? 160 : 250)
              }
              contentContainerStyle={[
                styles.list,
                { paddingTop: listTop, paddingBottom: insets.bottom + 130 },
              ]}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              onEndReached={loadNewer}
              onEndReachedThreshold={0.5}
              refreshControl={
                <RefreshControl tintColor="#fff" refreshing={refreshing} onRefresh={handleRefresh} />
              }
              onScrollBeginDrag={() => {
                if (actionTarget) closeActions();
              }}
              ListHeaderComponent={
                comments.length > 0 ? (
                  <View style={styles.threadLabel}>
                    <Text style={styles.threadLabelText}>COMMENTS</Text>
                    <Text style={styles.threadCount}>{commentCount ?? comments.length}</Text>
                  </View>
                ) : null
              }
              ListEmptyComponent={
                loadFailed ? (
                  <Animated.View
                    style={styles.failedCard}
                    entering={reduceMotion ? undefined : FadeInDown.duration(220)}>
                    <Text style={styles.emptyTitle}>{"COULDN'T LOAD COMMENTS"}</Text>
                    <Text style={styles.emptySub}>{OFFLINE_SUB}</Text>
                    <Pressable
                      style={({ pressed }) => [styles.retryPill, pressed && styles.retryPillPressed]}
                      hitSlop={8}
                      onPress={retryLoad}>
                      <Text style={styles.retryPillText}>{RETRY}</Text>
                    </Pressable>
                  </Animated.View>
                ) : (
                  // Only a fetch that genuinely succeeded empty says so.
                  <View style={styles.empty}>
                    <Image source={emblem} style={styles.emptyEmblem} contentFit="contain" />
                    <View style={styles.emptyText}>
                      <Text style={styles.emptyTitle}>NO COMMENTS</Text>
                    </View>
                  </View>
                )
              }
              ListFooterComponent={
                <>
                  {loadingMore ? (
                    <View style={styles.footerSkeleton}>
                      <CommentSkeleton />
                    </View>
                  ) : null}
                  {/* Grows with the keyboard so the thread's end stays
                      reachable above the lifted composer. */}
                  <Animated.View style={keyboardSpacer} />
                </>
              }
            />
          </FadeMask>
        )}

        <EdgeGlass />

        {/* The header floats OVER the thread; comments slide beneath it
            and dissolve in its zone. */}
        <View style={[styles.topBar, { top: insets.top }]} pointerEvents="box-none">
          <Pressable onPress={goBack} hitSlop={12} style={styles.backButton}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <View style={styles.titleBlock} pointerEvents="none">
            <Text style={styles.title}>COMMENTS</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {postLoading || !post ? '' : displayName(post.author)}
            </Text>
          </View>
          <View style={styles.backButton} />
        </View>

        {error || notice ? (
          <Pressable
            style={[styles.flash, { top: insets.top + HEADER_HEIGHT + 6 }]}
            onPress={() => setError(null)}
            disabled={!error}>
            <Text style={[styles.flashText, error ? styles.flashError : styles.flashOk]}>
              {error ?? notice}
            </Text>
          </Pressable>
        ) : null}

        {post && !postGone ? (
          <Animated.View
            style={[styles.composerWrap, { bottom: insets.bottom + 14 }, composerLift]}>
            <View style={styles.pill}>
              <TextInput
                style={styles.input}
                placeholder="Add a comment…"
                placeholderTextColor="#55585f"
                value={draft}
                onChangeText={setDraft}
                onFocus={() => {
                  // A beat after focus, so the footer spacer has grown and
                  // scrollToEnd measures the real height.
                  setTimeout(() => scrollToLatest(), 50);
                }}
                maxLength={500}
                multiline
              />
              <Pressable
                style={[styles.send, !canSend && styles.sendDisabled]}
                onPress={handleSend}
                disabled={!canSend}>
                <Ionicons name="arrow-up" size={18} color="#0b0c0e" />
              </Pressable>
            </View>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  flex: { flex: 1 },

  // ---- floating header ----
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  backButton: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  title: {
    color: '#fff',
    fontFamily: DISPLAY_FONT,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: 1.5,
  },
  subtitle: {
    color: '#55585f',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    maxWidth: '90%',
  },
  flash: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 21,
    backgroundColor: 'rgba(21, 24, 29, 0.97)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2e34',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    maxWidth: '86%',
  },
  flashText: { fontSize: 12.5, fontWeight: '600' },
  flashOk: { color: '#4fc07a' },
  flashError: { color: '#f87171' },

  // ---- loading + gone ----
  skeletons: { paddingHorizontal: 14 },
  skeletonLabel: { marginBottom: 14 },
  skeletonRow: { marginBottom: 10 },
  goneWrap: { flex: 1, justifyContent: 'center' },

  // ---- thread ----
  list: { paddingHorizontal: 14, flexGrow: 1 },
  threadLabel: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: 2,
    paddingTop: 2,
    paddingBottom: 10,
  },
  threadLabelText: {
    color: '#fff',
    fontFamily: DISPLAY_FONT,
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 2,
  },
  threadCount: {
    color: '#55585f',
    fontSize: 11.5,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  footerSkeleton: { marginBottom: 10 },

  // Artist comments: the stage panel.
  stage: {
    borderRadius: 14,
    borderWidth: 1,
    paddingTop: 11,
    paddingHorizontal: 13,
    paddingBottom: 12,
    marginBottom: 12,
  },
  stageTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  stageEmblem: { width: 22, height: 22 },
  stageName: {
    color: '#fff',
    fontFamily: DISPLAY_FONT,
    fontSize: 15,
    lineHeight: 19,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  pinned: {
    color: SILVER,
    fontFamily: DISPLAY_FONT,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 2,
    paddingLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(195, 205, 214, 0.35)',
  },
  stageTime: {
    marginLeft: 'auto',
    color: SILVER,
    opacity: 0.8,
    fontSize: 11,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  stageBody: { color: '#f0f2ef', fontSize: 14.5, lineHeight: 21 },

  // Fan comments: minimal rows.
  fan: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#131519',
    borderRadius: 14,
    paddingTop: 11,
    paddingHorizontal: 13,
    paddingBottom: 12,
    marginBottom: 12,
  },
  fanAvatar: { marginTop: 1 },
  fanBody: { flex: 1, minWidth: 0 },
  fanMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 2 },
  fanName: { color: '#a9adb4', fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  fanTime: {
    color: '#55585f',
    fontSize: 11,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  fanText: { color: '#cbcdd1', fontSize: 13.5, lineHeight: 19 },

  // My send on its way to the server, and the hold acknowledgment.
  pendingRow: { opacity: 0.7 },
  rowPressed: { opacity: 0.85 },

  // Held (long-pressed): a full-bleed tint under the comment, the toolbar
  // raised in a strip above it. The strip is in normal flow so its buttons
  // stay inside the row's bounds (Android drops touches that fall outside).
  heldWrap: { marginHorizontal: -14 },
  toolbarStrip: {
    alignItems: 'flex-end',
    paddingRight: 16,
    paddingTop: 4,
    paddingBottom: 7,
  },
  heldBandFan: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  heldBandStage: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 14,
    paddingTop: 6,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e2126',
    borderWidth: 1,
    borderColor: '#2a2e34',
    borderRadius: 999,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  // Report reasons are too long for one pill — they stack as a small menu.
  toolbarMenu: {
    flexDirection: 'column',
    alignItems: 'stretch',
    borderRadius: 16,
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
  toolItem: { paddingVertical: 7, paddingHorizontal: 12 },
  toolItemRule: { borderLeftWidth: 1, borderLeftColor: '#2a2e34' },
  toolItemRuleTop: { borderTopWidth: 1, borderTopColor: '#2a2e34' },
  toolText: { color: '#fff', fontSize: 12.5, lineHeight: 16, fontWeight: '600' },
  toolDanger: { color: '#f87171' },
  toolbarArrow: {
    position: 'absolute',
    right: 26,
    bottom: -5,
    width: 9,
    height: 9,
    backgroundColor: '#1e2126',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#2a2e34',
    transform: [{ rotate: '45deg' }],
  },

  // ---- empty + failed ----
  empty: {
    backgroundColor: '#131519',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emptyEmblem: { width: 26, height: 26, opacity: 0.45 },
  emptyText: { flex: 1 },
  emptyTitle: {
    color: '#e8e9eb',
    fontFamily: DISPLAY_FONT,
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 1.6,
  },
  emptySub: { color: '#6d7076', fontSize: 12.5, marginTop: 2 },
  // Solid fill on purpose — this file's documented decision for read
  // surfaces over fan photo backgrounds.
  failedCard: {
    backgroundColor: '#131519',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 13,
  },
  retryPill: {
    alignSelf: 'flex-start',
    marginTop: 12,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2a2e34',
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryPillPressed: { opacity: 0.7 },
  retryPillText: { color: '#e8e9eb', fontSize: 13, fontWeight: '600' },

  // ---- composer: a pill floating over the bottom fade ----
  composerWrap: { position: 'absolute', left: 16, right: 16, zIndex: 20 },
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    minHeight: 50,
    backgroundColor: 'rgba(21, 24, 29, 0.97)',
    borderWidth: 1,
    borderColor: '#2a2e34',
    borderRadius: 999,
    paddingVertical: 5,
    paddingLeft: 16,
    paddingRight: 5,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    lineHeight: 18,
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 0,
    maxHeight: 110,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
});
