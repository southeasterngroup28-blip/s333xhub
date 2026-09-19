import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/app-background';
import { EdgeGlass, FadeMask } from '@/components/edge-fade';
import { PostCard } from '@/components/post-card';
import { EmptyState } from '@/components/empty-state';
import { PostSkeleton } from '@/components/skeleton';
import { Top3Card } from '@/components/top3-card';
import { ScalePressable } from '@/components/ui/scale-pressable';
import { CHAT_SURFACE } from '@/constants/chat-surfaces';
import { OFFLINE_SUB, RETRY } from '@/constants/copy';
import { fanCopy } from '@/lib/fan-error';
import { tapFeedback } from '@/lib/haptics';
import {
  consumeFeedStale,
  fetchPosts,
  onFeedStale,
  PAGE_SIZE,
  signedUrlsFor,
  type Post,
} from '@/lib/posts';
import { fetchMyPurchasedPostIds } from '@/lib/purchases';
import {
  fetchPolls,
  fetchSocialSummary,
  fetchTopFans,
  type PollState,
  type SocialSummary,
  type TopFan,
} from '@/lib/social';
import { useAuth } from '@/providers/auth-provider';
import { usePlayerControls } from '@/providers/player-provider';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { DISPLAY_FONT } from '@/constants/type';


export function Feed() {
  const { profile, profileError } = useAuth();
  const { current: currentTrack } = usePlayerControls();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const reduceMotion = useReduceMotion();
  const [posts, setPosts] = useState<Post[]>([]);
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(new Set());
  const [feedError, setFeedError] = useState<string | null>(null);
  const [social, setSocial] = useState<SocialSummary>({ reactions: {}, commentCounts: {} });
  const [polls, setPolls] = useState<Record<string, PollState>>({});
  const [topFans, setTopFans] = useState<TopFan[]>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [endReached, setEndReached] = useState(false);
  /** Pagination is a visible state, not a silent one. */
  const [paging, setPaging] = useState<'idle' | 'loading' | 'failed'>('idle');
  const loadingMore = useRef(false);
  /** Bumps on every fresh load; stale loadMore results get discarded. */
  const fetchSeq = useRef(0);
  const lastLoadAt = useRef(0);
  const listRef = useRef<FlatList<Post>>(null);
  /** Whether this tab is the one on screen (focus effects only fire on navigation). */
  const focused = useRef(false);
  /** Rows mounted before this instant animate in; everything later renders still. */
  const animateUntil = useRef(0);

  const isArtist = profile?.role === 'artist';
  // The profile lookup runs alongside the first render, so for a beat the
  // viewer's role is simply unknown — not "fan".
  const roleUnknown = !profile && !profileError;
  /** The role the current list was resolved for; null until the first load. */
  const loadedAsArtist = useRef<boolean | null>(null);

  const resolveMedia = useCallback(
    async (batch: Post[], purchased: Set<string>) => {
      // Only request viewing links for posts this viewer may actually see:
      // the artist sees everything; fans see free posts + their unlocks.
      const visible = isArtist
        ? batch
        : batch.filter((p) => !p.is_locked || purchased.has(p.id));
      const paths = visible.flatMap((p) => [
        ...p.post_media.map((m) => m.storage_path),
        ...(p.cover_path ? [p.cover_path] : []),
      ]);
      // Locked posts still get their cover — it shows blurred as a teaser
      // (the storage rules allow covers through; the media stays sealed).
      for (const p of batch) {
        if (p.is_locked && !purchased.has(p.id) && p.cover_path) paths.push(p.cover_path);
      }
      if (paths.length === 0) return;
      const urls = await signedUrlsFor(paths);
      setMediaUrls((prev) => ({ ...prev, ...urls }));
    },
    [isArtist]
  );

  const loadFresh = useCallback(async () => {
    const seq = ++fetchSeq.current;
    lastLoadAt.current = Date.now();
    loadedAsArtist.current = isArtist;
    setPaging('idle');
    try {
      const purchased = isArtist
        ? new Set<string>()
        : await fetchMyPurchasedPostIds().catch(() => new Set<string>());
      setPurchasedIds(purchased);
      const fresh = await fetchPosts('all');
      if (seq !== fetchSeq.current) return;
      // Rows committed inside this window are genuine arrivals — they
      // animate. Later renders (scroll-back remounts, pagination) don't.
      animateUntil.current = Date.now() + 600;
      setPosts(fresh);
      setFeedError(null);
      setEndReached(fresh.length < PAGE_SIZE);

      const ids = fresh.map((p) => p.id);
      const pollIds = fresh.filter((p) => p.kind === 'poll').map((p) => p.id);
      // Media links sign IN PARALLEL with the social lookups — posts render
      // with reserved-size placeholders instead of reflowing when urls land.
      const [summary, pollStates, top] = await Promise.all([
        fetchSocialSummary(ids).catch(() => ({ reactions: {}, commentCounts: {} })),
        fetchPolls(pollIds).catch(() => ({})),
        fetchTopFans().catch(() => []),
        resolveMedia(fresh, purchased),
      ]);
      setSocial(summary);
      setPolls(pollStates);
      setTopFans(top);
    } catch (e) {
      // Surface feed failures instead of silently showing an empty feed —
      // and let the next tab focus retry past the 120s throttle.
      lastLoadAt.current = 0;
      setFeedError(fanCopy(e, 'Could not load the feed.'));
    } finally {
      // Rows first mount when `loading` flips false — on a slow signing or
      // social await that moment can be well past the pre-setPosts window,
      // so re-open it here: the initial reveal always gets its stagger.
      animateUntil.current = Date.now() + 600;
      setLoading(false);
      setRefreshing(false);
    }
  }, [isArtist, resolveMedia]);

  // Refresh on focus only when something changed (a new post was made)
  // or the data is old - otherwise keep the fan's scroll position.
  // The viewer's role decides which media links get requested (the artist
  // sees everything; fans get free posts + their unlocks), so the first
  // load waits for the profile lookup — and a profile that lands AFTER a
  // load flips the role, which needs a reload: otherwise the artist's own
  // locked posts sit with no media links and render as bare text.
  const refreshIfNeeded = useCallback(
    (scrollToTop: boolean) => {
      const { stale, payload } = consumeFeedStale();
      if (stale) {
        // A new-post push tapped while looking at the feed (or a post the
        // artist just made): bring the top into view so the new post is
        // what you see. Every other stale refresh keeps the scroll position.
        if (scrollToTop || payload?.scrollToTop) {
          listRef.current?.scrollToOffset({ offset: 0, animated: true });
        }
        const post = payload?.post;
        if (post) {
          // The finished row rides along from compose: seat it at the top
          // right now so the feed opens with it in place, and let loadFresh
          // settle up (setPosts(fresh) dedupes by id, so no remount). Its
          // row commits inside the arrival window, so it animates in.
          animateUntil.current = Date.now() + 600;
          setPosts((prev) => [post, ...prev.filter((p) => p.id !== post.id)]);
          // purchasedRef mirrors purchasedIds (declared below; read at call time).
          resolveMedia([post], purchasedRef.current).catch(() => {});
        }
        loadFresh();
      } else if (
        loadedAsArtist.current !== isArtist ||
        Date.now() - lastLoadAt.current > 120_000
      ) {
        loadFresh();
      }
    },
    [loadFresh, isArtist, resolveMedia]
  );

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      if (!roleUnknown) refreshIfNeeded(false);
      return () => {
        focused.current = false;
      };
    }, [refreshIfNeeded, roleUnknown])
  );

  // A new-post push tapped while the feed is already on screen gives no
  // focus event — the stale mark itself is the signal to refetch.
  useEffect(
    () =>
      onFeedStale(() => {
        if (focused.current && !roleUnknown) refreshIfNeeded(true);
      }),
    [refreshIfNeeded, roleUnknown]
  );

  // Re-tapping the home tab scrolls back to the top. The isFocused() guard
  // is mandatory: tabPress also fires on switch-to, and the feed preserves
  // scroll position on plain focus.
  useEffect(
    () =>
      navigation.addListener('tabPress' as never, (() => {
        if (!navigation.isFocused()) return;
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
        refreshIfNeeded(false);
      }) as never),
    [navigation, refreshIfNeeded]
  );

  async function loadMore() {
    if (loadingMore.current || endReached || posts.length === 0) return;
    loadingMore.current = true;
    setPaging('loading');
    const seq = fetchSeq.current;
    try {
      const older = await fetchPosts('all', posts[posts.length - 1].created_at);
      if (seq !== fetchSeq.current) {
        // A fresh load replaced the list mid-flight.
        setPaging('idle');
        return;
      }

      const ids = older.map((p) => p.id);
      const pollIds = older.filter((p) => p.kind === 'poll').map((p) => p.id);
      // Sign media BEFORE appending: if signing fails, the rows stay off
      // screen, the footer's "tap to retry" is honest, and the retry
      // paginates from the SAME cursor — no permanently unsigned batch.
      const [summary, pollStates] = await Promise.all([
        fetchSocialSummary(ids).catch(() => ({ reactions: {}, commentCounts: {} })),
        fetchPolls(pollIds).catch(() => ({})),
        resolveMedia(older, purchasedIds),
      ]);
      if (seq !== fetchSeq.current) {
        setPaging('idle');
        return;
      }
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...older.filter((p) => !seen.has(p.id))];
      });
      setEndReached(older.length < PAGE_SIZE);
      setSocial((prev) => ({
        reactions: { ...prev.reactions, ...summary.reactions },
        commentCounts: { ...prev.commentCounts, ...summary.commentCounts },
      }));
      setPolls((prev) => ({ ...prev, ...pollStates }));
      setPaging('idle');
    } catch {
      // Visible, recoverable: the footer offers a retry pill — unless a
      // fresh load already replaced the list this failure belonged to.
      if (seq === fetchSeq.current) setPaging('failed');
    } finally {
      loadingMore.current = false;
    }
  }

  // Ref mirror so the unlock callback stays stable (PostCard is memoized).
  const purchasedRef = useRef(purchasedIds);
  purchasedRef.current = purchasedIds;

  const handleUnlocked = useCallback(
    async (post: Post) => {
      const next = new Set(purchasedRef.current).add(post.id);
      try {
        // Resolve the media link BEFORE flipping the unlock, so the reveal
        // commits with the URL already present. The catch is mandatory: a
        // signing blip degrades to a late pop — it must never tell a paid
        // fan the purchase failed. The 4s race keeps the reveal from hanging.
        await Promise.race([
          resolveMedia([post], next),
          new Promise((resolve) => setTimeout(resolve, 4000)),
        ]);
      } catch {}
      setPurchasedIds((prev) => new Set(prev).add(post.id));
    },
    [resolveMedia]
  );

  const handleDeleted = useCallback((postId: string) => {
    // Local removal — no refetch; the row fades out and the list closes up.
    setPosts((prev) => prev.filter((p) => p.id !== postId));
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: Post; index: number }) => (
      <PostCard
        post={item}
        mediaUrls={mediaUrls}
        viewerIsArtist={isArtist}
        unlocked={purchasedIds.has(item.id)}
        reactions={social.reactions[item.id]}
        commentCount={social.commentCounts[item.id]}
        poll={polls[item.id]}
        onDeleted={handleDeleted}
        onUnlocked={handleUnlocked}
        animateIn={Date.now() < animateUntil.current}
        index={index}
      />
    ),
    [mediaUrls, isArtist, purchasedIds, social, polls, handleDeleted, handleUnlocked]
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBackground />

      {loading ? (
        <View style={styles.loadingPad}>
          <PostSkeleton />
          <PostSkeleton />
          <PostSkeleton />
        </View>
      ) : (
        <FadeMask>
          <Animated.FlatList
            ref={listRef as never}
            data={posts}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            itemLayoutAnimation={reduceMotion ? undefined : LinearTransition.duration(220)}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  loadFresh();
                }}
                tintColor="#fff"
              />
            }
            onEndReached={loadMore}
            onEndReachedThreshold={0.5}
            ListHeaderComponent={
              <>
                <Top3Card fans={topFans} viewerIsArtist={isArtist} />
              </>
            }
            ListFooterComponent={
              endReached || posts.length === 0 || paging === 'idle' ? null : paging ===
                'loading' ? (
                <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)}>
                  <PostSkeleton />
                </Animated.View>
              ) : (
                <Animated.View
                  entering={reduceMotion ? undefined : FadeIn.duration(180)}
                  style={styles.footerWrap}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.footerRetry,
                      pressed && styles.footerRetryPressed,
                    ]}
                    hitSlop={8}
                    onPress={() => {
                      tapFeedback();
                      loadMore();
                    }}>
                    <Text style={styles.footerRetryText}>
                      {"Couldn't load older posts. Try again."}
                    </Text>
                  </Pressable>
                </Animated.View>
              )
            }
            ListEmptyComponent={
              feedError ? (
                <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)}>
                  <EmptyState
                    icon="cloud-offline-outline"
                    title="Couldn't load the feed"
                    sub={OFFLINE_SUB}
                  />
                  <Pressable
                    style={({ pressed }) => [
                      styles.retryChip,
                      pressed && styles.retryChipPressed,
                    ]}
                    hitSlop={8}
                    onPress={() => {
                      tapFeedback();
                      setFeedError(null);
                      setLoading(true);
                      loadFresh();
                    }}>
                    <Text style={styles.retryChipText}>{RETRY}</Text>
                  </Pressable>
                </Animated.View>
              ) : (
                <EmptyState
                  icon="flash-outline"
                  title="Nothing dropped"
                  sub="When the artist posts, it lands here first."
                />
              )
            }
          />
        </FadeMask>
      )}

      <EdgeGlass />

      {/* The header floats OVER the list; posts slide beneath it and
          dissolve exactly in its zone — never in open space. */}
      <View style={[styles.topBar, { top: insets.top }]} pointerEvents="box-none">
        <Text style={styles.title}>S333XHUB</Text>
        <View style={styles.topActions}>
          {isArtist ? (
            <Pressable
              onPress={() => router.push('/reports')}
              hitSlop={12}
              style={({ pressed }) => (pressed ? styles.iconPressed : undefined)}>
              <Ionicons name="flag-outline" size={21} color="#8f99a3" />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => router.push('/settings')}
            hitSlop={12}
            style={({ pressed }) => (pressed ? styles.iconPressed : undefined)}>
            <Ionicons name="settings-outline" size={21} color="#8f99a3" />
          </Pressable>
        </View>
      </View>

      {feedError && posts.length > 0 ? (
        <Text style={[styles.feedError, { top: insets.top + 48 }]}>{feedError}</Text>
      ) : null}

      {profile?.role === 'artist' ? (
        <ScalePressable
          // Sit above the floating dock — and above the mini player too
          // when a track is loaded.
          style={[styles.fab, { bottom: insets.bottom + 86 + (currentTrack ? 62 : 0) }]}
          onPress={() => router.push('/compose')}>
          <Ionicons name="add" size={30} color="#0b0c0e" />
        </ScalePressable>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  loadingPad: { paddingTop: 52 },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    color: '#f4f5f6',
    fontSize: 22,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 2,
  },
  topActions: {
    position: 'absolute',
    right: 16,
    flexDirection: 'row',
    gap: 18,
    alignItems: 'center',
  },
  iconPressed: { opacity: 0.55 },
  feedError: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    textAlign: 'center',
    color: '#f87171',
    paddingHorizontal: 16,
    fontSize: 13,
  },
  list: { paddingTop: 52, paddingBottom: 170, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  empty: { color: '#555' },
  footerWrap: { alignItems: 'center', paddingVertical: 8 },
  footerRetry: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: CHAT_SURFACE,
  },
  footerRetryPressed: { opacity: 0.6 },
  footerRetryText: { color: '#c3cdd6', fontSize: 13, fontWeight: '600' },
  retryChip: {
    alignSelf: 'center',
    backgroundColor: '#1e2126',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 16,
  },
  retryChipPressed: { opacity: 0.7 },
  retryChipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
