import Ionicons from '@expo/vector-icons/Ionicons';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type AudioRecorder,
} from 'expo-audio';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import Animated, {
  cancelAnimation,
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  useAnimatedKeyboard,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/app-background';
import { Avatar } from '@/components/avatar';
import { EdgeGlass, FadeMask } from '@/components/edge-fade';
import { EmptyState } from '@/components/empty-state';
import { useProfileCard } from '@/components/profile-card';
import { GifPicker } from '@/components/gif-picker';
import { PickPhotosButton, type PickedImageDraft } from '@/components/media-pickers';
import { formatSeconds, UploadShimmer, VoiceNoteBubble } from '@/components/voice-note';
import {
  chatMediaUrls,
  fetchChatList,
  fetchMessages,
  fetchOtherLastReadAt,
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
import { segmentBody } from '@/lib/chat-links';
import { clockTime, dayKey, separatorLabel } from '@/lib/chat-time';
import { GIFS_READY } from '@/lib/gifs';
import { errorFeedback, pressFeedback, selectFeedback, tapFeedback } from '@/lib/haptics';
import {
  blockUser,
  deleteMessage,
  fetchBlockedIds,
  fileReport,
  REPORT_REASONS,
  unblockUser,
} from '@/lib/moderation';
import { cleanMessage } from '@/lib/profanity';
import { supabase } from '@/lib/supabase';
import { useReduceMotion } from '@/lib/use-reduce-motion';
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

/** Render identity: my sends keep their local key through the temp-to-real swap. */
const stableKey = (m: Message) => m.local_key ?? m.id;

type Run = {
  /** The run's first message id — stable while newer messages join it. */
  id: string;
  /** The row's render key: the first message's stable identity, so the
   * FlatList row never remounts when a send's id swaps to the server's. */
  key: string;
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
        key: stableKey(m),
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

// ---- motion ----
// Rows sit inside the inverted list's un-flipping cell, so local +Y is
// visually down: starting at translateY 12 and settling to 0 rises the
// bubble ~12px from the composer side.
const ENTER_MINE = FadeInUp.duration(180).withInitialValues({
  opacity: 0,
  transform: [{ translateY: 12 }],
});
/** Incoming messages just fade in, quietly. */
const ENTER_THEIRS = FadeIn.duration(180);

/** A separator chip opens like a drawer: height and opacity, no jump. */
const chipEnter = (values: EntryAnimationsValues) => {
  'worklet';
  return {
    initialValues: { opacity: 0, height: 0 },
    animations: {
      opacity: withTiming(1, { duration: 180 }),
      height: withTiming(values.targetHeight, { duration: 180 }),
    },
  };
};

/** …and closes the same way when its run leaves (a moderation delete). */
const chipExit = (values: ExitAnimationsValues) => {
  'worklet';
  return {
    initialValues: { opacity: 1, height: values.currentHeight },
    animations: {
      opacity: withTiming(0, { duration: 160 }),
      height: withTiming(0, { duration: 160 }),
    },
  };
};

/** The moderation toolbar fades and settles in from 96%. */
const toolbarEnter = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.96 }] },
    animations: {
      opacity: withTiming(1, { duration: 140 }),
      transform: [{ scale: withTiming(1, { duration: 140 }) }],
    },
  };
};

/**
 * The tap-for-time label under a bubble: a fixed 16px line (14 text + 2
 * margin) that slides open and closed instead of popping the layout.
 */
function TimeLabel({ open, iso }: { open: boolean; iso: string }) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(open ? 1 : 0);
  const text = useMemo(() => clockTime(iso), [iso]);

  useEffect(() => {
    progress.value = reduceMotion ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: 160 });
  }, [open, reduceMotion, progress]);

  const animated = useAnimatedStyle(() => ({
    height: 16 * progress.value,
    opacity: progress.value,
  }));

  return (
    <Animated.View style={[styles.timeClip, animated]}>
      <Text style={styles.msgTime}>{text}</Text>
    </Animated.View>
  );
}

/**
 * Seats the avatar beside the run's bottom bubble. When the time label
 * slides open under that bubble, the avatar rides the same 160ms motion
 * up the label's 16px instead of snapping there in one frame.
 */
function AvatarLift({ lifted, children }: { lifted: boolean; children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  const progress = useSharedValue(lifted ? 1 : 0);

  useEffect(() => {
    progress.value = reduceMotion ? (lifted ? 1 : 0) : withTiming(lifted ? 1 : 0, { duration: 160 });
  }, [lifted, reduceMotion, progress]);

  const animated = useAnimatedStyle(() => ({ marginBottom: 16 * progress.value }));

  return <Animated.View style={animated}>{children}</Animated.View>;
}

/**
 * The live recording readout: a pulsing red dot and elapsed time in the
 * same 0:12 format the sent pill uses. Lives in its own component so its
 * 100ms ticks re-render this row, not the whole thread.
 */
function RecordingRow({ recorder, onLimit }: { recorder: AudioRecorder; onLimit: () => void }) {
  const state = useAudioRecorderState(recorder, 100);
  const reduceMotion = useReduceMotion();
  const pulse = useSharedValue(1);
  const onLimitRef = useRef(onLimit);
  onLimitRef.current = onLimit;

  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 1;
      return;
    }
    // A 1s breath: 500ms down, 500ms back.
    pulse.value = withRepeat(withTiming(0.25, { duration: 500 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [reduceMotion, pulse]);

  const ms = state.durationMillis ?? 0;
  // The cap check rides the same 100ms poll the fan is watching, so the
  // auto-send fires the moment the limit is hit — not half a second later.
  useEffect(() => {
    if (ms >= VOICE_MAX_SECONDS * 1000) onLimitRef.current();
  }, [ms]);

  const dot = useAnimatedStyle(() => ({ opacity: pulse.value }));
  // Clamped: the cap itself is never printed — the note auto-sends first.
  const seconds = Math.min(Math.floor(ms / 1000), VOICE_MAX_SECONDS - 1);

  return (
    <View style={styles.recordingRow}>
      <Animated.View style={[styles.recordingDot, dot]} />
      <Text
        style={[
          styles.recordingTime,
          seconds >= VOICE_MAX_SECONDS - 10 && styles.recordingTimeEnding,
        ]}>
        {formatSeconds(seconds)}
      </Text>
    </View>
  );
}

/** One shimmering bubble shell in the loading ghost thread. */
function GhostBubble({ mine, width }: { mine?: boolean; width: number }) {
  const reduceMotion = useReduceMotion();
  const pulse = useSharedValue(0.55);

  useEffect(() => {
    if (reduceMotion) {
      pulse.value = 0.8;
      return;
    }
    pulse.value = withRepeat(withTiming(1, { duration: 750 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [reduceMotion, pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[styles.ghostBubble, mine && styles.ghostBubbleMine, { width }, animated]}
    />
  );
}

function GhostRun({ width, second, isGroup }: { width: number; second?: number; isGroup: boolean }) {
  return (
    <View style={styles.ghostRow}>
      <View style={styles.ghostAvatar} />
      <View style={styles.ghostCol}>
        {isGroup ? <View style={styles.ghostName} /> : null}
        <GhostBubble width={width} />
        {second ? <GhostBubble width={second} /> : null}
      </View>
    </View>
  );
}

/**
 * The opening state: a bottom-anchored ghost of a conversation instead of
 * a spinner floating on the photo. Crossfades away when the real thread
 * lands.
 */
function GhostThread({ isGroup }: { isGroup: boolean }) {
  return (
    <View style={styles.ghostWrap}>
      <GhostRun width={220} isGroup={isGroup} />
      <View style={styles.ghostMine}>
        <GhostBubble mine width={150} />
      </View>
      <GhostRun width={180} second={120} isGroup={isGroup} />
      <GhostRun width={240} isGroup={isGroup} />
      <View style={styles.ghostMine}>
        <GhostBubble mine width={200} />
      </View>
    </View>
  );
}

type ComposerProps = {
  isArtist: boolean;
  sendingMedia: boolean;
  reduceMotion: boolean;
  onSend: (body: string) => void;
  onOpenGif: () => void;
  onPickPhoto: (image: PickedImageDraft) => void;
  onError: (message: string) => void;
  onStartRecording: () => void;
};

/**
 * The typing pill. Holds the draft itself so every keystroke re-renders
 * this pill, not the whole thread behind it.
 */
function Composer({
  isArtist,
  sendingMedia,
  reduceMotion,
  onSend,
  onOpenGif,
  onPickPhoto,
  onError,
  onStartRecording,
}: ComposerProps) {
  const [draft, setDraft] = useState('');
  const hasText = draft.trim().length > 0;

  function submit() {
    const body = draft.trim();
    if (!body) return;
    tapFeedback();
    // The field clears the instant the send is tapped — the bubble is
    // already on screen by the time the server answers.
    setDraft('');
    onSend(body);
  }

  return (
    <View style={styles.pill}>
      {GIFS_READY ? (
        <Pressable
          onPress={onOpenGif}
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
            if (images[0]) onPickPhoto(images[0]);
          }}
          onError={onError}
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
      {/* The mic-to-send swap: an empty field offers the voice note, a
          typed one offers the white send disc — crossfaded in place. */}
      {hasText || Platform.OS !== 'web' ? (
        <View style={styles.swapSlot}>
          {hasText ? (
            <Animated.View
              key="send"
              style={styles.swapFill}
              entering={reduceMotion ? undefined : FadeIn.duration(120)}
              exiting={reduceMotion ? undefined : FadeOut.duration(120)}>
              <Pressable style={styles.send} onPress={submit} accessibilityLabel="Send">
                <Ionicons name="arrow-up" size={18} color="#000" />
              </Pressable>
            </Animated.View>
          ) : (
            <Animated.View
              key="mic"
              style={styles.swapFill}
              entering={reduceMotion ? undefined : FadeIn.duration(120)}
              exiting={reduceMotion ? undefined : FadeOut.duration(120)}>
              <Pressable
                onPress={onStartRecording}
                hitSlop={8}
                style={styles.pillIcon}
                accessibilityLabel="Record a voice note">
                <Ionicons name="mic-outline" size={20} color="#6c7078" />
              </Pressable>
            </Animated.View>
          )}
        </View>
      ) : null}
    </View>
  );
}

export default function ChannelScreen() {
  // `title` is seeded by the list screen so the header never flashes a
  // placeholder; the loaded channel info takes over once it lands.
  const { id, title: titleParam, type: typeParam } = useLocalSearchParams<{
    id: string;
    title?: string;
    type?: string;
  }>();
  const { session, profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const myUserId = session?.user.id;
  const isArtist = profile?.role === 'artist';
  const { showProfile } = useProfileCard();
  const reduceMotion = useReduceMotion();
  const reduceMotionRef = useRef(false);
  reduceMotionRef.current = reduceMotion;

  const [info, setInfo] = useState<ChatListItem | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  /** A message arrived while I was up in history — the jump-down pill is out. */
  const [newBelow, setNewBelow] = useState(false);
  /** The DM partner's read marker, for the Seen/Sent word (null in the room). */
  const [otherLastReadAt, setOtherLastReadAt] = useState<string | null>(null);
  /**
   * The local day the chips were labelled for. "Today" and "Yesterday" go
   * stale if the screen sleeps past midnight; re-keying on wake rebuilds
   * the runs with fresh labels.
   */
  const [todayKey, setTodayKey] = useState(() => dayKey(new Date().toISOString()));
  const loadingMore = useRef(false);
  const listRef = useRef<FlatList<Run>>(null);

  // Mirrors for callbacks that outlive a render (realtime, scroll).
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const blockedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    blockedIdsRef.current = blockedIds;
  }, [blockedIds]);
  /** Reading history when more than ~120px up from the newest message. */
  const awayRef = useRef(false);
  const newBelowRef = useRef(false);
  const dmRef = useRef(false);

  // ---- optimistic send bookkeeping ----
  /** Ids that arrived THIS session — only these get an entrance animation. */
  const freshIds = useRef(new Set<string>());
  /** Sends still waiting on the server. */
  const inFlightRef = useRef(0);
  /**
   * Our own realtime echoes that raced an in-flight send. Held until EVERY
   * send has settled — the temp-to-real swaps land first — then folded back
   * in (appendNew merges by id, so nothing doubles).
   */
  const heldEchoesRef = useRef<Message[]>([]);
  /** How to re-run each optimistic send, keyed by its local id, for retry. */
  const retryFns = useRef(new Map<string, () => Promise<Message>>());
  /** Local ids with a send in flight right now — a retry tap can't double. */
  const sendingIdsRef = useRef(new Set<string>());
  const tempSeq = useRef(0);

  // The composer bar rides the keyboard frame for frame: closed it clears
  // the home indicator, open it keeps 8px above the keys, and the flex
  // column above (the thread) shrinks with it, so nothing else compensates.
  const keyboard = useAnimatedKeyboard();
  const insetsBottom = insets.bottom;
  const composerPad = useAnimatedStyle(() => {
    const closed = Math.max(insetsBottom, 8);
    return { paddingBottom: Math.max(keyboard.height.value + 8, closed) };
  }, [insetsBottom]);

  /** After a send, slide the inverted list back to the newest message. */
  function scrollToLatest() {
    listRef.current?.scrollToOffset({ offset: 0, animated: !reduceMotionRef.current });
  }

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recordingRef = useRef(false);
  recordingRef.current = recording;
  /** finishRecording runs once per recording, whoever calls it first. */
  const finishingRef = useRef(false);

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

  // New messages arrive via realtime AND from our own sends — dedupe by id
  // and keep newest-first order even when fetches resolve out of order.
  const appendNew = useCallback(
    (incoming: Message, fresh = true) => {
      // `fresh: false` is for held echoes folded back in after a send —
      // their bubble is already on screen, so no second entrance.
      if (fresh && !messagesRef.current.some((m) => m.id === incoming.id)) {
        // Genuinely new this session: entitled to its entrance animation.
        // History pages and refetches never come through here.
        freshIds.current.add(incoming.id);
        setTimeout(() => freshIds.current.delete(incoming.id), 1500);
      }
      setMessages((prev) => {
        if (prev.some((m) => m.id === incoming.id)) {
          // The realtime echo of a row we already hold (our own send,
          // reconciled first): confirm it rather than duplicate it.
          return prev.map((m) =>
            m.id === incoming.id ? { ...m, ...incoming, pending: false, failed: false } : m
          );
        }
        const next = [incoming, ...prev];
        next.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return next;
      });
      resolveChatMedia([incoming]);
    },
    [resolveChatMedia]
  );

  /** Re-reads the DM partner's read marker (no realtime on memberships). */
  const refreshReceipt = useCallback(() => {
    if (!dmRef.current || !id || !myUserId) return;
    fetchOtherLastReadAt(id, myUserId)
      .then((value) => setOtherLastReadAt(value))
      .catch(() => {});
  }, [id, myUserId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setTodayKey(dayKey(new Date().toISOString()));
        refreshReceipt();
      }
    });
    return () => sub.remove();
  }, [refreshReceipt]);

  useEffect(() => {
    if (!id || !myUserId) return;
    let cancelled = false;

    (async () => {
      try {
        const [list, history] = await Promise.all([fetchChatList(myUserId), fetchMessages(id)]);
        if (cancelled) return;
        const item = list.find((entry) => entry.channelId === id) ?? null;
        setInfo(item);
        dmRef.current = item?.type === 'dm';
        setOtherLastReadAt(item?.otherLastReadAt ?? null);
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
      if (message.sender_id === myUserId) {
        // My message committing is the artist's cue to read it — check the
        // marker a beat later so "Seen" lands without waiting for a reply.
        if (dmRef.current) setTimeout(() => refreshReceipt(), 1200);
        if (inFlightRef.current > 0) {
          // Our own echo racing an in-flight send: hold it until EVERY
          // send settles, then fold it in (deduped by id).
          heldEchoesRef.current.push(message);
          return;
        }
        appendNew(message);
        return;
      }
      appendNew(message);
      // A blocked sender's message is invisible (buildRuns drops it), so
      // nothing may move for it: no pill, no read mark, no scroll.
      if (blockedIdsRef.current.has(message.sender_id)) return;
      if (dmRef.current) refreshReceipt();
      if (awayRef.current) {
        // Reading history: never move the list — offer the way down.
        if (!newBelowRef.current) {
          newBelowRef.current = true;
          setNewBelow(true);
        }
        return;
      }
      markRead(id, myUserId).catch(() => {});
      scrollToLatest();
    });

    return () => {
      cancelled = true;
      supabase.removeChannel(sub);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, myUserId, appendNew, resolveChatMedia, refreshReceipt]);

  async function loadOlder() {
    if (loadingMore.current || endReached || messages.length === 0 || !id) return;
    loadingMore.current = true;
    setLoadingOlder(true);
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
      setLoadingOlder(false);
    }
  }

  // ---- optimistic sends ----

  /** A local placeholder row that renders the instant send is tapped. */
  function makeTemp(partial: Partial<Message> & { kind: Message['kind'] }): Message {
    tempSeq.current += 1;
    const localId = `local-${Date.now()}-${tempSeq.current}`;
    // Stamp the temp no earlier than the newest loaded message: a device
    // clock trailing the server must not seat my bubble above newer
    // arrivals, only for it to jump when the server timestamp lands.
    const newest = messagesRef.current[0]?.created_at;
    const stampMs = Math.max(Date.now(), newest ? new Date(newest).getTime() + 1 : 0);
    return {
      id: localId,
      // The render key: survives the temp-to-real id swap, so the bubble
      // never remounts (which would cut its entrance mid-rise).
      local_key: localId,
      channel_id: id ?? '',
      sender_id: myUserId ?? '',
      body: '',
      media_path: null,
      media_url: null,
      duration_seconds: null,
      created_at: new Date(stampMs).toISOString(),
      deleted_at: null,
      sender: profile
        ? {
            display_name: profile.display_name,
            role: profile.role,
            status: profile.status,
            avatar_path: profile.avatar_path,
            avatar_focus: profile.avatar_focus,
          }
        : null,
      pending: true,
      ...partial,
    };
  }

  /**
   * Runs (or re-runs) a send for an existing local bubble. On success the
   * temp swaps for the server row — unless the realtime echo already
   * delivered it, in which case the temp simply retires. On failure the
   * bubble flips to its failed state; no error bar.
   */
  function runSend(tempId: string, make: () => Promise<Message>) {
    inFlightRef.current += 1;
    sendingIdsRef.current.add(tempId);
    make()
      .then((sent) => {
        retryFns.current.delete(tempId);
        setMessages((prev) => {
          const temp = prev.find((m) => m.id === tempId);
          const rest = prev.filter((m) => m.id !== tempId);
          if (rest.some((m) => m.id === sent.id)) {
            // The echo landed first: keep its row, but hand it the temp's
            // render identity and local file so nothing remounts or blinks.
            return rest.map((m) =>
              m.id === sent.id
                ? {
                    ...m,
                    local_key: temp?.local_key ?? tempId,
                    local_uri: m.local_uri ?? temp?.local_uri,
                    pending: false,
                    failed: false,
                  }
                : m
            );
          }
          // Keep the local render key and file so the bubble's identity
          // survives the id swap and media doesn't blink back to a loading
          // tile while the signed URL resolves.
          const merged: Message = {
            ...sent,
            local_key: temp?.local_key ?? tempId,
            local_uri: temp?.local_uri,
          };
          const next = [merged, ...rest];
          next.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
          return next;
        });
        if (sent.media_path) resolveChatMedia([sent]);
      })
      .catch(() => {
        errorFeedback();
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, pending: false, failed: true } : m))
        );
      })
      .finally(() => {
        inFlightRef.current = Math.max(0, inFlightRef.current - 1);
        sendingIdsRef.current.delete(tempId);
        // Echoes are held because SOME send is in flight — flushing while
        // another one still is would seat a real row next to its pending
        // temp. Only the last send home releases them; appendNew merges by
        // id, and `fresh: false` keeps their entrance from replaying.
        if (inFlightRef.current === 0 && heldEchoesRef.current.length > 0) {
          const held = heldEchoesRef.current;
          heldEchoesRef.current = [];
          held.forEach((m) => appendNew(m, false));
        }
      });
  }

  function startSend(temp: Message, make: () => Promise<Message>) {
    retryFns.current.set(temp.id, make);
    appendNew(temp);
    scrollToLatest();
    runSend(temp.id, make);
  }

  function retrySend(item: Message) {
    const make = retryFns.current.get(item.id);
    if (!make) return;
    // A stale double-tap on "Tap to retry" must not fire the send twice —
    // the retry entry only clears on success, so gate on the flight itself.
    if (sendingIdsRef.current.has(item.id)) return;
    tapFeedback();
    setMessages((prev) =>
      prev.map((m) => (m.id === item.id ? { ...m, pending: true, failed: false } : m))
    );
    runSend(item.id, make);
  }

  function handleSendText(body: string) {
    if (!id || !myUserId) return;
    // Mask profanity locally too, so the bubble never changes wording when
    // the server row lands.
    const cleaned = cleanMessage(body);
    if (!cleaned) return;
    const temp = makeTemp({ kind: 'text', body: cleaned });
    startSend(temp, () => sendMessage(id, cleaned));
  }

  function handleSendGif(gifUrl: string) {
    setGifOpen(false);
    if (!id || !myUserId) return;
    const temp = makeTemp({ kind: 'gif', media_url: gifUrl });
    startSend(temp, () => sendGifMessage(id, gifUrl));
  }

  function handleSendPhoto(image: PickedImageDraft) {
    if (!id || !myUserId) return;
    const temp = makeTemp({ kind: 'image', local_uri: image.previewUri });
    const make = async () => {
      setSendingMedia(true);
      try {
        return await sendMediaMessage(id, 'image', image);
      } finally {
        setSendingMedia(false);
      }
    };
    startSend(temp, make);
  }

  /** Puts the phone in recording mode; our music mode is restored after. */
  async function startRecording() {
    if (recording) return;
    setError(null);
    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setError('Microphone access is off. Turn it on in Settings to send voice notes.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      tapFeedback();
      finishingRef.current = false;
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
    // The guard ref, not just state: the cap can fire this from a 100ms
    // tick before the recording flag has re-rendered, and it must not
    // stop-and-send twice.
    if (!recording || finishingRef.current) return;
    finishingRef.current = true;
    setRecording(false);
    tapFeedback();
    // Read the recorder itself at the moment of the stop — no stale poll.
    // Floor, so the pill shows the same number the fan last saw ticking.
    let seconds = 0;
    try {
      seconds = Math.min(
        Math.floor((recorder.getStatus().durationMillis ?? 0) / 1000),
        VOICE_MAX_SECONDS
      );
    } catch {}
    try {
      await recorder.stop();
    } catch {
      // A failed stop means there's nothing usable to send.
      await restorePlaybackMode();
      return;
    }
    await restorePlaybackMode();
    const uri = recorder.uri;
    if (!send || !id || !uri || seconds < 1) return;
    const temp = makeTemp({ kind: 'voice', local_uri: uri, duration_seconds: seconds });
    const make = async () => {
      setSendingMedia(true);
      try {
        return await sendMediaMessage(id, 'voice', { uri, mimeType: 'audio/m4a' }, seconds);
      } finally {
        setSendingMedia(false);
      }
    };
    startSend(temp, make);
  }

  // ---- scroll discipline ----

  function handleScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const away = e.nativeEvent.contentOffset.y > 120;
    awayRef.current = away;
    if (!away && newBelowRef.current) {
      // Back at the bottom: the pill has done its job.
      newBelowRef.current = false;
      setNewBelow(false);
      if (id && myUserId) markRead(id, myUserId).catch(() => {});
    }
  }

  function jumpToNew() {
    selectFeedback();
    newBelowRef.current = false;
    setNewBelow(false);
    scrollToLatest();
    if (id && myUserId) markRead(id, myUserId).catch(() => {});
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

  /** A failed local bubble never reached the server — just let it go. */
  function handleDeleteFailed() {
    if (!actionTarget) return;
    const targetId = actionTarget.id;
    setActionTarget(null);
    retryFns.current.delete(targetId);
    setMessages((prev) => prev.filter((m) => m.id !== targetId));
  }

  // Seeded from the route param (like the title) so the loading ghost can
  // already wear the room's shape before the channel info lands.
  const isGroup = info ? info.type === 'group' : typeParam === 'group';
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

  // Seen/Sent lives under my newest delivered message — DM only. A pending
  // or failed newest message shows its own state instead, so the word
  // stays on the last message the other side could actually have.
  const receipt = useMemo(() => {
    if (info?.type !== 'dm') return null;
    for (const run of runs) {
      if (!run.mine) continue;
      for (let i = run.messages.length - 1; i >= 0; i--) {
        const m = run.messages[i];
        if (m.pending || m.failed) continue;
        const seen =
          !!otherLastReadAt &&
          new Date(otherLastReadAt).getTime() >= new Date(m.created_at).getTime();
        return { id: m.id, seen };
      }
    }
    return null;
  }, [runs, otherLastReadAt, info?.type]);

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
      // Fans get actions on other people's messages; the artist also gets
      // delete on anything; a failed bubble of mine offers local delete.
      if (item.pending) return;
      if (item.failed || !run.mine || isArtist) {
        pressFeedback();
        setActionTarget(item);
      }
    };
    // Expansion tracks the stable render key, so an open time label stays
    // open through a send's temp-to-real id swap.
    const itemKey = stableKey(item);
    const toggleTime = () => setExpandedId((cur) => (cur === itemKey ? null : itemKey));
    // A failed bubble's tap retries; everyone else's tap shows the time.
    const press = item.failed ? () => retrySend(item) : toggleTime;
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
        <Pressable
          onPress={press}
          onLongPress={longPress}
          delayLongPress={300}
          style={item.failed ? styles.dimmed : undefined}>
          <View style={[styles.tile, marked && styles.tileArtist, ...joined]}>
            <Image source={{ uri: item.media_url }} style={styles.gif} contentFit="cover" />
            {item.pending ? <UploadShimmer radius={0} /> : null}
          </View>
        </Pressable>
      );
    }
    if (item.kind === 'image') {
      const url = item.local_uri ?? (item.media_path ? mediaUrls[item.media_path] : undefined);
      return (
        <Pressable
          onPress={press}
          onLongPress={longPress}
          delayLongPress={300}
          style={item.failed ? styles.dimmed : undefined}>
          <View style={[styles.tile, marked && styles.tileArtist, ...joined]}>
            {url ? (
              <Image source={{ uri: url }} style={styles.photo} contentFit="cover" />
            ) : (
              <View style={[styles.photo, styles.mediaLoading]}>
                <ActivityIndicator color="#8a8a92" size="small" />
              </View>
            )}
            {item.pending ? <UploadShimmer radius={0} /> : null}
          </View>
        </Pressable>
      );
    }
    if (item.kind === 'voice') {
      return (
        <Pressable
          onPress={press}
          onLongPress={longPress}
          delayLongPress={300}
          style={item.failed ? styles.dimmed : undefined}>
          <VoiceNoteBubble
            url={item.local_uri ?? (item.media_path ? mediaUrls[item.media_path] : undefined)}
            durationSeconds={item.duration_seconds}
            mine={run.mine}
            artist={marked}
            pending={item.pending}
          />
        </Pressable>
      );
    }
    const segments = segmentBody(item.body);
    const hasLinks = segments.some((s) => s.href);
    return (
      <Pressable
        style={[
          styles.bubble,
          run.mine && styles.bubbleMine,
          marked && styles.bubbleArtist,
          ...joined,
          item.failed && styles.dimmed,
        ]}
        onPress={press}
        onLongPress={longPress}
        delayLongPress={300}>
        <Text style={[styles.bubbleText, run.mine && styles.bubbleTextMine]}>
          {hasLinks
            ? segments.map((seg, i) =>
                seg.href ? (
                  <Text
                    key={i}
                    style={styles.link}
                    accessibilityRole="link"
                    onPress={() => {
                      Linking.openURL(seg.href!).catch(() =>
                        setError("Couldn't open that link.")
                      );
                    }}
                    onLongPress={longPress}>
                    {seg.text}
                  </Text>
                ) : (
                  <Text key={i}>{seg.text}</Text>
                )
              )
            : item.body}
        </Text>
      </Pressable>
    );
  }

  function renderRun({ item: run }: { item: Run }) {
    // Only messages that genuinely arrived this session animate in — never
    // recycled history rows, never a refetch. Checked by the stable render
    // key, which is what freshIds holds for my own sends.
    const runFresh = freshIds.current.has(run.key);
    return (
      <View>
        {/* Each row is un-flipped inside the inverted list, so the chip
            wrapper's paddingTop is the space the fan reads ABOVE it and
            paddingBottom the space below, straight reading order. */}
        {run.separator ? (
          <Animated.View
            entering={runFresh && !reduceMotion ? chipEnter : undefined}
            exiting={reduceMotion ? undefined : chipExit}
            style={styles.sepWrap}>
            <View style={styles.sepChip}>
              <Text style={styles.sepText}>{run.separator}</Text>
            </View>
          </Animated.View>
        ) : null}
        <Animated.View
          entering={runFresh && !reduceMotion ? (run.mine ? ENTER_MINE : ENTER_THEIRS) : undefined}
          style={[styles.run, !run.separator && styles.runGap, run.mine && styles.runMine]}>
          {/* alignItems flex-end on the row seats the avatar beside the run's
              visually-bottom bubble; every bubble shares the column's left
              edge, indented past the avatar by its width + the 8 gap. */}
          {!run.mine ? (
            // A tapped-open time under the bottom bubble grows the column;
            // the avatar rides the label's own 160ms slide up its 16px
            // instead of snapping there in one frame.
            <AvatarLift
              lifted={expandedId === stableKey(run.messages[run.messages.length - 1])}>
              <Pressable onPress={() => showProfile(run.senderId)} hitSlop={6}>
                <Avatar
                  path={run.sender?.avatar_path}
                  focus={run.sender?.avatar_focus}
                  name={run.sender?.display_name}
                  size={26}
                />
              </Pressable>
            </AvatarLift>
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
            {run.messages.map((m, i) => {
              const key = stableKey(m);
              // The run's first message animates with its container; any
              // message joining a still-fresh run later animates on its own
              // key, so rapid bursts don't pop in flat.
              const msgFresh = key !== run.key && freshIds.current.has(key) && !reduceMotion;
              return (
                <Animated.View
                  key={key}
                  entering={msgFresh ? (run.mine ? ENTER_MINE : ENTER_THEIRS) : undefined}
                  style={run.mine ? styles.msgWrapMine : styles.msgWrap}>
                  {renderMessage(m, run, i)}
                  {m.failed ? (
                    <Pressable onPress={() => retrySend(m)} hitSlop={4}>
                      <Text style={styles.failedLine}>Not sent. Tap to retry.</Text>
                    </Pressable>
                  ) : (
                    <TimeLabel open={expandedId === key} iso={m.created_at} />
                  )}
                  {receipt && receipt.id === m.id ? (
                    <Text style={styles.receipt}>{receipt.seen ? 'Seen' : 'Sent'}</Text>
                  ) : null}
                </Animated.View>
              );
            })}
          </View>
        </Animated.View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBackground />

      <View style={styles.flex}>
        <View style={styles.flex}>
          {loading ? (
            <Animated.View
              style={styles.flex}
              exiting={reduceMotion ? undefined : FadeOut.duration(160)}>
              <FadeMask top={64} bottom={10}>
                <GhostThread isGroup={isGroup} />
              </FadeMask>
            </Animated.View>
          ) : (
            <Animated.View
              style={styles.flex}
              entering={reduceMotion ? undefined : FadeIn.duration(220)}>
              <FadeMask top={64} bottom={10}>
                <FlatList
                  ref={listRef}
                  inverted
                  data={runs}
                  extraData={[expandedId, otherLastReadAt, actionTarget, reporting, mediaUrls]}
                  keyExtractor={(run) => run.key}
                  renderItem={renderRun}
                  contentContainerStyle={styles.list}
                  onEndReached={loadOlder}
                  onEndReachedThreshold={0.5}
                  onScroll={handleScroll}
                  scrollEventThrottle={32}
                  keyboardShouldPersistTaps="handled"
                  keyboardDismissMode="on-drag"
                  // Inverted list: "top" is offset 0, the newest message.
                  // Within 120px of it, new arrivals auto-scroll into view;
                  // further up, the reading position holds still.
                  maintainVisibleContentPosition={{
                    minIndexForVisible: 0,
                    autoscrollToTopThreshold: 120,
                  }}
                  ListFooterComponent={
                    loadingOlder && runs.length > 0 ? (
                      <ActivityIndicator size="small" color="#8a8a92" style={styles.olderSpinner} />
                    ) : null
                  }
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
            </Animated.View>
          )}

          {!loading && newBelow ? (
            <Animated.View
              entering={reduceMotion ? undefined : FadeInDown.duration(160)}
              exiting={reduceMotion ? undefined : FadeOutDown.duration(120)}
              style={styles.newPillWrap}
              pointerEvents="box-none">
              <Pressable onPress={jumpToNew} hitSlop={8} style={styles.newPill}>
                <Ionicons name="arrow-down" size={14} color="#e6e8ea" />
                <Text style={styles.newPillText}>New messages</Text>
              </Pressable>
            </Animated.View>
          ) : null}
        </View>

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {actionTarget ? (
          <Animated.View
            entering={reduceMotion ? undefined : toolbarEnter}
            style={styles.actionBar}>
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
            {actionTarget.failed ? (
              <View style={styles.actionRow}>
                <Pressable style={styles.actionChip} onPress={handleDeleteFailed}>
                  <Text style={styles.actionChipDanger}>Delete</Text>
                </Pressable>
              </View>
            ) : reporting ? (
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
          </Animated.View>
        ) : null}

        {/* A real bar: full width, ruled off on top, running under the home
            indicator. Its bottom padding is driven frame-synced by the
            keyboard, so the pill rides up with the keys instead of hopping. */}
        <Animated.View style={[styles.composerBar, composerPad]}>
          {recording ? (
            <View style={styles.pill}>
              <Pressable
                onPress={() => finishRecording(false)}
                hitSlop={10}
                style={styles.pillIcon}
                accessibilityLabel="Discard recording">
                <Ionicons name="trash-outline" size={20} color="#f87171" />
              </Pressable>
              {/* The cap check rides the row's own 100ms poll — the note
                  auto-sends the moment the limit is hit. */}
              <RecordingRow recorder={recorder} onLimit={() => finishRecording(true)} />
              <Pressable
                style={styles.send}
                onPress={() => finishRecording(true)}
                accessibilityLabel="Send voice note">
                <Ionicons name="arrow-up" size={18} color="#000" />
              </Pressable>
            </View>
          ) : (
            <Composer
              isArtist={isArtist}
              sendingMedia={sendingMedia}
              reduceMotion={reduceMotion}
              onSend={handleSendText}
              onOpenGif={() => setGifOpen(true)}
              onPickPhoto={handleSendPhoto}
              onError={setError}
              onStartRecording={startRecording}
            />
          )}
        </Animated.View>
      </View>

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
  centerInverted: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 64,
    transform: [{ scaleY: -1 }], // un-flip inside the inverted list
  },
  // Inverted list: paddingBottom is the VISUAL top (clears the header).
  list: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 66, flexGrow: 1 },
  // In an inverted list the footer is the VISUAL top — where older pages load.
  olderSpinner: { paddingVertical: 12 },
  // The separator chip: a quiet centred capsule on the chat surface. A View
  // wraps the Text because iOS does not clip a Text's own background to its
  // radius. Rows render un-flipped, so the wrapper's padding reads 14 above
  // / 8 below; padding (not margin) so the open animation includes it.
  sepWrap: {
    alignSelf: 'stretch',
    alignItems: 'center',
    overflow: 'hidden',
    paddingTop: 14,
    paddingBottom: 8,
  },
  sepChip: {
    alignSelf: 'center',
    backgroundColor: SURFACE,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sepText: {
    color: '#8a8a92',
    fontSize: 11,
    lineHeight: 14,
    fontVariant: ['tabular-nums'],
  },
  run: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  // 10 between runs; a run headed by a chip takes its spacing from the chip.
  runGap: { marginTop: 10 },
  runMine: { justifyContent: 'flex-end' },
  col: { maxWidth: '80%', gap: 2, alignItems: 'flex-start' },
  colMine: { alignItems: 'flex-end' },
  // Keeps a short bubble from stretching to its tapped-open time label.
  msgWrap: { alignItems: 'flex-start' },
  msgWrapMine: { alignItems: 'flex-end' },
  // The tap-for-time label slides open inside this clip.
  timeClip: { overflow: 'hidden' },
  msgTime: {
    color: '#8a8a92',
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
    marginHorizontal: 4,
    fontVariant: ['tabular-nums'],
  },
  // Seen / Sent under my newest delivered message (DM only).
  receipt: {
    color: '#8a8a92',
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
    marginHorizontal: 4,
  },
  // A failed optimistic send: dimmed bubble, plain-words line beneath.
  dimmed: { opacity: 0.55 },
  failedLine: {
    color: '#f87171',
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
    marginHorizontal: 4,
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
  // Links keep the body colour; the underline is the whole signal.
  link: { textDecorationLine: 'underline' },
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

  // ---- the jump-down pill ----
  newPillWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 12,
    alignItems: 'center',
    zIndex: 5,
  },
  newPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: CHAT_SURFACE,
    borderWidth: 1,
    borderColor: CHAT_HAIRLINE,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  newPillText: { color: '#e6e8ea', fontSize: 12, lineHeight: 16, fontWeight: '600' },

  // ---- the loading ghost thread ----
  ghostWrap: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 12,
  },
  ghostRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  ghostAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: SURFACE },
  ghostCol: { gap: 2, alignItems: 'flex-start' },
  ghostName: {
    width: 72,
    height: 12,
    borderRadius: 6,
    backgroundColor: SURFACE,
    marginLeft: 2,
    marginBottom: 2,
  },
  ghostBubble: { height: 39, borderRadius: 16, backgroundColor: SURFACE },
  ghostBubbleMine: { backgroundColor: SURFACE_MINE },
  ghostMine: { alignItems: 'flex-end' },

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
  // The bar itself; paddingBottom is animated (home indicator or keyboard).
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
  // The fixed slot the mic and the send disc crossfade inside.
  swapSlot: { width: 30, height: 30 },
  swapFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  recordingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#f87171' },
  recordingTime: { color: '#e6e8ea', fontSize: 14, fontVariant: ['tabular-nums'] },
  // The last ten seconds count down in red; the cap itself is never printed.
  recordingTimeEnding: { color: '#f87171' },
  send: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
