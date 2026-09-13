import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
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
import { Avatar } from '@/components/avatar';
import { EdgeGlass, FadeMask } from '@/components/edge-fade';
import { EmptyState } from '@/components/empty-state';
import { Skeleton } from '@/components/skeleton';
import {
  fetchChatList,
  getOrCreateDm,
  setLeft,
  subscribeToChatActivity,
  type ChatListItem,
  type ChatPerson,
} from '@/lib/chat';
import { listTime } from '@/lib/chat-time';
import { fetchBlockedIds } from '@/lib/moderation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';
import { DISPLAY_FONT } from '@/constants/type';
import { CHAT_HAIRLINE_MINE, CHAT_SURFACE_ROW } from '@/constants/chat-surfaces';

// The artist's badge on the DM row — the one spot of colour in the list.
const ARTIST_EMBLEM = require('../../../assets/images/emblem-mazze.png');

/** The preview line: who said the last thing, and what. */
function previewText(item: ChatListItem, myUserId?: string): string {
  if (item.leftAt) return 'You left — tap to rejoin';
  const last = item.lastMessage;
  if (!last) return item.type === 'group' ? "Everyone's here" : 'Direct message';
  const who = last.senderId === myUserId ? 'You' : last.senderName ?? 'Someone';
  const what =
    last.kind === 'gif'
      ? 'GIF'
      : last.kind === 'voice'
        ? 'Voice note'
        : last.kind === 'image'
          ? 'Photo'
          : last.body.replace(/\s+/g, ' ').trim();
  return `${who}: ${what}`;
}

/** Group row: the artist, with the most recent fan tucked at the corner. */
function Cluster({ artist, fan }: { artist: ChatPerson | null; fan: ChatPerson | null }) {
  return (
    <View style={styles.cluster}>
      <View style={styles.clusterBig}>
        <Avatar
          path={artist?.avatar_path}
          focus={artist?.avatar_focus}
          name={artist?.display_name ?? 'S'}
          size={34}
        />
      </View>
      <View style={styles.clusterSmall}>
        <Avatar path={fan?.avatar_path} focus={fan?.avatar_focus} name={fan?.display_name ?? 'F'} size={24} />
      </View>
    </View>
  );
}

/** DM row: the other person; the artist wears the emblem badge. */
function Face({ person }: { person: ChatPerson | null }) {
  return (
    <View style={styles.faceWrap}>
      <Avatar
        path={person?.avatar_path}
        focus={person?.avatar_focus}
        name={person?.display_name ?? '?'}
        size={44}
      />
      {person?.role === 'artist' ? (
        <View style={styles.badge}>
          <Image source={ARTIST_EMBLEM} style={styles.badgeEmblem} contentFit="contain" />
        </View>
      ) : null}
    </View>
  );
}

export default function ChatListScreen() {
  const { session, profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ChatListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingDm, setOpeningDm] = useState(false);
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myUserId = session?.user.id;
  const isArtist = profile?.role === 'artist';
  const hasDm = items.some((item) => item.type === 'dm');

  const load = useCallback(async () => {
    if (!myUserId) return;
    try {
      // My block list first, so nobody I've blocked lands in a preview, a
      // face, or an unread count. Best-effort: a failed lookup falls back
      // to an empty set rather than taking the list down.
      const blockedIds = await fetchBlockedIds().catch(() => new Set<string>());
      setItems(await fetchChatList(myUserId, { previews: true, blockedIds }));
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not load chats.');
    } finally {
      setLoading(false);
    }
  }, [myUserId]);

  // Fresh on every focus, and live while focused: a new message anywhere
  // refreshes the previews and unread counts (lightly debounced — a burst
  // of messages is one reload, not ten).
  useFocusEffect(
    useCallback(() => {
      load();
      const sub = subscribeToChatActivity(() => {
        if (activityTimer.current) clearTimeout(activityTimer.current);
        activityTimer.current = setTimeout(() => load(), 400);
      });
      return () => {
        if (activityTimer.current) clearTimeout(activityTimer.current);
        supabase.removeChannel(sub);
      };
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
    // The title rides along so the channel header never flashes a placeholder.
    router.push({
      pathname: '/channel/[id]',
      params: { id: item.channelId, title: item.title },
    });
  }

  async function openArtistDm() {
    setOpeningDm(true);
    try {
      const channelId = await getOrCreateDm();
      // The DM's title is the artist's name; the group row already knows it.
      // Check the role: if the artist lookup failed, the first face is a
      // fan, and an empty title beats a wrong one.
      const artist = items
        .find((i) => i.type === 'group')
        ?.faces.find((f) => f.role === 'artist');
      router.push({
        pathname: '/channel/[id]',
        params: { id: channelId, title: artist?.display_name ?? '' },
      });
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not open the DM.');
    } finally {
      setOpeningDm(false);
    }
  }

  function renderRow({ item }: { item: ChatListItem }) {
    const other = item.type === 'dm' ? item.faces[0] ?? null : null;
    const withArtist = other?.role === 'artist';
    const unread = !item.leftAt && item.unreadCount > 0;
    return (
      <Pressable style={styles.row} onPress={() => openItem(item)}>
        {item.type === 'group' ? (
          <Cluster
            artist={item.faces[0] ?? null}
            // No fan has spoken yet (or previews failed): the viewer stands
            // in — unless the viewer IS the artist, who'd then appear twice;
            // they get the letter placeholder instead.
            fan={
              item.faces[1] ??
              (profile && profile.role !== 'artist'
                ? {
                    id: profile.id,
                    display_name: profile.display_name,
                    avatar_path: profile.avatar_path,
                    avatar_focus: profile.avatar_focus,
                    role: profile.role,
                  }
                : null)
            }
          />
        ) : (
          <Face person={other} />
        )}
        <View style={styles.rowText}>
          <View style={styles.line1}>
            <Text style={styles.name} numberOfLines={1}>
              {item.title}
            </Text>
            {withArtist ? <Text style={styles.artistTag}>The artist</Text> : null}
            <View style={styles.line1Right}>
              {item.mutedAt ? <Ionicons name="notifications-off" size={13} color="#55555c" /> : null}
              {item.lastMessage ? (
                <Text style={styles.time}>{listTime(item.lastMessage.createdAt)}</Text>
              ) : null}
            </View>
          </View>
          <View style={styles.line2}>
            <Text style={styles.preview} numberOfLines={1}>
              {previewText(item, myUserId)}
            </Text>
            {unread ? (
              <View style={styles.count}>
                <View style={styles.countDot} />
                <Text style={styles.countText}>{item.unreadCount > 99 ? '99+' : item.unreadCount}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBackground />

      {loading ? (
        <View style={styles.list}>
          {[0, 1].map((i) => (
            <View key={i} style={styles.row}>
              <Skeleton width={44} height={44} radius={22} />
              <View style={styles.rowText}>
                <Skeleton width="40%" height={13} />
                <Skeleton width="65%" height={10} style={styles.skeletonGap} />
              </View>
            </View>
          ))}
        </View>
      ) : (
        <FadeMask top={78}>
          <FlatList
            data={items}
            keyExtractor={(item) => item.channelId}
            renderItem={renderRow}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  load().finally(() => setRefreshing(false));
                }}
                tintColor="#fff"
              />
            }
            ListFooterComponent={
              // Fans get a way to start their DM with the artist. The artist
              // only sees DMs fans have already started (that's the default
              // while the artist is away — reversible later).
              !isArtist && !hasDm ? (
                <Pressable style={styles.dmButton} onPress={openArtistDm} disabled={openingDm}>
                  {openingDm ? (
                    <ActivityIndicator color="#000" />
                  ) : (
                    <>
                      <Ionicons name="chatbubble-ellipses" size={18} color="#000" />
                      <Text style={styles.dmButtonText}>Message the artist</Text>
                    </>
                  )}
                </Pressable>
              ) : null
            }
            ListEmptyComponent={
              <EmptyState
                icon="chatbubbles-outline"
                title="No chats yet"
                sub="The community chat appears here."
              />
            }
            contentContainerStyle={styles.list}
          />
        </FadeMask>
      )}

      <EdgeGlass />
      {/* The title block floats over the rows, ruled off beneath like a letterhead. */}
      <View style={[styles.topBar, { top: insets.top }]} pointerEvents="none">
        <Text style={styles.title}>CHAT</Text>
        <View style={styles.titleRule} />
      </View>
      {error ? (
        <Text style={[styles.error, { top: insets.top + 68 }]}>{error}</Text>
      ) : null}
    </SafeAreaView>
  );
}

const SILVER = '#c3cdd6';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 10,
  },
  title: {
    color: '#f4f5f6',
    fontSize: 28,
    lineHeight: 34,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 1.5,
  },
  titleRule: { height: 1, backgroundColor: 'rgba(255,255,255,0.14)', marginTop: 8 },
  list: { paddingHorizontal: 16, paddingTop: 64, paddingBottom: 150, flexGrow: 1 },
  error: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    textAlign: 'center',
    color: '#f87171',
    paddingHorizontal: 16,
    fontSize: 13,
  },

  // ---- rows ----
  // Translucent charcoal cards with a faint edge: readable over the photo,
  // and the photo still shows through (see constants/chat-surfaces.ts).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: CHAT_SURFACE_ROW,
    borderWidth: 1,
    borderColor: CHAT_HAIRLINE_MINE,
    borderRadius: 16,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  rowText: { flex: 1, minWidth: 0 },
  line1: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: '#fff', fontSize: 16, fontWeight: '600', flexShrink: 1 },
  artistTag: {
    color: SILVER,
    fontSize: 9,
    lineHeight: 12,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 2,
  },
  line1Right: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { color: '#55555c', fontSize: 12, fontVariant: ['tabular-nums'] },
  line2: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  preview: { flex: 1, minWidth: 0, color: '#8a8a92', fontSize: 13 },
  count: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  countDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: SILVER },
  countText: {
    color: SILVER,
    fontSize: 13,
    lineHeight: 16,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 0.8,
  },
  skeletonGap: { marginTop: 6 },

  // ---- avatars ----
  cluster: { width: 44, height: 44 },
  clusterBig: { position: 'absolute', left: 0, top: 0 },
  // A 2px black ring separates the fan from the artist behind them.
  clusterSmall: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    borderWidth: 2,
    borderColor: '#000000',
    borderRadius: 14,
  },
  faceWrap: { width: 44, height: 44 },
  badge: {
    position: 'absolute',
    right: -5,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeEmblem: { width: 18, height: 14 },

  // ---- the one white control ----
  dmButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#ffffff',
    marginTop: 24,
    paddingVertical: 13,
    borderRadius: 999,
  },
  dmButtonText: { color: '#000000', fontWeight: '700', fontSize: 15 },
});
