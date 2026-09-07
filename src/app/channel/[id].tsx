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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/app-background';
import { Avatar } from '@/components/avatar';
import { EdgeGlass, FadeMask } from '@/components/edge-fade';
import { EmptyState } from '@/components/empty-state';
import { useProfileCard } from '@/components/profile-card';
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
import { clockTime, dateline, dayKey } from '@/lib/chat-time';
import { GIFS_READY } from '@/lib/gifs';
import {
  blockUser,
  deleteMessage,
  fetchBlockedIds,
  fileReport,
  REPORT_REASONS,
  unblockUser,
} from '@/lib/moderation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';
import { DISPLAY_FONT } from '@/constants/type';

// The artist's mark on the name line — the green skull is the one spot of
// colour on the screen, which is exactly why it reads.
const ARTIST_EMBLEM = require('../../../assets/images/emblem-mazze.png');

/**
 * A run: consecutive messages from one person, shown under one name line
 * with the avatar once. A run breaks on a new author, a new day, or a
 * pause longer than this — so the time on the name line stays honest.
 */
const RUN_GAP_MS = 15 * 60 * 1000;

type Run = {
  /** The run's first message id — stable while newer messages join it. */
  id: string;
  senderId: string;
  sender: Message['sender'];
  mine: boolean;
  artist: boolean;
  /** Oldest first, so the column reads top to bottom. */
  messages: Message[];
  /** Set when this run opens a new day. */
  dateline: string | null;
};

/** Groups newest-first messages into newest-first runs (for the inverted list). */
function buildRuns(newestFirst: Message[], myUserId?: string): Run[] {
  const runs: Run[] = [];
  let lastDay = '';
  for (let i = newestFirst.length - 1; i >= 0; i--) {
    const m = newestFirst[i];
    const day = dayKey(m.created_at);
    const last = runs[runs.length - 1];
    const tail = last?.messages[last.messages.length - 1];
    const joins =
      last &&
      tail &&
      last.senderId === m.sender_id &&
      day === lastDay &&
      new Date(m.created_at).getTime() - new Date(tail.created_at).getTime() < RUN_GAP_MS;
    if (joins) {
      last.messages.push(m);
      continue;
    }
    runs.push({
      id: m.id,
      senderId: m.sender_id,
      sender: m.sender,
      mine: m.sender_id === myUserId,
      artist: m.sender?.role === 'artist',
      messages: [m],
      dateline: day !== lastDay ? dateline(m.created_at) : null,
    });
    lastDay = day;
  }
  return runs.reverse();
}

export default function ChannelScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const myUserId = session?.user.id;
  const isArtist = profile?.role === 'artist';
  const { showProfile } = useProfileCard();

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
  const recordingRef = useRef(false);
  recordingRef.current = recording;

  // Leaving the screen mid-recording must NEVER leave the mic hot or the
  // app stuck in record mode (earpiece audio, held mic session).
  useEffect(() => {
    return () => {
      if (recordingRef.current) {
        try {
          recorder.stop();
        } catch {}
      }
      setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // New messages arrive via realtime AND from our own send — dedupe by id
  // and keep newest-first order even when fetches resolve out of order.
  const appendNew = useCallback(
    (incoming: Message) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) return prev;
        const next = [incoming, ...prev];
        next.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return next;
      });
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
        setMessages((prev) => {
          // Realtime messages that landed while history was loading survive.
          const ids = new Set(history.map((m) => m.id));
          const extras = prev.filter((m) => !ids.has(m.id));
          const merged = [...extras, ...history];
          merged.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
          return merged;
        });
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
      const seen = new Set(messages.map((m) => m.id));
      const fresh = older.filter((m) => !seen.has(m.id));
      setMessages((prev) => [...prev, ...fresh]);
      setEndReached(older.length < MESSAGE_PAGE_SIZE);
      resolveChatMedia(fresh);
      // If this whole page was blocked users, the list didn't visibly grow —
      // keep walking back so history doesn't appear to stop dead.
      if (
        fresh.length > 0 &&
        older.length >= MESSAGE_PAGE_SIZE &&
        fresh.every((m) => blockedIds.has(m.sender_id))
      ) {
        setTimeout(() => loadOlder(), 0);
      }
    } catch {
      // Network blip — the next scroll retries.
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
      // The confirm and the error share the slot under the header.
      setConfirmLeave(false);
      setError((e as { message?: string })?.message ?? 'Could not leave.');
    }
  }

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flashNotice(text: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
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
  const runs = useMemo(
    () =>
      buildRuns(
        messages.filter((m) => !blockedIds.has(m.sender_id)),
        myUserId
      ),
    [messages, blockedIds, myUserId]
  );

  // The Anton eyebrow under the title: the room and its size, or the DM.
  const eyebrow = !info
    ? ''
    : isGroup
      ? info.memberCount
        ? `Community · ${info.memberCount}`
        : 'Community'
      : 'Direct message';

  /** One message inside a run: bubble, pill, or hairline tile. */
  function renderMessage(item: Message, run: Run) {
    // The silver hairline marks the artist to everyone ELSE — their own
    // messages read as "mine" (filled, no visible border) like anyone's.
    const marked = run.artist && !run.mine;
    const longPress = () => {
      // Fans get actions on other people's messages;
      // the artist also gets delete on anything.
      if (!run.mine || isArtist) setActionTarget(item);
    };
    if (item.kind === 'gif' && item.media_url) {
      return (
        <Pressable key={item.id} onLongPress={longPress} delayLongPress={300}>
          <View style={[styles.tile, marked && styles.tileArtist]}>
            <Image source={{ uri: item.media_url }} style={styles.gif} contentFit="cover" />
          </View>
        </Pressable>
      );
    }
    if (item.kind === 'image') {
      const url = item.media_path ? mediaUrls[item.media_path] : undefined;
      return (
        <Pressable key={item.id} onLongPress={longPress} delayLongPress={300}>
          <View style={[styles.tile, marked && styles.tileArtist]}>
            {url ? (
              <Image source={{ uri: url }} style={styles.photo} contentFit="cover" />
            ) : (
              <View style={[styles.photo, styles.mediaLoading]}>
                <ActivityIndicator color="#8a8a92" size="small" />
              </View>
            )}
          </View>
        </Pressable>
      );
    }
    if (item.kind === 'voice') {
      return (
        <Pressable key={item.id} onLongPress={longPress} delayLongPress={300}>
          <VoiceNoteBubble
            url={item.media_path ? mediaUrls[item.media_path] : undefined}
            durationSeconds={item.duration_seconds}
            mine={run.mine}
            artist={marked}
          />
        </Pressable>
      );
    }
    return (
      <Pressable
        key={item.id}
        style={[styles.bubble, run.mine && styles.bubbleMine, marked && styles.bubbleArtist]}
        onLongPress={longPress}
        delayLongPress={300}>
        <Text style={[styles.bubbleText, run.mine && styles.bubbleTextMine]}>{item.body}</Text>
      </Pressable>
    );
  }

  function renderRun({ item: run }: { item: Run }) {
    const first = run.messages[0];
    const last = run.messages[run.messages.length - 1];
    return (
      <View>
        {run.dateline ? <Text style={styles.dateline}>{run.dateline}</Text> : null}
        <View style={[styles.run, run.mine && styles.runMine]}>
          {!run.mine ? (
            <Pressable onPress={() => showProfile(run.senderId)} hitSlop={6} style={styles.avatar}>
              <Avatar
                path={run.sender?.avatar_path}
                focus={run.sender?.avatar_focus}
                name={run.sender?.display_name}
                size={24}
              />
            </Pressable>
          ) : null}
          <View style={[styles.col, run.mine && styles.colMine]}>
            {!run.mine ? (
              <View style={styles.who}>
                {run.artist ? (
                  <Image source={ARTIST_EMBLEM} style={styles.emblem} contentFit="contain" />
                ) : null}
                <Text style={[styles.name, run.artist && styles.nameArtist]} numberOfLines={1}>
                  {run.sender?.display_name ?? 'Deleted user'}
                </Text>
                {run.artist ? <Text style={styles.artistTag}>The artist</Text> : null}
                <Text style={styles.whoTime}>{clockTime(first.created_at)}</Text>
              </View>
            ) : null}
            {run.messages.map((m) => renderMessage(m, run))}
            {run.mine ? <Text style={styles.stamp}>{clockTime(last.created_at)}</Text> : null}
          </View>
        </View>
      </View>
    );
  }

  const composerDisabled = !draft.trim() || sending;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <AppBackground />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : (
          <FadeMask top={64} bottom={10}>
            <FlatList
              inverted
              data={runs}
              keyExtractor={(run) => run.id}
              renderItem={renderRun}
              contentContainerStyle={styles.list}
              onEndReached={loadOlder}
              onEndReachedThreshold={0.5}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <View style={styles.centerInverted}>
                  <EmptyState
                    icon="chatbubbles-outline"
                    title={isGroup ? 'The room is quiet' : 'No messages yet'}
                    sub={isGroup ? 'Say hi to the community.' : 'Start the conversation.'}
                  />
                </View>
              }
            />
          </FadeMask>
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
              <Ionicons name="close" size={18} color="#6c7078" />
            </Pressable>
          </View>
        ) : null}

        {/* One hairline pill: the actions live inside it, and the white
            send is the only bright thing on the bar. */}
        <View style={styles.composerWrap}>
          {recording ? (
            <View style={styles.pill}>
              <Pressable
                onPress={() => finishRecording(false)}
                hitSlop={10}
                style={styles.pillIcon}
                accessibilityLabel="Discard recording">
                <Ionicons name="trash-outline" size={20} color="#f87171" />
              </Pressable>
              <View style={styles.recordingRow}>
                <View style={styles.recordingDot} />
                <Text style={styles.recordingTime}>
                  {Math.floor((recorderState.durationMillis ?? 0) / 1000)}s / {VOICE_MAX_SECONDS}s
                </Text>
              </View>
              <Pressable
                style={styles.send}
                onPress={() => finishRecording(true)}
                accessibilityLabel="Send voice note">
                <Ionicons name="arrow-up" size={18} color="#000" />
              </Pressable>
            </View>
          ) : (
            <View style={styles.pill}>
              {Platform.OS !== 'web' ? (
                <Pressable
                  onPress={startRecording}
                  hitSlop={8}
                  disabled={sendingMedia}
                  style={styles.pillIcon}
                  accessibilityLabel="Record a voice note">
                  <Ionicons name="mic-outline" size={20} color="#6c7078" />
                </Pressable>
              ) : null}
              {GIFS_READY ? (
                <Pressable
                  onPress={() => setGifOpen(true)}
                  hitSlop={8}
                  disabled={sendingMedia}
                  style={styles.pillIcon}
                  accessibilityLabel="Send a GIF">
                  <Text style={styles.gifLabel}>GIF</Text>
                </Pressable>
              ) : null}
              {isArtist ? (
                <PickPhotosButton
                  compact
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
                placeholder="Write something"
                placeholderTextColor="#55555c"
                value={draft}
                onChangeText={setDraft}
                maxLength={MESSAGE_MAX_LENGTH}
                multiline
              />
              {sendingMedia ? (
                <View style={styles.send}>
                  <ActivityIndicator color="#000" size="small" />
                </View>
              ) : (
                <Pressable
                  style={[styles.send, composerDisabled && styles.sendDisabled]}
                  onPress={handleSend}
                  disabled={composerDisabled}
                  accessibilityLabel="Send">
                  {sending ? (
                    <ActivityIndicator color="#000" size="small" />
                  ) : (
                    <Ionicons name="arrow-up" size={18} color="#000" />
                  )}
                </Pressable>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* The header floats over the thread; messages slide beneath it and
          dissolve in its zone. Only the top edge gets glass — the composer
          is a real bar, not a floating one. */}
      <EdgeGlass bottom={false} />
      <View style={[styles.header, { top: insets.top }]} pointerEvents="box-none">
        <Pressable onPress={goBack} hitSlop={12} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <View style={styles.titleBlock} pointerEvents="none">
          <Text style={styles.title} numberOfLines={1}>
            {info?.title ?? 'Chat'}
          </Text>
          {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        </View>
        <View style={styles.actions}>
          <Pressable
            onPress={toggleMute}
            hitSlop={12}
            accessibilityLabel={info?.mutedAt ? 'Unmute' : 'Mute'}>
            <Ionicons
              name={info?.mutedAt ? 'notifications-off' : 'notifications-outline'}
              size={20}
              color={info?.mutedAt ? '#c3cdd6' : '#6c7078'}
            />
          </Pressable>
          {isGroup ? (
            <Pressable onPress={() => setConfirmLeave(true)} hitSlop={12} accessibilityLabel="Leave">
              <Ionicons name="exit-outline" size={20} color="#6c7078" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {confirmLeave ? (
        <View style={[styles.floating, { top: insets.top + 58 }]}>
          <Text style={styles.confirmText}>Leave the community chat?</Text>
          <Pressable onPress={handleLeave} hitSlop={8}>
            <Text style={styles.confirmYes}>Leave</Text>
          </Pressable>
          <Pressable onPress={() => setConfirmLeave(false)} hitSlop={8}>
            <Text style={styles.confirmNo}>Cancel</Text>
          </Pressable>
        </View>
      ) : error ? (
        <View style={[styles.floating, styles.errorBar, { top: insets.top + 58 }]}>
          <Text style={styles.error} numberOfLines={3}>
            {error}
          </Text>
          <Pressable onPress={() => setError(null)} hitSlop={8} accessibilityLabel="Dismiss">
            <Ionicons name="close" size={16} color="#8a8a92" />
          </Pressable>
        </View>
      ) : null}

      <GifPicker visible={gifOpen} onClose={() => setGifOpen(false)} onPick={handleSendGif} />
    </SafeAreaView>
  );
}

const HAIRLINE = 'rgba(255,255,255,0.16)';
const SILVER = '#c3cdd6';
const SILVER_LINE = 'rgba(195,205,214,0.6)';

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  flex: { flex: 1 },

  // ---- floating header ----
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 25,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 6,
    paddingBottom: 10,
  },
  back: { width: 24, alignItems: 'center' },
  titleBlock: { flex: 1, minWidth: 0, alignItems: 'center' },
  title: {
    color: '#fff',
    fontSize: 17,
    lineHeight: 21,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 1.5,
  },
  eyebrow: {
    color: SILVER,
    fontSize: 9,
    lineHeight: 12,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 2.2,
    marginTop: 3,
  },
  actions: { flexDirection: 'row', gap: 14, alignItems: 'center' },

  // ---- floating notices under the header ----
  floating: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(0,0,0,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  confirmText: { color: '#e6e8ea', flex: 1, fontSize: 13 },
  confirmYes: { color: '#f87171', fontWeight: '700', fontSize: 13 },
  confirmNo: { color: '#8a8a92', fontSize: 13 },
  errorBar: { borderColor: 'rgba(248,113,113,0.45)' },
  error: { color: '#f87171', flex: 1, fontSize: 13, lineHeight: 18 },
  notice: { color: '#4fc07a', paddingHorizontal: 16, paddingVertical: 6, fontSize: 13 },

  // ---- thread ----
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerInverted: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    transform: [{ scaleY: -1 }], // un-flip inside the inverted list
  },
  // Inverted list: paddingBottom is the VISUAL top (clears the header).
  list: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 66, flexGrow: 1 },
  dateline: {
    color: '#fff',
    fontSize: 20,
    lineHeight: 24,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 0.8,
    paddingHorizontal: 2,
    paddingBottom: 6,
    marginTop: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.14)',
  },
  run: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 12 },
  runMine: { justifyContent: 'flex-end' },
  avatar: { marginTop: 1 },
  col: { maxWidth: '80%', gap: 3, alignItems: 'flex-start' },
  colMine: { alignItems: 'flex-end' },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginLeft: 2,
    marginTop: 2,
    marginBottom: 4,
  },
  emblem: { width: 18, height: 14 },
  name: { color: '#8a8a92', fontSize: 12, flexShrink: 1 },
  nameArtist: { color: SILVER, fontWeight: '600' },
  artistTag: {
    color: SILVER,
    fontSize: 9,
    lineHeight: 12,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 2,
  },
  whoTime: { color: '#55555c', fontSize: 11, fontVariant: ['tabular-nums'] },
  bubble: {
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 13,
    backgroundColor: 'transparent',
  },
  bubbleMine: { backgroundColor: '#15171a', borderColor: '#15171a' },
  bubbleArtist: { borderColor: SILVER_LINE },
  bubbleText: { color: '#e6e8ea', fontSize: 15, lineHeight: 21 },
  bubbleTextMine: { color: '#f2f3f5' },
  stamp: {
    color: '#55555c',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
    marginHorizontal: 4,
  },
  tile: {
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0a0a0c',
  },
  tileArtist: { borderColor: 'rgba(195,205,214,0.55)' },
  gif: { width: 200, height: 150 },
  photo: { width: 200, height: 200 },
  mediaLoading: { alignItems: 'center', justifyContent: 'center' },

  // ---- moderation bar ----
  actionBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  actionTitle: { color: '#8a8a92', fontSize: 12, marginBottom: 8, paddingRight: 24 },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actionChip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  actionChipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  actionChipDanger: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  actionClose: { position: 'absolute', top: 10, right: 12 },

  // ---- composer ----
  composerWrap: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    paddingLeft: 8,
    paddingRight: 4,
    paddingVertical: 4,
  },
  pillIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  gifLabel: { color: '#6c7078', fontSize: 11, fontWeight: '800', letterSpacing: 0.7 },
  input: {
    flex: 1,
    minWidth: 0,
    color: '#f2f3f5',
    fontSize: 15,
    lineHeight: 20,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 6,
    maxHeight: 110,
  },
  recordingRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#f87171' },
  recordingTime: { color: '#e6e8ea', fontSize: 14, fontVariant: ['tabular-nums'] },
  send: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
});
