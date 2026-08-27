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
import { SafeAreaView } from 'react-native-safe-area-context';

import { Image } from 'expo-image';

import { PostCard } from '@/components/post-card';
import { Top8Card } from '@/components/top8-card';
import { fetchEffectiveBackgroundUrl } from '@/lib/backgrounds';
import { fetchPosts, PAGE_SIZE, signedUrlsFor, type Post } from '@/lib/posts';
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

export function Feed() {
  const { profile } = useAuth();
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [purchasedIds, setPurchasedIds] = useState<Set<string>>(new Set());
  const [feedError, setFeedError] = useState<string | null>(null);
  const [social, setSocial] = useState<SocialSummary>({ reactions: {}, commentCounts: {} });
  const [polls, setPolls] = useState<Record<string, PollState>>({});
  const [topFans, setTopFans] = useState<TopFan[]>([]);
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [endReached, setEndReached] = useState(false);
  const loadingMore = useRef(false);

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
      if (paths.length === 0) return;
      const urls = await signedUrlsFor(paths);
      setMediaUrls((prev) => ({ ...prev, ...urls }));
    },
    [isArtist]
  );

  const loadFresh = useCallback(async () => {
    try {
      const purchased = isArtist
        ? new Set<string>()
        : await fetchMyPurchasedPostIds().catch(() => new Set<string>());
      setPurchasedIds(purchased);
      const fresh = await fetchPosts('all');
      setPosts(fresh);
      setFeedError(null);
      setEndReached(fresh.length < PAGE_SIZE);

      const ids = fresh.map((p) => p.id);
      const pollIds = fresh.filter((p) => p.kind === 'poll').map((p) => p.id);
      const [summary, pollStates, top, background] = await Promise.all([
        fetchSocialSummary(ids).catch(() => ({ reactions: {}, commentCounts: {} })),
        fetchPolls(pollIds).catch(() => ({})),
        fetchTopFans().catch(() => []),
        profile ? fetchEffectiveBackgroundUrl(profile.id).catch(() => null) : Promise.resolve(null),
      ]);
      setSocial(summary);
      setPolls(pollStates);
      setTopFans(top);
      setBackgroundUrl(background);

      await resolveMedia(fresh, purchased);
    } catch (e) {
      // Surface feed failures instead of silently showing an empty feed.
      setFeedError((e as { message?: string })?.message ?? 'Could not load the feed.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [isArtist, resolveMedia]);

  // Reload when the screen regains focus (e.g. after posting).
  useFocusEffect(
    useCallback(() => {
      loadFresh();
    }, [loadFresh])
  );

  async function loadMore() {
    if (loadingMore.current || endReached || posts.length === 0) return;
    loadingMore.current = true;
    try {
      const older = await fetchPosts('all', posts[posts.length - 1].created_at);
      setPosts((prev) => [...prev, ...older]);
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
    } finally {
      loadingMore.current = false;
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {backgroundUrl ? (
        <>
          <Image
            source={{ uri: backgroundUrl }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={300}
          />
          {/* Dark wash so posts stay readable over any image. */}
          <View style={styles.backgroundScrim} />
        </>
      ) : null}
      <View style={styles.topBar}>
        <Text style={styles.title}>S333XHUB</Text>
        <View style={styles.topActions}>
          {isArtist ? (
            <Pressable onPress={() => router.push('/reports')} hitSlop={12}>
              <Ionicons name="flag-outline" size={21} color="#666" />
            </Pressable>
          ) : null}
          <Pressable onPress={() => router.push('/settings')} hitSlop={12}>
            <Ionicons name="settings-outline" size={21} color="#666" />
          </Pressable>
        </View>
      </View>

      {feedError ? <Text style={styles.feedError}>{feedError}</Text> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
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
            <View style={styles.center}>
              <Text style={styles.empty}>No posts yet.</Text>
            </View>
          }
        />
      )}

      {profile?.role === 'artist' ? (
        <Pressable
          style={styles.fab}
          onPress={() => router.push('/compose')}>
          <Ionicons name="add" size={30} color="#0b0c0e" />
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  backgroundScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(6, 7, 9, 0.6)',
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: {
    color: '#f4f5f6',
    fontSize: 22,
    fontFamily: 'Anton_400Regular',
    letterSpacing: 3,
  },
  topActions: { flexDirection: 'row', gap: 18, alignItems: 'center' },
  feedError: { color: '#f87171', paddingHorizontal: 16, paddingBottom: 8, fontSize: 13 },
  list: { paddingBottom: 96, flexGrow: 1 },
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
