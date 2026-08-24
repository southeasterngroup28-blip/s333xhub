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

import {
  fetchChatList,
  fetchMessages,
  markRead,
  MESSAGE_MAX_LENGTH,
  MESSAGE_PAGE_SIZE,
  sendMessage,
  setLeft,
  setMuted,
  subscribeToMessages,
  type ChatListItem,
  type Message,
} from '@/lib/chat';
import {
  blockUser,
  deleteMessage,
  fetchBlockedIds,
  fileReport,
  REPORT_REASONS,
  unblockUser,
} from '@/lib/moderation';
import { timeAgo } from '@/lib/posts';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';

export default function ChannelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const router = useRouter();
  const myUserId = session?.user.id;
  const isArtist = profile?.role === 'artist';

  const [info, setInfo] = useState<ChatListItem | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [endReached, setEndReached] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [blockedIds, setBlockedIds] = useState<Set<string>>(new Set());
  /** The message currently long-pressed, with the moderation bar open. */
  const [actionTarget, setActionTarget] = useState<Message | null>(null);
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const loadingMore = useRef(false);

  // New messages arrive via realtime AND from our own send — dedupe by id.
  const appendNew = useCallback((incoming: Message) => {
    setMessages((prev) =>
      prev.some((m) => m.id === incoming.id) ? prev : [incoming, ...prev]
    );
  }, []);

  useEffect(() => {
    if (!id || !myUserId) return;
    let cancelled = false;

    (async () => {
      try {
        const [list, history] = await Promise.all([fetchChatList(myUserId), fetchMessages(id)]);
        if (cancelled) return;
        setInfo(list.find((item) => item.channelId === id) ?? null);
        setMessages(history);
        setEndReached(history.length < MESSAGE_PAGE_SIZE);
        markRead(id, myUserId).catch(() => {});
        fetchBlockedIds()
          .then((ids) => {
            if (!cancelled) setBlockedIds(ids);
          })
          .catch(() => {});
      } catch (e) {
        if (!cancelled) setError((e as { message?: string })?.message ?? 'Could not load the chat.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const sub = subscribeToMessages(id, (message) => {
      appendNew(message);
      markRead(id, myUserId).catch(() => {});
    });

    return () => {
      cancelled = true;
      supabase.removeChannel(sub);
    };
  }, [id, myUserId, appendNew]);

  async function loadOlder() {
    if (loadingMore.current || endReached || messages.length === 0 || !id) return;
    loadingMore.current = true;
    try {
      const older = await fetchMessages(id, messages[messages.length - 1].created_at);
      setMessages((prev) => [...prev, ...older]);
      setEndReached(older.length < MESSAGE_PAGE_SIZE);
    } finally {
      loadingMore.current = false;
    }
  }

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending || !id) return;
    setSending(true);
    setError(null);
    try {
      const sent = await sendMessage(id, body);
      appendNew(sent);
      setDraft('');
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Message failed to send.');
    } finally {
      setSending(false);
    }
  }

  async function toggleMute() {
    if (!info || !myUserId || !id) return;
    const next = !info.mutedAt;
    setInfo({ ...info, mutedAt: next ? new Date().toISOString() : null });
    try {
      await setMuted(id, myUserId, next);
    } catch (e) {
      setInfo(info); // revert on failure
      setError((e as { message?: string })?.message ?? 'Could not change mute.');
    }
  }

  async function handleLeave() {
    if (!myUserId || !id) return;
    try {
      await setLeft(id, myUserId, true);
      router.back();
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not leave.');
    }
  }

  function flashNotice(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(null), 2500);
  }

  async function handleReport(reason: string) {
    if (!actionTarget) return;
    setReporting(false);
    const target = actionTarget;
    setActionTarget(null);
    try {
      await fileReport('message', target.id, reason);
      flashNotice('Reported. The artist reviews reports within 24 hours.');
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not send the report.');
    }
  }

  async function handleBlockToggle() {
    if (!actionTarget) return;
    const target = actionTarget;
    setActionTarget(null);
    const isBlocked = blockedIds.has(target.sender_id);
    try {
      if (isBlocked) {
        await unblockUser(target.sender_id);
        setBlockedIds((prev) => {
          const next = new Set(prev);
          next.delete(target.sender_id);
          return next;
        });
        flashNotice('Unblocked.');
      } else {
        await blockUser(target.sender_id);
        setBlockedIds((prev) => new Set(prev).add(target.sender_id));
        flashNotice('Blocked. Their messages are hidden from you.');
      }
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not update the block.');
    }
  }

  async function handleDeleteMessage() {
    if (!actionTarget) return;
    const target = actionTarget;
    setActionTarget(null);
    try {
      await deleteMessage(target.id);
      setMessages((prev) => prev.filter((m) => m.id !== target.id));
      flashNotice('Message deleted.');
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not delete the message.');
    }
  }

  const isGroup = info?.type === 'group';
  const visibleMessages = messages.filter((m) => !blockedIds.has(m.sender_id));

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {info?.title ?? 'Chat'}
        </Text>
        <View style={styles.headerActions}>
          <Pressable onPress={toggleMute} hitSlop={12}>
            <Ionicons
              name={info?.mutedAt ? 'notifications-off' : 'notifications-outline'}
              size={20}
              color={info?.mutedAt ? '#fbbf24' : '#999'}
            />
          </Pressable>
          {isGroup ? (
            <Pressable onPress={() => setConfirmLeave(true)} hitSlop={12}>
              <Ionicons name="exit-outline" size={20} color="#999" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {confirmLeave ? (
        <View style={styles.confirmBar}>
          <Text style={styles.confirmText}>Leave the community chat?</Text>
          <Pressable onPress={handleLeave}>
            <Text style={styles.confirmYes}>Leave</Text>
          </Pressable>
          <Pressable onPress={() => setConfirmLeave(false)}>
            <Text style={styles.confirmNo}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : (
          <FlatList
            inverted
            data={visibleMessages}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              const mine = item.sender_id === myUserId;
              return (
                <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                  <Pressable
                    style={[styles.bubble, mine && styles.bubbleMine]}
                    onLongPress={() => {
                      // Fans get actions on other people's messages;
                      // the artist also gets delete on anything.
                      if (!mine || isArtist) setActionTarget(item);
                    }}
                    delayLongPress={300}>
                    {!mine ? (
                      <Text style={styles.senderName}>
                        {item.sender?.display_name ?? 'Deleted user'}
                      </Text>
                    ) : null}
                    <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                      {item.body}
                    </Text>
                    <Text style={[styles.bubbleTime, mine && styles.bubbleTimeMine]}>
                      {timeAgo(item.created_at)}
                    </Text>
                  </Pressable>
                </View>
              );
            }}
            contentContainerStyle={styles.list}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.5}
            ListEmptyComponent={
              <View style={styles.centerInverted}>
                <Text style={styles.empty}>
                  {isGroup ? 'Say hi to the community!' : 'No messages yet.'}
                </Text>
              </View>
            }
          />
        )}

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {actionTarget ? (
          <View style={styles.actionBar}>
            <Text style={styles.actionTitle} numberOfLines={1}>
              {actionTarget.sender?.display_name ?? 'Message'}: “{actionTarget.body}”
            </Text>
            {reporting ? (
              <View style={styles.actionRow}>
                {REPORT_REASONS.map((reason) => (
                  <Pressable key={reason} style={styles.actionChip} onPress={() => handleReport(reason)}>
                    <Text style={styles.actionChipText}>{reason}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.actionRow}>
                {actionTarget.sender_id !== myUserId ? (
                  <>
                    <Pressable style={styles.actionChip} onPress={() => setReporting(true)}>
                      <Text style={styles.actionChipText}>Report</Text>
                    </Pressable>
                    <Pressable style={styles.actionChip} onPress={handleBlockToggle}>
                      <Text style={styles.actionChipText}>
                        {blockedIds.has(actionTarget.sender_id) ? 'Unblock' : 'Block'}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
                {isArtist ? (
                  <Pressable style={styles.actionChip} onPress={handleDeleteMessage}>
                    <Text style={styles.actionChipDanger}>Delete</Text>
                  </Pressable>
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

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Message…"
            placeholderTextColor="#555"
            value={draft}
            onChangeText={setDraft}
            maxLength={MESSAGE_MAX_LENGTH}
            multiline
          />
          <Pressable
            style={[styles.sendButton, (!draft.trim() || sending) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}>
            {sending ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#000" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
  },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700', flex: 1 },
  headerActions: { flexDirection: 'row', gap: 16 },
  confirmBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: '#181818',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  confirmText: { color: '#ccc', flex: 1, fontSize: 13 },
  confirmYes: { color: '#f87171', fontWeight: '700' },
  confirmNo: { color: '#999' },
  error: { color: '#f87171', paddingHorizontal: 16, paddingVertical: 6 },
  notice: { color: '#4fc07a', paddingHorizontal: 16, paddingVertical: 6, fontSize: 13 },
  actionBar: {
    backgroundColor: '#181818',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2a2a',
  },
  actionTitle: { color: '#888', fontSize: 12, marginBottom: 8, paddingRight: 24 },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actionChip: {
    backgroundColor: '#2a2a2a',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionChipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  actionChipDanger: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  actionClose: { position: 'absolute', top: 10, right: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerInverted: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    transform: [{ scaleY: -1 }], // un-flip inside the inverted list
  },
  empty: { color: '#555' },
  list: { paddingHorizontal: 12, paddingVertical: 12, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row', marginVertical: 3 },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  bubbleMine: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 4,
  },
  senderName: { color: '#fbbf24', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  bubbleText: { color: '#fff', fontSize: 15, lineHeight: 20 },
  bubbleTextMine: { color: '#000' },
  bubbleTime: { color: '#555', fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  bubbleTimeMine: { color: '#888' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#222',
  },
  input: {
    flex: 1,
    color: '#fff',
    backgroundColor: '#141414',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
});
