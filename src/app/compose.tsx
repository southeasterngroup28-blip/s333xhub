import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  PickAudioButton,
  PickPhotosButton,
  PickVideoButton,
  type PickedImageDraft,
} from '@/components/media-pickers';
import { createPost, type PickedAudio, type PickedVideo, type Project } from '@/lib/posts';
import { useAuth } from '@/providers/auth-provider';

const MAX_IMAGES = 4;

// Apple in-app purchases only allow preset price points, so the artist
// picks from these instead of typing a number. Extend the list as needed —
// each one becomes a registered product in App Store Connect at step 7.
const PRICE_OPTIONS = [499, 999, 1499, 1999];

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

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
  disabled,
  onCommit,
  onRemove,
  onDragging,
}: {
  uri: string;
  imageWidth: number | null;
  imageHeight: number | null;
  initialFocus: number;
  disabled: boolean;
  onCommit: (focus: number) => void;
  onRemove: () => void;
  onDragging: (dragging: boolean) => void;
}) {
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
        onDragging(true);
      },
      onPanResponderMove: (_e, g) => {
        const next = Math.min(maxYRef.current, Math.max(0, dragStartY.current + g.dy));
        rectYRef.current = next;
        setRectY(next);
      },
      onPanResponderRelease: () => {
        onDragging(false);
        onCommit(maxYRef.current > 0 ? rectYRef.current / maxYRef.current : 0.5);
      },
      onPanResponderTerminate: () => {
        onDragging(false);
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
        <Pressable style={framerStyles.remove} hitSlop={8} onPress={onRemove} disabled={disabled}>
          <Ionicons name="close" size={16} color="#fff" />
        </Pressable>
      </View>
      <Text style={framerStyles.hint}>
        {maxY > 0
          ? 'Drag the window — what’s inside it is what shows'
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

export default function ComposeScreen() {
  const params = useLocalSearchParams<{ project: Project }>();
  const { profile } = useAuth();
  const router = useRouter();
  const [project, setProject] = useState<Project>(params.project === 's333xgod' ? 's333xgod' : 'mazze');
  const [body, setBody] = useState('');
  const [images, setImages] = useState<PickedImageDraft[]>([]);
  const [audio, setAudio] = useState<PickedAudio | null>(null);
  const [cover, setCover] = useState<PickedImageDraft | null>(null);
  const [coverFocus, setCoverFocus] = useState(0.5);
  const [draggingCover, setDraggingCover] = useState(false);
  const [video, setVideo] = useState<PickedVideo | null>(null);
  const [trackTitle, setTrackTitle] = useState('');
  const [locked, setLocked] = useState(false);
  const [priceCents, setPriceCents] = useState<number>(PRICE_OPTIONS[0]);
  const [pollMode, setPollMode] = useState(false);
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [pollHours, setPollHours] = useState<number | null>(24);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    if (!trackTitle.trim()) {
      // Pre-fill the title from the file name, minus the extension.
      setTrackTitle(picked.name.replace(/\.[^.]+$/, ''));
    }
  }

  function handlePickedVideo(picked: PickedVideo) {
    setError(null);
    setVideo(picked);
  }

  function goToFeed() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }

  async function handlePost() {
    setError(null);
    setPosting(true);
    try {
      const filledOptions = pollOptions.map((o) => o.trim()).filter(Boolean);
      await createPost({
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
      });
      goToFeed();
    } catch (e) {
      // Supabase errors carry a message but aren't Error instances.
      const message =
        (e as { message?: string })?.message ?? 'Something went wrong. Try again.';
      setError(message);
      setPosting(false);
    }
  }

  const canPost =
    !posting &&
    (pollMode
      ? body.trim().length > 0 && pollOptions.map((o) => o.trim()).filter(Boolean).length >= 2
      : audio
        ? trackTitle.trim().length > 0
        : !!video || body.trim().length > 0 || images.length > 0);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <Pressable onPress={goToFeed} hitSlop={12} disabled={posting}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.heading}>New post</Text>
        <Pressable onPress={handlePost} disabled={!canPost} hitSlop={12}>
          {posting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={[styles.post, !canPost && styles.postDisabled]}>Post</Text>
          )}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!draggingCover}>
        <View style={styles.projectRow}>
          {(['mazze', 's333xgod'] as const).map((p) => (
            <Pressable
              key={p}
              style={[styles.projectChip, project === p && styles.projectChipActive]}
              onPress={() => setProject(p)}
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
                style={styles.pollAdd}>
                <Text style={styles.pollAddText}>+ Add option</Text>
              </Pressable>
            ) : null}
            <View style={styles.pollDurationRow}>
              {[
                { label: '24h', hours: 24 },
                { label: '3 days', hours: 72 },
                { label: '7 days', hours: 168 },
                { label: 'No end', hours: null },
              ].map((choice) => (
                <Pressable
                  key={choice.label}
                  style={[styles.durChip, pollHours === choice.hours && styles.durChipActive]}
                  onPress={() => setPollHours(choice.hours)}>
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
              <CoverFramer
                uri={cover.previewUri}
                imageWidth={cover.width}
                imageHeight={cover.height}
                initialFocus={coverFocus}
                disabled={posting}
                onCommit={setCoverFocus}
                onRemove={() => setCover(null)}
                onDragging={setDraggingCover}
              />
            ) : (
              <View style={styles.coverRow}>
                <PickPhotosButton
                  label="Add cover"
                  maxCount={1}
                  disabled={posting}
                  onPicked={(picked) => picked[0] && setCover(picked[0])}
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
          style={[styles.pollToggle, pollMode && styles.pollToggleOn]}
          onPress={() => setPollMode(!pollMode)}
          disabled={posting || !!audio || !!video || images.length > 0}>
          <Ionicons name="stats-chart" size={16} color={pollMode ? '#0b0c0e' : '#9a9ba3'} />
          <Text style={[styles.pollToggleText, pollMode && styles.pollToggleTextOn]}>
            {pollMode ? 'Poll post — tap to cancel' : 'Make this a poll'}
          </Text>
        </Pressable>

        {pollMode ? null : (
        <View style={styles.attachRow}>
          <PickPhotosButton
            label={images.length === 0 ? 'Photos' : `Photos (${images.length}/${MAX_IMAGES})`}
            maxCount={MAX_IMAGES - images.length}
            disabled={images.length >= MAX_IMAGES || !!audio || !!video || posting}
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
            style={styles.lockRow}
            onPress={() => setLocked(!locked)}
            disabled={posting}>
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
            <View style={[styles.lockToggle, locked && styles.lockToggleOn]}>
              <View style={[styles.lockKnob, locked && styles.lockKnobOn]} />
            </View>
          </Pressable>

          {locked ? (
            <View style={styles.priceRow}>
              {PRICE_OPTIONS.map((cents) => (
                <Pressable
                  key={cents}
                  style={[styles.priceChip, priceCents === cents && styles.priceChipActive]}
                  onPress={() => setPriceCents(cents)}
                  disabled={posting}>
                  <Text
                    style={[styles.priceText, priceCents === cents && styles.priceTextActive]}>
                    {formatPrice(cents)}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>

        {posting && (audio || video) ? (
          <Text style={styles.uploadingNote}>Uploading — keep this screen open…</Text>
        ) : null}
      </ScrollView>
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
  titleInput: {
    backgroundColor: '#0d0d0f',
    color: '#fff',
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    marginTop: 12,
  },
  uploadingNote: { color: '#888', marginTop: 16, fontSize: 13 },
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
  lockToggle: {
    width: 46,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#333',
    padding: 3,
    justifyContent: 'center',
  },
  lockToggleOn: { backgroundColor: '#c3cdd6' },
  lockKnob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#888',
  },
  lockKnobOn: { backgroundColor: '#0b0c0e', alignSelf: 'flex-end' },
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
