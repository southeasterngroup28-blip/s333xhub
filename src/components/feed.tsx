import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/app-background';
import { EdgeGlass, FadeMask } from '@/components/edge-fade';
import { PostCard } from '@/components/post-card';
import { EmptyState } from '@/components/empty-state';
import { PostSkeleton } from '@/components/skeleton';
import { Top8Card } from '@/components/top8-card';
import { consumeFeedStale, fetchPosts, PAGE_SIZE, signedUrlsFor, type Post } from '@/lib/posts';
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
import { usePlayer } from '@/providers/player-provider';
import { DISPLAY_FONT } from '@/constants/type';


export function Feed() {
  const { profile } = useAuth();
  const { current: currentTrack } = usePlayer();
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
  const loadingMore = useRef(false);
  /** Bumps on every fresh load; stale loadMore results get discarded. */
  const fetchSeq = useRef(0);
  const lastLoadAt = useRef(0);

  const isArtist = profile?.role === 'artist';

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
    try {
      const purchased = isArtist
        ? new Set<string>()
        : await fetchMyPurchasedPostIds().catch(() => new Set<string>());
      setPurchasedIds(purchased);
      const fresh = await fetchPosts('all');
      if (seq !== fetchSeq.current) return;
      setPosts(fresh);
      setFeedError(null);
      setEndReached(fresh.length < PAGE_SIZE);

      const ids = fresh.map((p) => p.id);
      const pollIds = fresh.filter((p) => p.kind === 'poll').map((p) => p.id);
      const [summary, pollStates, top] = await Promise.all([
        fetchSocialSummary(ids).catch(() => ({ reactions: {}, commentCounts: {} })),
        fetchPolls(pollIds).catch(() => ({})),
        fetchTopFans().catch(() => []),
      ]);
      setSocial(summary);
      setPolls(pollStates);
      setTopFans(top);

      await resolveMedia(fresh, purchased);
    } catch (e) {
      // Surface feed failures instead of silently showing an empty feed.
      setFeedError((e as { message?: string })?.message ?? 'Could not load the feed.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isArtist, resolveMedia]);

  // Refresh on focus only when something changed (a new post was made)
  // or the data is old - otherwise keep the fan's scroll position.
  useFocusEffect(
    useCallback(() => {
      if (consumeFeedStale() || Date.now() - lastLoadAt.current > 120_000) {
        loadFresh();
      }
    }, [loadFresh])
  );

  async function loadMore() {
    if (loadingMore.current || endReached || posts.length === 0) return;
    loadingMore.current = true;
    const seq = fetchSeq.current;
    try {
      const older = await fetchPosts('all', posts[posts.length - 1].created_at);
      if (seq !== fetchSeq.current) return; // a fresh load replaced the list
      setPosts((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...older.filter((p) => !seen.has(p.id))];
      });
      setEndReached(older.length < PAGE_SIZE);

      const ids = older.map((p) => p.id);
      const pollIds = older.filter((p) => p.kind === 'poll').map((p) => p.id);
      const [summary, pollStates] = await Promise.all([
        fetchSocialSummary(ids).catch(() => ({ reactions: {}, commentCounts: {} })),
        fetchPolls(pollIds).catch(() => ({})),
      ]);
      setSocial((prev) => ({
        reactions: { ...prev.reactions, ...summary.reactions },
        commentCounts: { ...prev.commentCounts, ...summary.commentCounts },
      }));
      setPolls((prev) => ({ ...prev, ...pollStates }));

      await resolveMedia(older, purchasedIds);
    } catch {
      // Network blip - the next scroll retries pagination naturally.
    } finally {
      loadingMore.current = false;
    }
  }

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
          <FlatList
            data={posts}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
            <PostCard
              post={item}
              mediaUrls={mediaUrls}
              viewerIsArtist={isArtist}
              unlocked={purchasedIds.has(item.id)}
              reactions={social.reactions[item.id]}
              commentCount={social.commentCounts[item.id]}
              poll={polls[item.id]}
              onDeleted={loadFresh}
              onUnlocked={() => {
                const next = new Set(purchasedIds).add(item.id);
                setPurchasedIds(next);
                resolveMedia([item], next);
              }}
            />
          )}
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
          ListHeaderComponent={<Top8Card fans={topFans} viewerIsArtist={isArtist} />}
          ListEmptyComponent={
            <EmptyState
              icon="flash-outline"
              title="Nothing dropped yet"
              sub="When the artist posts, it lands here first."
            />
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
            <Pressable onPress={() => router.push('/reports')} hitSlop={12}>
              <Ionicons name="flag-outline" size={21} color="#8f99a3" />
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
            <Ionicons name="settings-outline" size={21} color="#8f99a3" />
          </Pressable>
        </View>
      </View>

      {feedError ? (
        <Text style={[styles.feedError, { top: insets.top + 48 }]}>{feedError}</Text>
      ) : null}

      {profile?.role === 'artist' ? (
        <Pressable
          // Sit above the floating dock — and above the mini player too
          // when a track is loaded.
          style={[styles.fab, { bottom: insets.bottom + 86 + (currentTrack ? 62 : 0) }]}
          onPress={() => router.push('/compose')}>
          <Ionicons name="add" size={30} color="#0b0c0e" />
        </Pressable>
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
