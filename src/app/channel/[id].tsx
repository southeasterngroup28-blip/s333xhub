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
  AppState,
  FlatList,
  Keyboard,
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
import { clockTime, dayKey, separatorLabel } from '@/lib/chat-time';
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
import {
  CHAT_COMPOSER,
  CHAT_HAIRLINE,
  CHAT_HAIRLINE_MINE,
  CHAT_SURFACE,
  CHAT_SURFACE_MINE,
} from '@/constants/chat-surfaces';

// The artist's mark on the name line — the green skull is the one spot of
// colour on the screen, which is exactly why it reads.
const ARTIST_EMBLEM = require('../../../assets/images/emblem-mazze.png');

/**
 * A run: consecutive messages from one person, shown under one name line
 * with the avatar once. A run breaks on a new author, a new day, or a
 * pause longer than this.
 */
const RUN_GAP_MS = 15 * 60 * 1000;

/** A separator chip heads the thread on a new day or after a quiet hour. */
const SEPARATOR_GAP_MS = 60 * 60 * 1000;

type Run = {
  /** The run's first message id — stable while newer messages join it. */
  id: string;
  senderId: string;
  sender: Message['sender'];
  mine: boolean;
  artist: boolean;
  /** Oldest first, so the column reads top to bottom. */
  messages: Message[];
  /** "Today 1:52 PM" chip above the run when the day turns or an hour passed. */
  separator: string | null;
};

/** Groups newest-first messages into newest-first runs (for the inverted list). */
function buildRuns(newestFirst: Message[], myUserId?: string): Run[] {
  const runs: Run[] = [];
  let lastDay = '';
  // Walking from the oldest up, so the chronologically previous message of
  // newestFirst[i] is newestFirst[i + 1] — the one from the last loop turn.
  let prevMs = 0;
  for (let i = newestFirst.length - 1; i >= 0; i--) {
    const m = newestFirst[i];
    const day = dayKey(m.created_at);
    const ms = new Date(m.created_at).getTime();
    const needsSeparator = day !== lastDay || (prevMs > 0 && ms - prevMs >= SEPARATOR_GAP_MS);
    const last = runs[runs.length - 1];
    const joins =
      !needsSeparator && last && last.senderId === m.sender_id && ms - prevMs < RUN_GAP_MS;
    if (joins) {
      last.messages.push(m);
    } else {
      runs.push({
        id: m.id,
        senderId: m.sender_id,
        sender: m.sender,
        mine: m.sender_id === myUserId,
        artist: m.sender?.role === 'artist',
        messages: [m],
        separator: needsSeparator ? separatorLabel(m.created_at) : null,
      });
    }
    lastDay = day;
    prevMs = ms;
  }
  return runs.reverse();
}

export default function ChannelScreen() {
  // `title` is seeded by the list screen so the header never flashes a
  // placeholder; the loaded channel info takes over once it lands.
  const { id, title: titleParam } = useLocalSearchParams<{ id: string; title?: string }>();
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
  /** The one message showing its time under the bubble; a tap elsewhere moves it. */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  /** The composer bar drops its home-indicator padding while the keyboard is up. */
  const [keyboardUp, setKeyboardUp] = useState(false);
  /**
   * The local day the chips were labelled for. "Today" and "Yesterday" go
   * stale if the screen sleeps past midnight; re-keying on wake rebuilds
   * the runs with fresh labels.
   */
  const [todayKey, setTodayKey] = useState(() => dayKey(new Date().toISOString()));
  const loadingMore = useRef(false);
  const listRef = useRef<FlatList<Run>>(null);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardUp(true)
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardUp(false)
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setTodayKey(dayKey(new Date().toISOString()));
    });
    return () => sub.remove();
  }, []);

  /** After a send, slide the inverted list back to the newest message. */
  function scrollToLatest() {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
  }

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
      scrollToLatest();
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
      scrollToLatest();
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
      scrollToLatest();
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
      scrollToLatest();
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
    // todayKey re-runs the relative chip labels after a night in the background.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, blockedIds, myUserId, todayKey]
  );

  // The Anton eyebrow under the title: the room and its size, or the DM.
  const eyebrow = !info
    ? ''
    : isGroup
      ? info.memberCount
        ? `Community · ${info.memberCount}`
        : 'Community'
      : 'Direct message';

  /** Can this message share tightened corners with a neighbour in its run? */
  const chainable = (m: Message) => m.kind === 'text' || m.kind === 'gif' || m.kind === 'image';

  /** One message inside a run: bubble, pill, or hairline tile. */
  function renderMessage(item: Message, run: Run, index: number) {
    // The silver hairline marks the artist to everyone ELSE — their own
    // messages read as "mine" (filled, no visible border) like anyone's.
    const marked = run.artist && !run.mine;
    const longPress = () => {
      // Fans get actions on other people's messages;
      // the artist also gets delete on anything.
      if (!run.mine || isArtist) setActionTarget(item);
    };
    const toggleTime = () => setExpandedId((cur) => (cur === item.id ? null : item.id));
    // iMessage grouping. run.messages is oldest first and each row renders
    // un-flipped, so index 0 is the bubble the fan sees at the TOP of the
    // run: it tightens its bottom corner, the last tightens its top, and
    // the middles tighten both — on the left for theirs, right for mine.
    const prev = run.messages[index - 1];
    const next = run.messages[index + 1];
    const joinTop = !!prev && chainable(prev) && chainable(item);
    const joinBottom = !!next && chainable(next) && chainable(item);
    const joined = run.mine
      ? [joinTop && styles.joinTopR, joinBottom && styles.joinBottomR]
      : [joinTop && styles.joinTopL, joinBottom && styles.joinBottomL];
    if (item.kind === 'gif' && item.media_url) {
      return (
        <Pressable onPress={toggleTime} onLongPress={longPress} delayLongPress={300}>
          <View style={[styles.tile, marked && styles.tileArtist, ...joined]}>
            <Image source={{ uri: item.media_url }} style={styles.gif} contentFit="cover" />
          </View>
        </Pressable>
      );
    }
    if (item.kind === 'image') {
      const url = item.media_path ? mediaUrls[item.media_path] : undefined;
      return (
        <Pressable onPress={toggleTime} onLongPress={longPress} delayLongPress={300}>
          <View style={[styles.tile, marked && styles.tileArtist, ...joined]}>
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
        <Pressable onPress={toggleTime} onLongPress={longPress} delayLongPress={300}>
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
        style={[styles.bubble, run.mine && styles.bubbleMine, marked && styles.bubbleArtist, ...joined]}
        onPress={toggleTime}
        onLongPress={longPress}
        delayLongPress={300}>
        <Text style={[styles.bubbleText, run.mine && styles.bubbleTextMine]}>{item.body}</Text>
      </Pressable>
    );
  }

  function renderRun({ item: run }: { item: Run }) {
    return (
      <View>
        {/* Each row is un-flipped inside the inverted list, so marginTop on
            the chip is the space the fan reads ABOVE it and marginBottom the
            space below, straight reading order. */}
        {run.separator ? (
          <View style={styles.sepChip}>
            <Text style={styles.sepText}>{run.separator}</Text>
          </View>
        ) : null}
        <View style={[styles.run, !run.separator && styles.runGap, run.mine && styles.runMine]}>
          {/* alignItems flex-end on the row seats the avatar beside the run's
              visually-bottom bubble; every bubble shares the column's left
              edge, indented past the avatar by its width + the 8 gap. */}
          {!run.mine ? (
            <Pressable
              onPress={() => showProfile(run.senderId)}
              hitSlop={6}
              // A tapped-open time under the bottom bubble grows the column;
              // lift the avatar past it so it stays seated beside the bubble.
              style={
                expandedId === run.messages[run.messages.length - 1].id
                  ? styles.avatarLift
                  : undefined
              }>
              <Avatar
                path={run.sender?.avatar_path}
                focus={run.sender?.avatar_focus}
                name={run.sender?.display_name}
                size={26}
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
              </View>
            ) : null}
            {run.messages.map((m, i) => (
              <View key={m.id} style={run.mine ? styles.msgWrapMine : styles.msgWrap}>
                {renderMessage(m, run, i)}
                {expandedId === m.id ? (
                  <Text style={styles.msgTime}>{clockTime(m.created_at)}</Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
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
              ref={listRef}
              inverted
              data={runs}
              extraData={expandedId}
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

        {/* A real bar: full width, ruled off on top, running under the home
            indicator. The pill keeps its hairline; the white send (or the
            recording disc) is the only bright thing on it. */}
        <View
          style={[styles.composerBar, { paddingBottom: keyboardUp ? 8 : Math.max(insets.bottom, 8) }]}>
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
              {/* The mic-to-send swap: an empty field offers the voice note,
                  a typed one offers the white send disc. */}
              {sendingMedia ? (
                <View style={styles.send}>
                  <ActivityIndicator color="#000" size="small" />
                </View>
              ) : draft.trim() ? (
                <Pressable
                  style={styles.send}
                  onPress={handleSend}
                  disabled={sending}
                  accessibilityLabel="Send">
                  {sending ? (
                    <ActivityIndicator color="#000" size="small" />
                  ) : (
                    <Ionicons name="arrow-up" size={18} color="#000" />
                  )}
                </Pressable>
              ) : Platform.OS !== 'web' ? (
                <Pressable
                  onPress={startRecording}
                  hitSlop={8}
                  style={styles.pillIcon}
                  accessibilityLabel="Record a voice note">
                  <Ionicons name="mic-outline" size={20} color="#6c7078" />
                </Pressable>
              ) : null}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* The header floats over the thread; messages slide beneath it and
          dissolve in its zone. Only the top edge gets glass — the composer
          is a real bar, not a floating one. */}
      <EdgeGlass bottom={false} />
      <View style={[styles.header, { top: insets.top }]} pointerEvents="box-none">
        {/* The title block spans the full width so the title is truly
            centred; the chevron and the actions float over its ends. The
            block's fixed height reserves the eyebrow's line, so nothing
            jumps when the channel info lands. */}
        <View style={styles.titleBlock} pointerEvents="none">
          <Text style={styles.title} numberOfLines={1}>
            {info?.title ?? titleParam ?? ''}
          </Text>
          <Text style={styles.eyebrow} numberOfLines={1}>
            {eyebrow}
          </Text>
        </View>
        <Pressable onPress={goBack} hitSlop={12} style={styles.back} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
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

const HAIRLINE = CHAT_HAIRLINE;
const SILVER = '#c3cdd6';
const SILVER_LINE = 'rgba(195,205,214,0.6)';
// Translucent charcoal over the photo (see constants/chat-surfaces.ts):
// enough body to read, enough give that the photo shows through. Mine
// sits one shade up so the two sides still read apart.
const SURFACE = CHAT_SURFACE;
const SURFACE_MINE = CHAT_SURFACE_MINE;
// Bare text over the photo: a soft dark shadow keeps it legible on bright frames.
const TEXT_SHADOW = {
  textShadowColor: 'rgba(0,0,0,0.6)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000000' },
  flex: { flex: 1 },

  // ---- floating header ----
  // Fixed height from the first frame: 36 of title block centred in 52.
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 25,
    height: 52,
    justifyContent: 'center',
  },
  back: {
    position: 'absolute',
    left: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  // 21 title + 3 gap + 12 eyebrow = 36, reserved even while both are empty.
  titleBlock: {
    height: 36,
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingHorizontal: 72,
  },
  // Explicit heights: an empty Text collapses to 0, and both lines must
  // hold their box before the data lands so nothing jumps.
  title: {
    color: '#fff',
    fontSize: 17,
    lineHeight: 21,
    height: 21,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 1.5,
  },
  eyebrow: {
    color: SILVER,
    fontSize: 9,
    lineHeight: 12,
    height: 12,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 2.2,
    marginTop: 3,
  },
  actions: {
    position: 'absolute',
    right: 16,
    top: 0,
    bottom: 0,
    flexDirection: 'row',
    gap: 14,
    alignItems: 'center',
  },

  // ---- floating notices under the header ----
  floating: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: CHAT_COMPOSER,
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
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 66, flexGrow: 1 },
  // The separator chip: a quiet centred capsule on the chat surface. A View
  // wraps the Text because iOS does not clip a Text's own background to its
  // radius. Rows render un-flipped, so these margins read 14 above / 8 below.
  sepChip: {
    alignSelf: 'center',
    backgroundColor: SURFACE,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginTop: 14,
    marginBottom: 8,
  },
  sepText: {
    color: '#8a8a92',
    fontSize: 11,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
  },
  run: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  // The open time label's height (14 line + 2 top margin), so the flex-end
  // avatar clears it and keeps hugging the bubble.
  avatarLift: { marginBottom: 16 },
  // 10 between runs; a run headed by a chip takes its spacing from the chip.
  runGap: { marginTop: 10 },
  runMine: { justifyContent: 'flex-end' },
  col: { maxWidth: '80%', gap: 2, alignItems: 'flex-start' },
  colMine: { alignItems: 'flex-end' },
  // Keeps a short bubble from stretching to its tapped-open time label.
  msgWrap: { alignItems: 'flex-start' },
  msgWrapMine: { alignItems: 'flex-end' },
  msgTime: {
    color: '#8a8a92',
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
    marginHorizontal: 4,
    fontVariant: ['tabular-nums'],
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginLeft: 2,
    marginTop: 2,
    marginBottom: 4,
  },
  emblem: { width: 18, height: 14 },
  name: { color: '#8a8a92', fontSize: 12, flexShrink: 1, ...TEXT_SHADOW },
  nameArtist: { color: SILVER, fontWeight: '600' },
  artistTag: {
    color: SILVER,
    fontSize: 9,
    lineHeight: 12,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 2,
    ...TEXT_SHADOW,
  },
  bubble: {
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: 16,
    paddingVertical: 8,
    paddingHorizontal: 13,
    backgroundColor: SURFACE,
  },
  bubbleMine: { backgroundColor: SURFACE_MINE, borderColor: CHAT_HAIRLINE_MINE },
  bubbleArtist: { backgroundColor: SURFACE, borderColor: SILVER_LINE },
  bubbleText: { color: '#e6e8ea', fontSize: 15, lineHeight: 21 },
  bubbleTextMine: { color: '#f2f3f5' },
  // Grouped corners: the edge a bubble shares with its neighbour in the run.
  joinTopL: { borderTopLeftRadius: 6 },
  joinBottomL: { borderBottomLeftRadius: 6 },
  joinTopR: { borderTopRightRadius: 6 },
  joinBottomR: { borderBottomRightRadius: 6 },
  tile: {
    borderWidth: 1,
    borderColor: HAIRLINE,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: SURFACE,
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
    backgroundColor: SURFACE,
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
  // The bar itself; paddingBottom is set inline (home indicator or keyboard).
  composerBar: {
    backgroundColor: 'rgba(5,6,8,0.85)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CHAT_COMPOSER,
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
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
