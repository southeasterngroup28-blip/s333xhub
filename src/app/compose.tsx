import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
// expo-router does not export usePreventRemove publicly and
// @react-navigation/native is not installed; this is the vendored copy
// expo-router itself runs on. Revisit on an SDK bump.
import { usePreventRemove } from 'expo-router/build/react-navigation/core';
import type { NavigationAction } from 'expo-router/build/react-navigation/routers';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  SafeAreaView as RNSafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  PickAudioButton,
  PickPhotosButton,
  PickVideoButton,
  type PickedImageDraft,
} from '@/components/media-pickers';
import { CHAT_COMPOSER } from '@/constants/chat-surfaces';
import { fanCopy } from '@/lib/fan-error';
import { errorFeedback, pressFeedback, successFeedback, tapFeedback } from '@/lib/haptics';
import {
  createPost,
  markFeedStale,
  titleFromFileName,
  UploadCancelledError,
  type CreatePostOptions,
  type NewPost,
  type PickedAudio,
  type PickedVideo,
  type Project,
  type UploadHandle,
  type UploadProgress,
} from '@/lib/posts';
import { priceLabel } from '@/lib/shop';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { useAuth } from '@/providers/auth-provider';

const MAX_IMAGES = 4;

// Layout-animation builders at module scope: a stable identity lets
// reanimated skip re-registering the config on every re-render.
const ROW_IN = FadeInDown.duration(180);
const ROW_OUT = FadeOut.duration(120);
const ROW_LAYOUT = LinearTransition.duration(180);

// Apple in-app purchases only allow preset price points, so the artist
// picks from these instead of typing a number. Extend the list as needed —
// each one becomes a registered product in App Store Connect at step 7.
const PRICE_OPTIONS = [499, 999, 1499, 1999];

/**
 * Twitter-banner-style framing: the WHOLE image is shown, a bright 16:9
 * window sits over it, everything outside is dimmed, and dragging moves
 * the window. What's inside the window is exactly what the feed shows.
 * Self-contained so dragging re-renders only this widget.
 */
function CoverFramer({
  uri,
  imageWidth,
  imageHeight,
  initialFocus,
  onCommit,
}: {
  uri: string;
  imageWidth: number | null;
  imageHeight: number | null;
  initialFocus: number;
  onCommit: (focus: number) => void;
}) {
  // Deliberate compiler bailout: the window is placed with a setState
  // during render (the rules-of-hooks suppression below). It only mounts
  // inside the framing Modal, and its element is memoised by its parent.
  'use no memo';
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(
    imageWidth && imageHeight ? { w: imageWidth, h: imageHeight } : null
  );
  const [rectY, setRectY] = useState<number | null>(null);
  const rectYRef = useRef(0);
  const dragStartY = useRef(0);
  const maxYRef = useRef(0);

  const displayHeight = layoutWidth && natural ? layoutWidth * (natural.h / natural.w) : 0;
  const rectHeight = layoutWidth * (9 / 16);
  const maxY = Math.max(0, displayHeight - rectHeight);
  maxYRef.current = maxY;

  // Place the window once we know the sizes.
  if (rectY === null && layoutWidth > 0 && natural) {
    const y = initialFocus * maxY;
    rectYRef.current = y;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- simple init, not a hook
    setRectY(y);
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 2,
      onPanResponderGrant: () => {
        dragStartY.current = rectYRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const next = Math.min(maxYRef.current, Math.max(0, dragStartY.current + g.dy));
        rectYRef.current = next;
        setRectY(next);
      },
      onPanResponderRelease: () => {
        onCommit(maxYRef.current > 0 ? rectYRef.current / maxYRef.current : 0.5);
      },
      onPanResponderTerminate: () => {
        onCommit(maxYRef.current > 0 ? rectYRef.current / maxYRef.current : 0.5);
      },
    })
  ).current;

  const y = rectY ?? 0;

  return (
    <View style={framerStyles.block}>
      <View
        style={framerStyles.stage}
        onLayout={(e) => setLayoutWidth(e.nativeEvent.layout.width)}
        {...pan.panHandlers}>
        {layoutWidth > 0 ? (
          <Image
            source={{ uri }}
            style={{ width: layoutWidth, height: displayHeight || rectHeight }}
            contentFit="cover"
            draggable={false}
            onLoad={(e) => {
              if (!natural && e.source?.width && e.source?.height) {
                setNatural({ w: e.source.width, h: e.source.height });
              }
            }}
          />
        ) : null}
        {displayHeight > 0 ? (
          <>
            <View style={[framerStyles.dim, { top: 0, height: y }]} />
            <View style={[framerStyles.window, { top: y, height: rectHeight }]} />
            <View
              style={[framerStyles.dim, { top: y + rectHeight, height: Math.max(0, displayHeight - y - rectHeight) }]}
            />
          </>
        ) : null}
      </View>
      <Text style={framerStyles.hint}>
        {maxY > 0
          ? 'Drag the window. What is inside it is what shows.'
          : 'This image fills the panel exactly'}
      </Text>
    </View>
  );
}

const framerStyles = StyleSheet.create({
  block: { marginTop: 12 },
  stage: { borderRadius: 10, overflow: 'hidden', backgroundColor: '#0f1114' },
  dim: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(6, 7, 9, 0.72)',
  },
  window: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderWidth: 2,
    borderColor: '#ffffff',
    borderRadius: 4,
  },
  remove: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(10, 12, 14, 0.75)',
    borderRadius: 12,
    padding: 5,
  },
  hint: { color: '#6d7076', fontSize: 12, marginTop: 7, textAlign: 'center' },
});

/** Where the media batch stands, for the bar under the top bar and its caption. */
type UploadState = { fileIndex: number; fileCount: number; fraction: number };

/**
 * No byte event for this long means the connection is gone, not slow. The
 * upload runs in a background session that waits for connectivity for
 * days rather than failing, so without this the bar would sit frozen with
 * no way out but a force-quit (which strands a media-less post row).
 */
const STALL_MS = 30_000;

export default function ComposeScreen() {
  const params = useLocalSearchParams<{ project: Project }>();
  const { profile } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const reduceMotion = useReduceMotion();
  const [project, setProject] = useState<Project>(params.project === 's333xgod' ? 's333xgod' : 'mazze');
  const [body, setBody] = useState('');
  const [images, setImages] = useState<PickedImageDraft[]>([]);
  const [audio, setAudio] = useState<PickedAudio | null>(null);
  const [cover, setCover] = useState<PickedImageDraft | null>(null);
  const [coverFocus, setCoverFocus] = useState(0.5);
  const [coverEditorOpen, setCoverEditorOpen] = useState(false);
  const [draftFocus, setDraftFocus] = useState(0.5);
  const coverIsFresh = useRef(false);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [trackTitle, setTrackTitle] = useState('');
  const [locked, setLocked] = useState(false);
  const [priceCents, setPriceCents] = useState<number>(PRICE_OPTIONS[0]);
  const [pollMode, setPollMode] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollHours, setPollHours] = useState<number | null>(24);
  const [posting, setPosting] = useState(false);
  /** Hard re-entrancy guard - two taps in one frame both see posting=false. */
  const postingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  /** Live media upload progress; null for text and poll posts. */
  const [upload, setUpload] = useState<UploadState | null>(null);
  /** The last caption shown, so byte events only re-render when the percent moves. */
  const captionKey = useRef('');
  const progress = useSharedValue(0);
  const progressStyle = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  /** The in-flight file's cancel handle, once its upload task exists. */
  const uploadRef = useRef<UploadHandle | null>(null);
  /** True once a handle exists, so the stall bar can offer a real cancel. */
  const [cancellable, setCancellable] = useState(false);
  /** The bytes stopped moving: the bar says so and offers a way out. */
  const [stalled, setStalled] = useState(false);
  const lastByteAt = useRef(0);
  const stallTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  function startStallWatch() {
    lastByteAt.current = Date.now();
    if (stallTimer.current) clearInterval(stallTimer.current);
    stallTimer.current = setInterval(() => {
      setStalled(Date.now() - lastByteAt.current > STALL_MS);
    }, 2000);
  }

  function stopStallWatch() {
    if (stallTimer.current) clearInterval(stallTimer.current);
    stallTimer.current = null;
    setStalled(false);
  }

  useEffect(
    () => () => {
      if (stallTimer.current) clearInterval(stallTimer.current);
    },
    []
  );

  // ---- leaving with a draft ----
  // The screen is a modal: Cancel, the iOS swipe-down, and Android back all
  // route through beforeRemove, and the vendored hook flips the native
  // stack's preventNativeDismiss so the sheet physically cannot be flicked
  // away mid-upload. `leaving` is React state (not a ref): the hook reads
  // the LAST RENDER's flag, so a same-tick ref flip still gets prevented.
  const dirty = body.trim().length > 0 || images.length > 0 || !!audio || !!video || pollMode;
  const [leaving, setLeaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const pendingAction = useRef<NavigationAction | null>(null);

  usePreventRemove((dirty || posting) && !leaving, ({ data }) => {
    pendingAction.current = data.action;
    setConfirmDiscard(true);
  });

  // Once prevention has dropped (the render with leaving=true is committed),
  // replay the action the fan asked for - or, after a successful post, head
  // back to the feed. useRouter() is the module singleton and the screen's
  // navigation object is stable, so this still fires only when `leaving`
  // flips; the one-shot guard keeps it safe even if an identity ever changes.
  const left = useRef(false);
  useEffect(() => {
    if (!leaving || left.current) return;
    left.current = true;
    const action = pendingAction.current;
    pendingAction.current = null;
    if (action) navigation.dispatch(action);
    else if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [leaving, navigation, router]);

  // A refused dismissal is worth a buzz: the fan tried to leave and could not.
  useEffect(() => {
    if (confirmDiscard) errorFeedback();
  }, [confirmDiscard]);

  // The database blocks non-artists anyway; this is just a friendly guard.
  if (profile?.role !== 'artist') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.empty}>Only the artist can post.</Text>
        </View>
      </SafeAreaView>
    );
  }

  function handlePickedImages(picked: PickedImageDraft[]) {
    setError(null);
    setImages((prev) => [...prev, ...picked].slice(0, MAX_IMAGES));
  }

  function handlePickedAudio(picked: PickedAudio) {
    setError(null);
    setAudio(picked);
    // Pre-fill the title from the file name, minus the extension.
    setTrackTitle(titleFromFileName(picked.name));
  }

  function handlePickedVideo(picked: PickedVideo) {
    setError(null);
    setVideo(picked);
  }

  /** Cancel: with a clean draft this simply leaves; otherwise beforeRemove asks first. */
  function goToFeed() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }

  function discardDraft() {
    tapFeedback();
    setConfirmDiscard(false);
    setLeaving(true);
  }

  function keepDraft() {
    pendingAction.current = null;
    setConfirmDiscard(false);
  }

  /**
   * The way out of a stalled upload: cancels the native task, which makes
   * createPost throw UploadCancelledError and roll the half-made post back.
   * The draft stays on screen for another try.
   */
  function cancelUpload() {
    tapFeedback();
    pendingAction.current = null;
    setConfirmDiscard(false);
    uploadRef.current?.cancel().catch(() => {});
  }

  async function handlePost() {
    setError(null);
    if (postingRef.current) return;
    pressFeedback();
    postingRef.current = true;
    setPosting(true);
    progress.set(0);
    captionKey.current = '';
    // The bar and its caption show from the first frame, with the real
    // file count - createPost refines the byte totals as each one streams.
    const fileCount = pollMode
      ? 0
      : (audio ? 1 + (cover ? 1 : 0) : 0) + (video ? 1 : 0) + images.length;
    if (fileCount > 0) {
      setUpload({ fileIndex: 0, fileCount, fraction: 0 });
      startStallWatch();
    }
    // Everything is built before the `try` and the try is one line: the
    // React Compiler refuses any ternary / ?? / ?. inside a try body, and
    // that would leave this whole screen uncompiled.
    const filledOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
    const input: NewPost = {
      project,
      body,
      images: pollMode ? [] : images,
      audio: pollMode ? null : audio,
      video: pollMode ? null : video,
      cover: pollMode ? null : cover,
      coverFocus,
      title: trackTitle,
      priceCents: locked ? priceCents : null,
      pollOptions: pollMode ? filledOptions : null,
      pollEndsAt: pollMode && pollHours ? new Date(Date.now() + pollHours * 3600000) : null,
    };
    const onProgress: UploadProgress = (bytesSent, totalBytes, fileIndex, fileCount) => {
      lastByteAt.current = Date.now();
      const fraction = totalBytes > 0 ? Math.min(bytesSent / totalBytes, 1) : 0;
      // The bar rides every byte event on the UI thread; the caption
      // (a React render) only moves when its number does.
      progress.set(withTiming(fraction, { duration: 200 }));
      const key = `${fileIndex}/${fileCount}/${Math.round(fraction * 100)}`;
      if (key === captionKey.current) return;
      captionKey.current = key;
      setUpload({ fileIndex, fileCount, fraction });
    };
    const options: CreatePostOptions = {
      onUpload: (handle) => {
        uploadRef.current = handle;
        setCancellable(true);
      },
    };
    let post: Awaited<ReturnType<typeof createPost>> = null;
    try {
      post = await createPost(input, onProgress, options);
    } catch (e) {
      stopStallWatch();
      uploadRef.current = null;
      setCancellable(false);
      setUpload(null);
      progress.set(0);
      setPosting(false);
      postingRef.current = false;
      if (e instanceof UploadCancelledError) {
        // The artist called it off; the post row is already rolled back
        // and the draft is intact. Nothing to apologise for.
        return;
      }
      errorFeedback();
      setError(fanCopy(e, "Couldn't post. Try again."));
      return;
    }
    stopStallWatch();
    successFeedback();
    markFeedStale({ scrollToTop: true, post: post ?? undefined });
    // Drop the guard first; the effect above does the actual leaving once
    // that render has landed (a same-tick back() would still be prevented).
    pendingAction.current = null;
    setLeaving(true);
  }

  const canPost =
    !posting &&
    (pollMode
      ? body.trim().length > 0 && pollOptions.map((o) => o.trim()).filter(Boolean).length >= 2
      : !!audio || !!video || body.trim().length > 0 || images.length > 0);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable
          onPress={goToFeed}
          hitSlop={12}
          style={({ pressed }) => (pressed ? styles.textPressed : undefined)}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.heading}>New post</Text>
        <Pressable
          onPress={handlePost}
          disabled={!canPost}
          hitSlop={12}
          style={({ pressed }) => (pressed ? styles.textPressed : undefined)}>
          {posting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.post, !canPost && styles.postDisabled]}>Post</Text>
          )}
        </Pressable>
        {/* Real byte progress for every media post, photos included. */}
        {upload ? (
          <View style={styles.progressTrack} pointerEvents="none">
            <Animated.View style={[styles.progressFill, progressStyle]} />
          </View>
        ) : null}
      </View>

      {/* The floating confirm bar is positioned inside this wrapper, so it
          hangs 14pt under the top bar whatever the sheet's inset is. (The
          screen is an iOS page sheet: the window's top inset does not apply
          inside it, so the chat's insets.top formula lands too low here.) */}
      <View style={styles.body}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <View style={styles.projectRow}>
          {(['mazze', 's333xgod'] as const).map((p) => (
            <Pressable
              key={p}
              style={({ pressed }) => [
                styles.projectChip,
                project === p && styles.projectChipActive,
                pressed && styles.chipPressed,
              ]}
              onPress={() => {
                tapFeedback();
                setProject(p);
              }}
              disabled={posting}>
              <Text style={[styles.projectChipText, project === p && styles.projectChipTextActive]}>
                {p === 's333xgod' ? 'S333XGOD' : 'MAZZE'}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          style={styles.input}
          placeholder={pollMode ? 'Ask the question…' : 'Say something…'}
          placeholderTextColor="#555"
          multiline
          value={body}
          onChangeText={setBody}
          autoFocus={Platform.OS !== 'web'}
        />

        {pollMode ? (
          <View style={styles.pollBox}>
            {pollOptions.map((option, index) => (
              <TextInput
                key={index}
                style={styles.pollInput}
                placeholder={`Option ${index + 1}`}
                placeholderTextColor="#55585f"
                value={option}
                maxLength={80}
                onChangeText={(text) =>
                  setPollOptions((prev) => prev.map((o, i) => (i === index ? text : o)))
                }
              />
            ))}
            {pollOptions.length < 4 ? (
              <Pressable
                onPress={() => setPollOptions((prev) => [...prev, ''])}
                style={({ pressed }) => [styles.pollAdd, pressed && styles.textPressed]}>
                <Text style={styles.pollAddText}>+ Add option</Text>
              </Pressable>
            ) : null}
            <View style={styles.pollDurationRow}>
              {[
                { label: '1 day', hours: 24 },
                { label: '3 days', hours: 72 },
                { label: '7 days', hours: 168 },
                { label: 'No end', hours: null },
              ].map((choice) => (
                <Pressable
                  key={choice.label}
                  style={({ pressed }) => [
                    styles.durChip,
                    pollHours === choice.hours && styles.durChipActive,
                    pressed && styles.chipPressed,
                  ]}
                  onPress={() => {
                    tapFeedback();
                    setPollHours(choice.hours);
                  }}>
                  <Text
                    style={[styles.durText, pollHours === choice.hours && styles.durTextActive]}>
                    {choice.label}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {images.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
            {images.map((img, index) => (
              <View key={index} style={styles.thumbWrap}>
                <Image source={{ uri: img.previewUri }} style={styles.thumb} contentFit="cover" />
                <Pressable
                  style={styles.thumbRemove}
                  hitSlop={8}
                  onPress={() => setImages((prev) => prev.filter((_, i) => i !== index))}>
                  <Ionicons name="close" size={14} color="#fff" />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        {audio ? (
          <View style={styles.audioBox}>
            <View style={styles.audioRow}>
              <Ionicons name="musical-notes" size={20} color="#fff" />
              <Text style={styles.audioName} numberOfLines={1}>
                {audio.name}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => {
                  setAudio(null);
                  setCover(null);
                  setTrackTitle('');
                }}
                disabled={posting}>
                <Ionicons name="close" size={18} color="#888" />
              </Pressable>
            </View>
            <TextInput
              style={styles.titleInput}
              placeholder="Track title"
              placeholderTextColor="#555"
              value={trackTitle}
              onChangeText={setTrackTitle}
            />
            {cover ? (
              <View style={styles.coverBlock}>
                <View style={styles.coverPreview}>
                  <Image
                    source={{ uri: cover.previewUri }}
                    style={StyleSheet.absoluteFill}
                    contentFit="cover"
                    contentPosition={{ left: '50%', top: `${coverFocus * 100}%` }}
                  />
                </View>
                <View style={styles.coverActions}>
                  <Pressable
                    style={styles.coverAction}
                    onPress={() => {
                      coverIsFresh.current = false;
                      setDraftFocus(coverFocus);
                      setCoverEditorOpen(true);
                    }}
                    disabled={posting}>
                    <Ionicons name="crop" size={15} color="#c3cdd6" />
                    <Text style={styles.coverActionText}>Adjust framing</Text>
                  </Pressable>
                  <Pressable
                    style={styles.coverAction}
                    onPress={() => setCover(null)}
                    disabled={posting}>
                    <Ionicons name="trash-outline" size={15} color="#9a9ba3" />
                    <Text style={styles.coverActionText}>Remove</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.coverRow}>
                <PickPhotosButton
                  label="Add cover"
                  maxCount={1}
                  disabled={posting}
                  withBase64={false}
                  onPicked={(picked) => {
                    if (!picked[0]) return;
                    setCover(picked[0]);
                    setCoverFocus(0.5);
                    setDraftFocus(0.5);
                    coverIsFresh.current = true;
                    setCoverEditorOpen(true);
                  }}
                  onError={setError}
                />
              </View>
            )}
          </View>
        ) : null}

        {video ? (
          <View style={styles.audioBox}>
            <View style={styles.audioRow}>
              <Ionicons name="videocam" size={20} color="#fff" />
              <Text style={styles.audioName} numberOfLines={1}>
                {video.name} · {Math.round(video.durationSeconds)}s
              </Text>
              <Pressable hitSlop={8} onPress={() => setVideo(null)} disabled={posting}>
                <Ionicons name="close" size={18} color="#888" />
              </Pressable>
            </View>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [
            styles.pollToggle,
            pollMode && styles.pollToggleOn,
            pressed && styles.chipPressed,
          ]}
          onPress={() => {
            tapFeedback();
            setPollMode(!pollMode);
          }}
          disabled={posting || !!audio || !!video || images.length > 0}>
          <Ionicons name="stats-chart" size={16} color={pollMode ? '#0b0c0e' : '#9a9ba3'} />
          <Text style={[styles.pollToggleText, pollMode && styles.pollToggleTextOn]}>
            {pollMode ? 'Poll post. Tap to cancel' : 'Make this a poll'}
          </Text>
        </Pressable>

        {pollMode ? null : (
        <View style={styles.attachRow}>
          <PickPhotosButton
            label={images.length === 0 ? 'Photos' : `Photos (${images.length}/${MAX_IMAGES})`}
            maxCount={MAX_IMAGES - images.length}
            disabled={images.length >= MAX_IMAGES || !!audio || !!video || posting}
            // Streams from the file path: no base64 copy is ever read.
            withBase64={false}
            onPicked={handlePickedImages}
            onError={setError}
          />
          <PickAudioButton
            label={audio ? 'Track attached' : 'Audio'}
            disabled={images.length > 0 || !!audio || !!video || posting}
            onPicked={handlePickedAudio}
            onError={setError}
          />
          <PickVideoButton
            label={video ? 'Video attached' : 'Video (45s max)'}
            disabled={images.length > 0 || !!audio || !!video || posting}
            onPicked={handlePickedVideo}
            onError={setError}
          />
        </View>
        )}

        <View style={styles.lockBox}>
          <Pressable
            style={({ pressed }) => [styles.lockRow, pressed && styles.rowPressed]}
            onPress={() => {
              tapFeedback();
              setLocked(!locked);
            }}
            disabled={posting}
            accessibilityRole="switch"
            accessibilityState={{ checked: locked, disabled: posting }}>
            <Ionicons
              name={locked ? 'lock-closed' : 'lock-open-outline'}
              size={20}
              color={locked ? '#c3cdd6' : '#888'}
            />
            <View style={styles.lockMeta}>
              <Text style={styles.lockTitle}>{locked ? 'Locked post' : 'Free post'}</Text>
              <Text style={styles.lockHint}>
                {locked
                  ? 'Fans pay once to unlock this post forever.'
                  : 'Tap to make this a paid unlock.'}
              </Text>
            </View>
            {/* The real thing, same look as the switches in Settings. It
                only shows the state: on iOS a UISwitch inside a Pressable
                gets the touch too, so letting it toggle as well would
                fire two haptics. The row is the one control. */}
            <Switch
              value={locked}
              pointerEvents="none"
              disabled={posting}
              trackColor={{ false: '#333', true: '#c3cdd6' }}
              thumbColor={locked ? '#0b0c0e' : '#888'}
            />
          </Pressable>

          {locked ? (
            <Animated.View
              style={styles.priceRow}
              entering={reduceMotion ? undefined : ROW_IN}
              exiting={reduceMotion ? undefined : ROW_OUT}>
              {PRICE_OPTIONS.map((cents) => (
                <Pressable
                  key={cents}
                  style={({ pressed }) => [
                    styles.priceChip,
                    priceCents === cents && styles.priceChipActive,
                    pressed && styles.chipPressed,
                  ]}
                  hitSlop={6}
                  onPress={() => {
                    tapFeedback();
                    setPriceCents(cents);
                  }}
                  disabled={posting}>
                  <Text
                    style={[styles.priceText, priceCents === cents && styles.priceTextActive]}>
                    {priceLabel(cents)}
                  </Text>
                </Pressable>
              ))}
            </Animated.View>
          ) : null}
        </View>

        {upload ? (
          <Animated.View style={styles.uploadingRow} layout={reduceMotion ? undefined : ROW_LAYOUT}>
            <Text style={styles.uploadingNote}>
              {stalled
                ? 'Connection lost. Waiting to resume.'
                : `Uploading ${Math.min(upload.fileIndex + 1, upload.fileCount)} of ${upload.fileCount} · ${Math.round(upload.fraction * 100)}%`}
            </Text>
            {stalled && cancellable ? (
              <Pressable
                onPress={cancelUpload}
                hitSlop={8}
                style={({ pressed }) => (pressed ? styles.textPressed : undefined)}>
                <Text style={styles.uploadingCancel}>Cancel upload</Text>
              </Pressable>
            ) : null}
          </Animated.View>
        ) : null}
      </ScrollView>

      {/* The draft guard's floating bar: styled like the chat's confirm pill. */}
      {confirmDiscard ? (
        <Animated.View
          style={styles.floating}
          entering={reduceMotion ? undefined : ROW_IN}
          exiting={reduceMotion ? undefined : ROW_OUT}>
          {posting && stalled && cancellable ? (
            <>
              <Text style={styles.confirmText}>Connection lost. Waiting to resume.</Text>
              <Pressable onPress={cancelUpload} hitSlop={8}>
                <Text style={styles.confirmYes}>Cancel upload</Text>
              </Pressable>
              <Pressable onPress={keepDraft} hitSlop={8}>
                <Text style={styles.confirmNo}>Wait</Text>
              </Pressable>
            </>
          ) : posting ? (
            <>
              <Text style={styles.confirmText}>Still uploading. Keep this screen open.</Text>
              <Pressable onPress={keepDraft} hitSlop={8}>
                <Text style={styles.confirmNo}>OK</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.confirmText}>Discard this post?</Text>
              <Pressable onPress={discardDraft} hitSlop={8}>
                <Text style={styles.confirmYes}>Discard</Text>
              </Pressable>
              <Pressable onPress={keepDraft} hitSlop={8}>
                <Text style={styles.confirmNo}>Keep</Text>
              </Pressable>
            </>
          )}
        </Animated.View>
      ) : null}
      </View>

      {/* Full-screen cover framing editor (Twitter-banner style). */}
      <Modal visible={coverEditorOpen} animationType="slide" onRequestClose={() => setCoverEditorOpen(false)}>
        <RNSafeAreaView style={styles.editorSafe}>
          <View style={styles.editorHeader}>
            <Pressable
              hitSlop={12}
              onPress={() => {
                if (coverIsFresh.current) setCover(null);
                setCoverEditorOpen(false);
              }}>
              <Text style={styles.editorCancel}>Cancel</Text>
            </Pressable>
            <Text style={styles.editorTitle}>Frame cover</Text>
            <Pressable
              hitSlop={12}
              onPress={() => {
                setCoverFocus(draftFocus);
                coverIsFresh.current = false;
                setCoverEditorOpen(false);
              }}>
              <Text style={styles.editorSave}>Save</Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.editorBody} scrollEnabled={false}>
            {cover ? (
              <CoverFramer
                uri={cover.previewUri}
                imageWidth={cover.width}
                imageHeight={cover.height}
                initialFocus={draftFocus}
                onCommit={setDraftFocus}
              />
            ) : null}
          </ScrollView>
        </RNSafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  cancel: { color: '#888', fontSize: 16 },
  heading: { color: '#fff', fontSize: 15, fontWeight: '700' },
  post: { color: '#fff', fontSize: 16, fontWeight: '700' },
  postDisabled: { opacity: 0.4 },
  textPressed: { opacity: 0.55 },
  chipPressed: { opacity: 0.7 },
  rowPressed: { opacity: 0.85 },
  // The 3px upload bar rides the top bar's bottom edge - no layout shift.
  progressTrack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.1)',
    overflow: 'hidden',
  },
  progressFill: { height: 3, backgroundColor: '#ffffff' },
  body: { flex: 1 },
  // The draft guard's bar: the chat's floating confirm, one for one. It
  // hangs 14pt under the top bar (the chat's insets.top + 58 with a 44pt
  // bar), measured from the body wrapper rather than the window.
  floating: {
    position: 'absolute',
    top: 14,
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
  content: { padding: 16 },
  projectRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  projectChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: '#131519',
  },
  projectChipActive: { backgroundColor: '#ffffff' },
  projectChipText: { color: '#aaa', fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  projectChipTextActive: { color: '#000' },
  input: {
    color: '#fff',
    fontSize: 17,
    minHeight: 120,
    textAlignVertical: 'top',
  },
  thumbRow: { marginTop: 16 },
  // The remove button must stay INSIDE this box's bounds — iOS ignores
  // taps on children that overflow their parent.
  thumbWrap: { marginRight: 10, paddingTop: 8, paddingRight: 8 },
  thumb: { width: 88, height: 88, borderRadius: 10, backgroundColor: '#1a1a1c' },
  thumbRemove: {
    position: 'absolute',
    top: 0,
    right: 0,
    backgroundColor: '#33363c',
    borderRadius: 11,
    padding: 4,
  },
  attachRow: { flexDirection: 'row', gap: 10, marginTop: 20, flexWrap: 'wrap' },
  attach: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#131519',
    borderRadius: 12,
    padding: 14,
  },
  attachText: { color: '#fff', fontSize: 15 },
  audioBox: {
    backgroundColor: '#131519',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  audioRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  audioName: { color: '#ddd', fontSize: 14, flex: 1 },
  coverRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  coverBlock: { marginTop: 12 },
  coverPreview: {
    aspectRatio: 16 / 9,
    borderRadius: 10,
    backgroundColor: '#1a1d22',
    overflow: 'hidden',
  },
  coverActions: { flexDirection: 'row', gap: 14, marginTop: 8 },
  coverAction: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  coverActionText: { color: '#c3cdd6', fontSize: 13, fontWeight: '600' },
  editorSafe: { flex: 1, backgroundColor: '#0b0c0e' },
  editorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  editorCancel: { color: '#9a9ba3', fontSize: 16 },
  editorTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  editorSave: { color: '#c3cdd6', fontSize: 16, fontWeight: '700' },
  editorBody: { flexGrow: 1, justifyContent: 'center', padding: 16 },
  titleInput: {
    backgroundColor: '#0d0d0f',
    color: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    marginTop: 12,
  },
  uploadingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  uploadingNote: { color: '#888', fontSize: 13, flexShrink: 1 },
  uploadingCancel: { color: '#f87171', fontSize: 13, fontWeight: '700' },
  lockBox: {
    backgroundColor: '#131519',
    borderRadius: 12,
    padding: 14,
    marginTop: 16,
  },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lockMeta: { flex: 1 },
  lockTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  lockHint: { color: '#777', fontSize: 12, marginTop: 2 },
  priceRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  priceChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: '#0d0d0f',
  },
  priceChipActive: { backgroundColor: '#c3cdd6' },
  priceText: { color: '#aaa', fontSize: 14, fontWeight: '700' },
  priceTextActive: { color: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { color: '#555' },
  error: { color: '#ff6b6b', marginTop: 12 },
  pollToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#131519',
    borderRadius: 12,
    padding: 14,
    marginTop: 20,
    alignSelf: 'flex-start',
  },
  pollToggleOn: { backgroundColor: '#c3cdd6' },
  pollToggleText: { color: '#9a9ba3', fontSize: 14, fontWeight: '600' },
  pollToggleTextOn: { color: '#0b0c0e' },
  pollBox: { marginTop: 8 },
  pollInput: {
    backgroundColor: '#131519',
    color: '#fff',
    borderRadius: 10,
    padding: 13,
    fontSize: 14,
    marginBottom: 8,
  },
  pollAdd: { paddingVertical: 6 },
  pollAddText: { color: '#8f99a3', fontSize: 13, fontWeight: '600' },
  pollDurationRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  durChip: {
    backgroundColor: '#131519',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  durChipActive: { backgroundColor: '#c3cdd6' },
  durText: { color: '#9a9ba3', fontSize: 12.5, fontWeight: '600' },
  durTextActive: { color: '#0b0c0e' },
});
