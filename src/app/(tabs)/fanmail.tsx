import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from 'expo-router';

import { AppBackground } from '@/components/app-background';
import { EdgeGlass, FadeMask } from '@/components/edge-fade';
import { EmptyState } from '@/components/empty-state';
import { ChatRowSkeleton } from '@/components/skeleton';
import {
  PickAudioButton,
  PickPhotosButton,
  PickVideoButton,
} from '@/components/media-pickers';
import { CHAT_SURFACE } from '@/constants/chat-surfaces';
import { OFFLINE_SUB, RETRY } from '@/constants/copy';
import { clockTime, shortDate, WEEKDAYS } from '@/lib/dates';
import { fanCopy } from '@/lib/fan-error';
import {
  FAN_MAIL_KIND_LABEL,
  fetchMyFanMail,
  nextFanMailAt,
  submitFanMail,
  type FanMailItem,
  type FanMailKind,
} from '@/lib/fanmail';
import { errorFeedback, pressFeedback, successFeedback, tapFeedback } from '@/lib/haptics';
import { timeAgo, UploadCancelledError, type UploadHandle } from '@/lib/posts';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { useAuth } from '@/providers/auth-provider';
import { DISPLAY_FONT } from '@/constants/type';

type Draft = {
  kind: FanMailKind;
  file?: Blob;
  uri?: string;
  mimeType: string;
  name: string;
};

const KIND_ICON: Record<FanMailKind, keyof typeof Ionicons.glyphMap> = {
  picture: 'image',
  video: 'videocam',
  audio: 'musical-notes',
};

export default function FanMailScreen() {
  const { profile } = useAuth();
  const isArtist = profile?.role === 'artist';
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const reduceMotion = useReduceMotion();
  const scrollRef = useRef<ScrollView>(null);

  // Re-tapping the Fan Mail tab scrolls back to the top (switch-to is ignored).
  useEffect(
    () =>
      navigation.addListener('tabPress' as never, (() => {
        if (!navigation.isFocused()) return;
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }) as never),
    [navigation]
  );

  const [items, setItems] = useState<FanMailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  /** 0..1 mirror of the upload for the button label; 1 = record being written. */
  const [sentFraction, setSentFraction] = useState(0);
  /** Transient: a picker or send that failed. Floats, then clears itself. */
  const [error, setError] = useState<string | null>(null);
  /** The list itself could not be fetched - the form must not pretend otherwise. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** True once a fetch has succeeded this session: the cooldown is known. */
  const hasLoaded = useRef(false);
  /** The in-flight phone upload, so the X can call it off. */
  const uploadRef = useRef<UploadHandle | null>(null);
  /**
   * The X was tapped mid-send. Kept as a ref because the handle can arrive
   * AFTER the tap (the send starts with a user lookup before the upload
   * exists), and that late handle must be cancelled on arrival.
   */
  const cancelRequested = useRef(false);
  const [cancelling, setCancelling] = useState(false);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const progress = useSharedValue(0);
  const progressStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (errorTimer.current) clearTimeout(errorTimer.current);
    },
    []
  );

  function flashNotice(text: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), 3000);
  }

  const flashError = useCallback((text: string) => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setError(text);
    errorTimer.current = setTimeout(() => setError(null), 3000);
  }, []);

  const nextAt = nextFanMailAt(items);

  const load = useCallback(async () => {
    if (isArtist) {
      setLoading(false);
      return;
    }
    try {
      setItems(await fetchMyFanMail());
      hasLoaded.current = true;
      // Only a good load clears the error state. Clearing it up front would
      // put the send form back (with no cooldown known) for as long as a
      // refetch from the error state hangs, which is the lie this guards.
      setLoadError(null);
    } catch (e) {
      const message = fanCopy(e, 'Could not load fan mail.');
      if (hasLoaded.current) {
        // The cooldown is already known from a good load: the form stays
        // honest, so this is just a passing red line.
        flashError('Could not refresh. Check your connection.');
      } else {
        setLoadError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [isArtist, flashError]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  /** Hands the send button back: the upload is over, one way or the other. */
  function resetSending() {
    uploadRef.current = null;
    cancelRequested.current = false;
    setCancelling(false);
    setSending(false);
    setSentFraction(0);
    progress.value = 0;
  }

  async function handleSubmit() {
    if (!draft || sending) return;
    pressFeedback();
    cancelRequested.current = false;
    setCancelling(false);
    setSending(true);
    setSentFraction(0);
    progress.value = 0;
    setError(null);
    const sent = draft;
    try {
      const item = await submitFanMail(sent.kind, sent, note, {
        onProgress: (fraction) => {
          // The bar rides every byte event on the UI thread; the label
          // (a React render) only moves when its percent does.
          progress.value = withTiming(fraction, { duration: 200 });
          setSentFraction((prev) =>
            fraction < 1 && Math.round(prev * 100) === Math.round(fraction * 100) ? prev : fraction
          );
        },
        onUpload: (handle) => {
          uploadRef.current = handle;
          // The X landed before the upload existed: call it off right now.
          if (cancelRequested.current) handle.cancel().catch(() => {});
        },
      });
      // Direct submit, not webhook-gated: the buzz is honest here.
      successFeedback();
      // The row is written: the button must stop saying "Delivering" now,
      // not after the list refetch lands.
      resetSending();
      // Seed this week's submission so the cooldown row is right from this
      // render: the card goes draft -> cooldown in one glide instead of
      // showing the attach buttons (briefly tappable) while the list reloads.
      setItems((prev) => [item, ...prev.filter((i) => i.id !== item.id)]);
      setDraft(null);
      setNote('');
      flashNotice('Sent to the artist.');
      // Reconcile quietly: what is on screen is already right, so a blip
      // here is not worth a red line over the success notice.
      fetchMyFanMail()
        .then((fresh) => setItems(fresh))
        .catch(() => {});
    } catch (e) {
      if (e instanceof UploadCancelledError) {
        // The fan called it off with the X - the row goes only now, once
        // the upload has really stopped.
        setDraft(null);
      } else {
        errorFeedback();
        flashError(fanCopy(e, 'Could not send that.'));
      }
    } finally {
      resetSending();
    }
  }

  /**
   * The X on the draft row: clears the pick, or calls off an upload in
   * flight. Mid-send the row stays put until the cancel has actually
   * landed (the catch above clears it), so a "cancelled" send can never
   * quietly finish behind a row that already vanished.
   */
  function clearDraft() {
    tapFeedback();
    if (sending) {
      if (cancelRequested.current) return;
      cancelRequested.current = true;
      setCancelling(true);
      uploadRef.current?.cancel().catch(() => {});
      return;
    }
    setDraft(null);
  }

  function retryLoad() {
    tapFeedback();
    setLoading(true);
    load();
  }

  const layout = reduceMotion ? undefined : LinearTransition.duration(250);
  const rowEnter = reduceMotion ? undefined : FadeIn.duration(220);
  const rowExit = reduceMotion ? undefined : FadeOut.duration(150);

  const sendLabel = cancelling
    ? 'Cancelling…'
    : sentFraction >= 1
      ? 'Delivering…'
      : `Sending ${Math.round(sentFraction * 100)}%`;
  // Once the bytes are up there is nothing left to call off: the record is
  // being written and the X would only lie.
  const canCancel = !sending || (sentFraction < 1 && !cancelling);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBackground />

      {isArtist ? (
        <View style={[styles.list, styles.loadingPad]}>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.kindIcon}>
                <Ionicons name="mail" size={17} color="#c3cdd6" />
              </View>
              <View style={styles.meta}>
                <Text style={styles.sender}>Fan mail goes to your email</Text>
                <Text style={styles.sub}>
                  Nothing shows up in the app. Each one lands in your inbox with the
                  fan&apos;s name, their note and a download link.
                </Text>
              </View>
            </View>
          </View>
        </View>
      ) : loading ? (
        <View style={[styles.list, styles.loadingPad]}>
          <ChatRowSkeleton />
        </View>
      ) : (
        <FadeMask>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.list, styles.loadingPad]}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load().finally(() => setRefreshing(false));
              }}
              tintColor="#fff"
            />
          }>
          {loadError ? (
            // Honest: with no list there is no way to know this week's
            // cooldown, so the send form stays hidden until a load lands.
            <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)}>
              <EmptyState icon="mail-open-outline" title="Couldn't load fan mail" sub={OFFLINE_SUB} />
              <Pressable
                style={({ pressed }) => [styles.openPill, styles.retryPill, pressed && styles.pillPressed]}
                hitSlop={8}
                onPress={retryLoad}
                accessibilityRole="button">
                <Text style={styles.openPillText}>{RETRY}</Text>
              </Pressable>
            </Animated.View>
          ) : (
            <Animated.View style={styles.card} layout={layout}>
              <Text style={styles.pitch}>
                Send him a photo, a video or a beat. It goes to him, nobody else.
              </Text>
              <Text style={styles.price}>Free. One a week.</Text>

              {nextAt ? (
                <Animated.View
                  key="cooldown"
                  style={styles.cooldown}
                  entering={rowEnter}
                  exiting={rowExit}>
                  <Ionicons name="hourglass-outline" size={16} color="#8f99a3" />
                  <Text style={styles.cooldownText}>
                    Sent this week. You can send again {WEEKDAYS[nextAt.getDay()]},{' '}
                    {shortDate(nextAt)} at {clockTime(nextAt.toISOString())}.
                  </Text>
                </Animated.View>
              ) : draft ? (
                <Animated.View
                  key="draft"
                  style={styles.draftRow}
                  entering={rowEnter}
                  exiting={rowExit}>
                  <Ionicons name={KIND_ICON[draft.kind]} size={18} color="#c3cdd6" />
                  <Text style={styles.draftName} numberOfLines={1}>
                    {draft.name}
                  </Text>
                  {/* Stays live mid-send: a fan on cell data is never trapped. */}
                  <Pressable
                    hitSlop={8}
                    onPress={clearDraft}
                    disabled={!canCancel}
                    style={({ pressed }) => [
                      !canCancel && styles.iconDisabled,
                      pressed && styles.iconPressed,
                    ]}
                    accessibilityLabel={sending ? 'Cancel sending' : 'Remove'}>
                    <Ionicons name="close" size={18} color="#8f99a3" />
                  </Pressable>
                </Animated.View>
              ) : (
                <Animated.View
                  key="pick"
                  style={styles.pickRow}
                  entering={rowEnter}
                  exiting={rowExit}>
                  <PickPhotosButton
                    label={FAN_MAIL_KIND_LABEL.picture}
                    maxCount={1}
                    disabled={sending}
                    // Streams from the file path: no base64 copy is ever read.
                    withBase64={false}
                    onPicked={(images) => {
                      const image = images[0];
                      if (!image) return;
                      setDraft({
                        kind: 'picture',
                        file: image.file,
                        uri: image.previewUri,
                        mimeType: image.mimeType,
                        name: 'picture.jpg',
                      });
                    }}
                    onError={flashError}
                  />
                  <PickVideoButton
                    label={FAN_MAIL_KIND_LABEL.video}
                    disabled={sending}
                    onPicked={(video) =>
                      setDraft({
                        kind: 'video',
                        file: video.file,
                        uri: video.uri,
                        mimeType: video.mimeType,
                        name: video.name,
                      })
                    }
                    onError={flashError}
                  />
                  <PickAudioButton
                    label={FAN_MAIL_KIND_LABEL.audio}
                    disabled={sending}
                    onPicked={(audio) =>
                      setDraft({
                        kind: 'audio',
                        file: audio.file,
                        uri: audio.uri,
                        mimeType: audio.mimeType,
                        name: audio.name,
                      })
                    }
                    onError={flashError}
                  />
                </Animated.View>
              )}

              {!nextAt ? (
                <Animated.View key="form" entering={rowEnter} exiting={rowExit}>
                  <TextInput
                    style={styles.noteInput}
                    placeholder="Say something about it…"
                    placeholderTextColor="#55585f"
                    value={note}
                    onChangeText={setNote}
                    maxLength={500}
                    multiline
                  />

                  <Pressable
                    style={({ pressed }) => [
                      styles.sendButton,
                      !draft && styles.sendDisabled,
                      pressed && styles.sendPressed,
                    ]}
                    onPress={handleSubmit}
                    disabled={!draft || sending}>
                    {sending ? (
                      <>
                        <Text style={[styles.sendText, styles.sendTextTabular]}>{sendLabel}</Text>
                        <View style={styles.sendTrack} pointerEvents="none">
                          <Animated.View style={[styles.sendFill, progressStyle]} />
                        </View>
                      </>
                    ) : (
                      <Text style={styles.sendText}>Send to the artist</Text>
                    )}
                  </Pressable>
                </Animated.View>
              ) : null}
            </Animated.View>
          )}

          {!loadError && items.length > 0 ? (
            <Animated.View layout={layout}>
              <Text style={styles.sectionLabel}>SENT</Text>
              {items.map((item) => (
                <Animated.View
                  key={item.id}
                  style={styles.card}
                  entering={reduceMotion ? undefined : FadeInDown.duration(280)}>
                  <View style={styles.row}>
                    <View style={styles.kindIcon}>
                      <Ionicons name={KIND_ICON[item.kind]} size={17} color="#c3cdd6" />
                    </View>
                    <View style={styles.meta}>
                      <Text style={styles.sender}>{FAN_MAIL_KIND_LABEL[item.kind]}</Text>
                      <Text style={styles.sub}>{timeAgo(item.created_at)}</Text>
                    </View>
                  </View>
                </Animated.View>
              ))}
            </Animated.View>
          ) : null}
        </ScrollView>
        </FadeMask>
      )}

      <EdgeGlass />
      <View style={[styles.topBar, { top: insets.top }]} pointerEvents="box-none">
        <Text style={styles.title}>FAN MAIL</Text>
      </View>
      {notice ? (
        <Animated.View
          style={[styles.noticeWrap, { top: insets.top + 48 }]}
          pointerEvents="none"
          entering={reduceMotion ? undefined : FadeInDown.duration(280)}
          exiting={reduceMotion ? undefined : FadeOut.duration(200)}>
          <View style={styles.noticePill}>
            <Text style={styles.notice}>{notice}</Text>
          </View>
        </Animated.View>
      ) : null}
      {error ? (
        <Animated.Text
          style={[styles.error, { top: insets.top + 48 }]}
          entering={reduceMotion ? undefined : FadeIn.duration(150)}
          exiting={reduceMotion ? undefined : FadeOut.duration(150)}>
          {error}
        </Animated.Text>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  title: { color: '#f4f5f6', fontSize: 22, fontFamily: DISPLAY_FONT, letterSpacing: 2 },
  noticeWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  noticePill: {
    backgroundColor: CHAT_SURFACE,
    borderWidth: 1,
    borderColor: 'rgba(79,192,122,0.35)',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  notice: {
    textAlign: 'center',
    color: '#4fc07a',
    fontSize: 13,
  },
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  muted: { color: '#55585f' },
  list: { padding: 14, paddingBottom: 150 },
  loadingPad: { paddingTop: 52 },
  card: {
    backgroundColor: '#131519',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  pitch: { color: '#cbcdd1', fontSize: 14, lineHeight: 21 },
  price: { color: '#c3cdd6', fontSize: 12.5, fontWeight: '600', marginTop: 8 },
  pickRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  cooldown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0f1114',
    borderRadius: 10,
    padding: 13,
    marginTop: 14,
  },
  cooldownText: { color: '#8f99a3', fontSize: 12.5, lineHeight: 18, flex: 1 },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0f1114',
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
  },
  draftName: { color: '#fff', fontSize: 13.5, flex: 1 },
  iconPressed: { opacity: 0.55 },
  iconDisabled: { opacity: 0.3 },
  noteInput: {
    backgroundColor: '#0f1114',
    color: '#fff',
    borderRadius: 10,
    padding: 12,
    fontSize: 13.5,
    marginTop: 10,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  sendButton: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
    overflow: 'hidden',
  },
  sendDisabled: { opacity: 0.4 },
  sendPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  sendText: { color: '#0b0c0e', fontWeight: '700', fontSize: 15 },
  sendTextTabular: { fontVariant: ['tabular-nums'] },
  // The live percent bar along the bottom edge of the white button.
  sendTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(11,12,14,0.12)',
  },
  sendFill: { height: 3, backgroundColor: '#0b0c0e' },
  sectionLabel: {
    color: '#6d7076',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 8,
    marginTop: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kindIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(195, 205, 214, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { flex: 1 },
  sender: { color: '#fff', fontWeight: '600', fontSize: 14 },
  sub: { color: '#6d7076', fontSize: 12, marginTop: 1 },
  openPill: {
    backgroundColor: '#1e2126',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  openPillText: { color: '#c3cdd6', fontWeight: '700', fontSize: 13 },
  retryPill: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 18 },
  pillPressed: { opacity: 0.7 },
  noteText: { color: '#9a9ba3', fontSize: 13, marginTop: 10, fontStyle: 'italic' },
});
