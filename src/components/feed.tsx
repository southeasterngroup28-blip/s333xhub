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

import { PostCard } from '@/components/post-card';
import { fetchPosts, PAGE_SIZE, signedUrlsFor, type Post } from '@/lib/posts';
import { useAuth } from '@/providers/auth-provider';

export function Feed() {
  const { profile, signOut } = useAuth();
  const router = useRouter();
  const [posts, setPosts] = useState<Post[]>([]);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [endReached, setEndReached] = useState(false);
  const loadingMore = useRef(false);

  const isArtist = profile?.role === 'artist';

  const resolveMedia = useCallback(
    async (batch: Post[]) => {
      // Don't even request viewing links for locked posts unless the viewer
      // is the artist — fans get the lock card instead.
      const visible = isArtist ? batch : batch.filter((p) => !p.is_locked);
      const paths = visible.flatMap((p) => p.post_media.map((m) => m.storage_path));
      if (paths.length === 0) return;
      const urls = await signedUrlsFor(paths);
      setMediaUrls((prev) => ({ ...prev, ...urls }));
    },
    [isArtist]
  );

  const loadFresh = useCallback(async () => {
    try {
      const fresh = await fetchPosts('all');
      setPosts(fresh);
      setEndReached(fresh.length < PAGE_SIZE);
      await resolveMedia(fresh);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [resolveMedia]);

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
      await resolveMedia(older);
    } finally {
      loadingMore.current = false;
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Text style={styles.title}>S333XHUB</Text>
        <Pressable onPress={signOut} hitSlop={12}>
          <Ionicons name="log-out-outline" size={22} color="#666" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <PostCard post={item} mediaUrls={mediaUrls} viewerIsArtist={isArtist} />
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
          <Ionicons name="add" size={30} color="#000" />
        </Pressable>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', letterSpacing: 2 },
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
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
