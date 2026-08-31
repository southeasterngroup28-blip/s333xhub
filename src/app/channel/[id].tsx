import Ionicons from '@expo/vector-icons/Ionicons';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { Image } from 'expo-image';
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
import { GifPicker } from '@/components/gif-picker';
import { PickPhotosButton } from '@/components/media-pickers';
import { VoiceNoteBubble } from '@/components/voice-note';
import {
  chatMediaUrls,
  fetchChatList,
  fetchMessages,
  markRead,
  MESSAGE_MAX_LENGTH,
  MESSAGE_PAGE_SIZE,
  sendGifMessage,
  sendMediaMessage,
  sendMessage,
  setLeft,
  setMuted,
  subscribeToMessages,
  VOICE_MAX_SECONDS,
  type ChatListItem,
  type Message,
} from '@/lib/chat';
import { GIFS_READY } from '@/lib/gifs';
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
  const [gifOpen, setGifOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const loadingMore = useRef(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 500);

  /** Voice/photo files need short-lived viewing links. */
  const resolveChatMedia = useCallback(async (batch: Message[]) => {
    const paths = batch.filter((m) => m.media_path).map((m) => m.media_path!);
    if (paths.length === 0) return;
    try {
      const urls = await chatMediaUrls(paths);
      setMediaUrls((prev) => ({ ...prev, ...urls }));
    } catch {
      // Bubbles show a spinner until a retry (scroll/refresh) succeeds.
    }
  }, []);

  // New messages arrive via realtime AND from our own send — dedupe by id.
  const appendNew = useCallback(
    (incoming: Message) => {
      setMessages((prev) =>
        prev.some((m) => m.id === incoming.id) ? prev : [incoming, ...prev]
      );
      resolveChatMedia([incoming]);
    },
    [resolveChatMedia]
  );

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
        resolveChatMedia(history);
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
  }, [id, myUserId, appendNew, resolveChatMedia]);

  async function loadOlder() {
    if (loadingMore.current || endReached || messages.length === 0 || !id) return;
    loadingMore.current = true;
    try {
      const older = await fetchMessages(id, messages[messages.length - 1].created_at);
      setMessages((prev) => [...prev, ...older]);
      setEndReached(older.length < MESSAGE_PAGE_SIZE);
      resolveChatMedia(older);
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

  async function handleSendGif(gifUrl: string) {
    setGifOpen(false);
    if (!id || sendingMedia) return;
    setSendingMedia(true);
    try {
      appendNew(await sendGifMessage(id, gifUrl));
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not send the GIF.');
    } finally {
      setSendingMedia(false);
    }
  }

  async function handleSendPhoto(image: { base64?: string; file?: Blob; mimeType: string }) {
    if (!id || sendingMedia) return;
    setSendingMedia(true);
    try {
      appendNew(await sendMediaMessage(id, 'image', image));
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not send the photo.');
    } finally {
      setSendingMedia(false);
    }
  }

  /** Puts the phone in recording mode; our music mode is restored after. */
  async function startRecording() {
    if (recording || sendingMedia) return;
    setError(null);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone access is off — enable it in Settings to send voice notes.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch (e) {
      await restorePlaybackMode();
      setError((e as { message?: string })?.message ?? 'Could not start recording.');
    }
  }

  async function restorePlaybackMode() {
    await setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {});
  }

  async function finishRecording(send: boolean) {
    if (!recording) return;
    setRecording(false);
    const seconds = Math.round((recorderState.durationMillis ?? 0) / 1000);
    try {
      await recorder.stop();
    } catch {
      // A failed stop means there's nothing usable to send.
      await restorePlaybackMode();
      return;
    }
    await restorePlaybackMode();
    if (!send || !id || !recorder.uri || seconds < 1) return;
    setSendingMedia(true);
    try {
      appendNew(
        await sendMediaMessage(id, 'voice', { uri: recorder.uri, mimeType: 'audio/m4a' }, seconds)
      );
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not send the voice note.');
    } finally {
      setSendingMedia(false);
    }
  }

  // Voice notes cap at VOICE_MAX_SECONDS — auto-send at the limit.
  useEffect(() => {
    if (recording && (recorderState.durationMillis ?? 0) >= VOICE_MAX_SECONDS * 1000) {
      finishRecording(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, recorderState.durationMillis]);

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

  function goBack() {
    // After a page reload there's no history to go "back" to — go home to the
    // chat list instead of throwing a navigation error.
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/chat');
    }
  }

  async function handleLeave() {
    if (!myUserId || !id) return;
    try {
      await setLeft(id, myUserId, true);
      goBack();
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
      <AppBackground />
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12}>
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
              color={info?.mutedAt ? '#c3cdd6' : '#999'}
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
                  {!mine ? (
                    <Avatar
                      path={item.sender?.avatar_path}
                      focus={item.sender?.avatar_focus}
                      name={item.sender?.display_name}
                      size={26}
                    />
                  ) : null}
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
                    {item.kind === 'gif' && item.media_url ? (
                      <Image source={{ uri: item.media_url }} style={styles.gifBubble} contentFit="cover" />
                    ) : item.kind === 'image' ? (
                      item.media_path && mediaUrls[item.media_path] ? (
                        <Image
                          source={{ uri: mediaUrls[item.media_path] }}
                          style={styles.photoBubble}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={[styles.photoBubble, styles.mediaLoading]}>
                          <ActivityIndicator color="#8f99a3" size="small" />
                        </View>
                      )
                    ) : item.kind === 'voice' ? (
                      <VoiceNoteBubble
                        url={item.media_path ? mediaUrls[item.media_path] : undefined}
                        durationSeconds={item.duration_seconds}
                        mine={mine}
                      />
                    ) : (
                      <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>
                        {item.body}
                      </Text>
                    )}
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
              {actionTarget.sender?.display_name ?? 'Message'}:{' '}
              {actionTarget.kind === 'text'
                ? `“${actionTarget.body}”`
                : actionTarget.kind === 'gif'
                  ? 'GIF'
                  : actionTarget.kind === 'voice'
                    ? 'Voice note'
                    : 'Photo'}
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

        {recording ? (
          <View style={styles.composer}>
            <Pressable onPress={() => finishRecording(false)} hitSlop={10} style={styles.mediaButton}>
              <Ionicons name="trash-outline" size={20} color="#f87171" />
            </Pressable>
            <View style={styles.recordingRow}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingTime}>
                {Math.floor((recorderState.durationMillis ?? 0) / 1000)}s / {VOICE_MAX_SECONDS}s
              </Text>
            </View>
            <Pressable style={styles.sendButton} onPress={() => finishRecording(true)}>
              <Ionicons name="arrow-up" size={20} color="#000" />
            </Pressable>
          </View>
        ) : (
          <View style={styles.composer}>
            {GIFS_READY ? (
              <Pressable
                onPress={() => setGifOpen(true)}
                hitSlop={8}
                disabled={sendingMedia}
                style={styles.mediaButton}>
                <Text style={styles.gifButtonText}>GIF</Text>
              </Pressable>
            ) : null}
            {Platform.OS !== 'web' ? (
              <Pressable
                onPress={startRecording}
                hitSlop={8}
                disabled={sendingMedia}
                style={styles.mediaButton}>
                <Ionicons name="mic-outline" size={22} color="#8f99a3" />
              </Pressable>
            ) : null}
            {isArtist ? (
              <PickPhotosButton
                label=""
                maxCount={1}
                disabled={sendingMedia}
                onPicked={(images) => {
                  if (images[0]) handleSendPhoto(images[0]);
                }}
                onError={setError}
              />
            ) : null}
            <TextInput
              style={styles.input}
              placeholder="Message…"
              placeholderTextColor="#555"
              value={draft}
              onChangeText={setDraft}
              maxLength={MESSAGE_MAX_LENGTH}
              multiline
            />
            {sendingMedia ? (
              <View style={styles.sendButton}>
                <ActivityIndicator color="#000" size="small" />
              </View>
            ) : (
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
            )}
          </View>
        )}
      </KeyboardAvoidingView>

      <GifPicker visible={gifOpen} onClose={() => setGifOpen(false)} onPick={handleSendGif} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
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
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    fontFamily: 'Anton_400Regular',
    letterSpacing: 1.5,
    flex: 1,
    textAlign: 'center',
  },
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
  bubbleRow: { flexDirection: 'row', marginVertical: 3, gap: 8, alignItems: 'flex-end' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    backgroundColor: '#22262c',
    borderRadius: 18,
    borderBottomLeftRadius: 5,
    paddingHorizontal: 13,
    paddingVertical: 9,
  },
  bubbleMine: {
    backgroundColor: '#39414c',
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 5,
  },
  senderName: { color: '#c3cdd6', fontSize: 12, fontWeight: '700', marginBottom: 2 },
  bubbleText: { color: '#fff', fontSize: 15, lineHeight: 20 },
  gifBubble: { width: 200, height: 150, borderRadius: 10, backgroundColor: '#14171b' },
  photoBubble: { width: 200, height: 200, borderRadius: 10, backgroundColor: '#14171b' },
  mediaLoading: { alignItems: 'center', justifyContent: 'center' },
  mediaButton: {
    width: 34,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gifButtonText: { color: '#8f99a3', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  recordingRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#f87171' },
  recordingTime: { color: '#fff', fontSize: 14, fontVariant: ['tabular-nums'] },
  bubbleTextMine: { color: '#e6feff' },
  bubbleTime: { color: '#555', fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  bubbleTimeMine: { color: '#8f99a3' },
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
    backgroundColor: '#131519',
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
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonDisabled: { opacity: 0.4 },
});
