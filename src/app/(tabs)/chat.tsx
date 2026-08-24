import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fetchChatList, getOrCreateDm, setLeft, type ChatListItem } from '@/lib/chat';
import { useAuth } from '@/providers/auth-provider';

export default function ChatListScreen() {
  const { session, profile } = useAuth();
  const router = useRouter();
  const [items, setItems] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openingDm, setOpeningDm] = useState(false);

  const myUserId = session?.user.id;
  const isArtist = profile?.role === 'artist';
  const hasDm = items.some((item) => item.type === 'dm');

  const load = useCallback(async () => {
    if (!myUserId) return;
    try {
      setItems(await fetchChatList(myUserId));
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not load chats.');
    } finally {
      setLoading(false);
    }
  }, [myUserId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function openItem(item: ChatListItem) {
    if (item.leftAt && myUserId) {
      // Tapping a chat you left rejoins it, then opens it.
      try {
        await setLeft(item.channelId, myUserId, false);
      } catch (e) {
        setError((e as { message?: string })?.message ?? 'Could not rejoin.');
        return;
      }
    }
    router.push(`/channel/${item.channelId}`);
  }

  async function openArtistDm() {
    setOpeningDm(true);
    try {
      const channelId = await getOrCreateDm();
      router.push(`/channel/${channelId}`);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not open the DM.');
    } finally {
      setOpeningDm(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.topBar}>
        <Text style={styles.title}>Chat</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.channelId}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => openItem(item)}>
              <View style={styles.rowIcon}>
                <Ionicons
                  name={item.type === 'group' ? 'people' : 'person'}
                  size={20}
                  color="#fff"
                />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{item.title}</Text>
                {item.leftAt ? (
                  <Text style={styles.rowSub}>You left — tap to rejoin</Text>
                ) : item.type === 'group' ? (
                  <Text style={styles.rowSub}>Everyone's here</Text>
                ) : (
                  <Text style={styles.rowSub}>Direct message</Text>
                )}
              </View>
              {item.mutedAt ? <Ionicons name="notifications-off" size={16} color="#666" /> : null}
              <Ionicons name="chevron-forward" size={18} color="#444" />
            </Pressable>
          )}
          ListFooterComponent={
            // Fans get a way to start their DM with the artist. The artist
            // only sees DMs fans have already started (that's the default
            // while the artist is away — reversible later).
            !isArtist && !hasDm ? (
              <Pressable style={styles.dmButton} onPress={openArtistDm} disabled={openingDm}>
                {openingDm ? (
                  <ActivityIndicator color="#0b0c0e" />
                ) : (
                  <>
                    <Ionicons name="chatbubble-ellipses" size={18} color="#0b0c0e" />
                    <Text style={styles.dmButtonText}>Message the artist</Text>
                  </>
                )}
              </Pressable>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.empty}>No chats yet.</Text>
            </View>
          }
          contentContainerStyle={styles.list}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  topBar: { paddingHorizontal: 16, paddingVertical: 12 },
  title: { color: '#f4f5f6', fontSize: 22, fontFamily: 'Anton_400Regular', letterSpacing: 3 },
  list: { paddingBottom: 32, flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  empty: { color: '#555' },
  error: { color: '#f87171', paddingHorizontal: 16, paddingBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a1d22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1 },
  rowTitle: { color: '#fff', fontSize: 16, fontWeight: '600' },
  rowSub: { color: '#666', fontSize: 13, marginTop: 2 },
  dmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    marginHorizontal: 16,
    marginTop: 20,
    paddingVertical: 13,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  dmButtonText: { color: '#0b0c0e', fontWeight: '700', fontSize: 15 },
});
