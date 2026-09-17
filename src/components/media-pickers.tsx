// Native (iOS/Android app) versions of the attach buttons.
// The web versions live in media-pickers.web.tsx and use real HTML
// file inputs, because Safari blocks the simulated-click approach.
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

import { tapFeedback } from '@/lib/haptics';
import {
  MAX_FILE_BYTES,
  VIDEO_MAX_SECONDS,
  type PickedAudio,
  type PickedImage,
  type PickedVideo,
} from '@/lib/posts';

export type PickedImageDraft = PickedImage & { previewUri: string };

// The system sheet takes a beat to present (and the document picker copies
// the file to cache first). Every button acknowledges the tap at once,
// swaps its glyph for a spinner while the sheet is on its way, and refuses
// a second tap so two pickers can never launch at once. `size="small"` is
// exactly the 20px icon footprint on iOS - numeric sizes are Android-only.
function PickerGlyph({
  name,
  color,
  picking,
}: {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  picking: boolean;
}) {
  return picking ? (
    <ActivityIndicator size="small" color={color} />
  ) : (
    <Ionicons name={name} size={20} color={color} />
  );
}

type PhotoProps = {
  disabled?: boolean;
  label: string;
  maxCount: number;
  onPicked: (images: PickedImageDraft[]) => void;
  onError: (message: string) => void;
  /** Bare 30px icon in the chat composer's dim gray — no box, no label. */
  compact?: boolean;
  /**
   * Whether the picker should also hand back the image as base64 (default
   * true: avatars, backgrounds, shop and chat upload from it). Callers that
   * stream from `previewUri` (compose, fan mail) pass false, which skips a
   * multi-MB encode per photo and the bridge trip that carried it.
   */
  withBase64?: boolean;
};

export function PickPhotosButton({
  disabled,
  label,
  maxCount,
  onPicked,
  onError,
  compact,
  withBase64 = true,
}: PhotoProps) {
  const [picking, setPicking] = useState(false);

  async function pick() {
    tapFeedback();
    if (picking) return;
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: maxCount,
        quality: 0.7,
        base64: withBase64,
      });
      if (result.canceled) return;
      const oversized = result.assets.find((a) => a.fileSize && a.fileSize > MAX_FILE_BYTES);
      if (oversized) {
        onError('One of those photos is over the 50 MB limit. Pick a smaller one.');
        return;
      }
      onPicked(
        result.assets
          .filter((a) => (withBase64 ? !!a.base64 : !!a.uri))
          .map((a) => ({
            base64: withBase64 ? a.base64! : undefined,
            mimeType: a.mimeType ?? 'image/jpeg',
            width: a.width,
            height: a.height,
            previewUri: a.uri,
          }))
      );
    } catch (e) {
      console.warn('[media-pickers] photos', e);
      onError('Could not open your photos. Try again.');
    } finally {
      setPicking(false);
    }
  }

  if (compact) {
    return (
      <Pressable
        style={({ pressed }) => [
          styles.compact,
          disabled && styles.disabled,
          pressed && styles.attachPressed,
        ]}
        onPress={pick}
        disabled={disabled || picking}
        hitSlop={8}
        accessibilityLabel="Send a photo">
        <PickerGlyph name="image-outline" color="#6c7078" picking={picking} />
      </Pressable>
    );
  }
  return (
    <Pressable
      style={({ pressed }) => [
        styles.attach,
        disabled && styles.disabled,
        pressed && styles.attachPressed,
      ]}
      onPress={pick}
      disabled={disabled || picking}>
      <PickerGlyph name="image-outline" color="#fff" picking={picking} />
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

type VideoProps = {
  disabled?: boolean;
  label: string;
  onPicked: (video: PickedVideo) => void;
  onError: (message: string) => void;
};

export function PickVideoButton({ disabled, label, onPicked, onError }: VideoProps) {
  const [picking, setPicking] = useState(false);

  async function pick() {
    tapFeedback();
    if (picking) return;
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsMultipleSelection: false,
        // iOS lets the user trim to length right inside the picker.
        videoMaxDuration: VIDEO_MAX_SECONDS,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];

      // expo-image-picker reports video duration in milliseconds. A null
      // duration would read as 0s and silently bypass the 45s hard cap.
      if (asset.duration == null) {
        onError("Could not read that video's length. Re-export it and try again.");
        return;
      }
      const durationSeconds = asset.duration / 1000;
      if (durationSeconds > VIDEO_MAX_SECONDS) {
        onError(
          `That video is ${Math.round(durationSeconds)} seconds. The cap is ${VIDEO_MAX_SECONDS}. Trim it and try again.`
        );
        return;
      }
      if (asset.fileSize && asset.fileSize > MAX_FILE_BYTES) {
        onError(
          `That video is ${(asset.fileSize / (1024 * 1024)).toFixed(0)} MB. The limit is 50 MB. Export it smaller.`
        );
        return;
      }

      onPicked({
        uri: asset.uri,
        mimeType: asset.mimeType ?? 'video/mp4',
        name: asset.fileName ?? 'video.mp4',
        durationSeconds,
        width: asset.width ?? null,
        height: asset.height ?? null,
      });
    } catch (e) {
      console.warn('[media-pickers] videos', e);
      onError('Could not open your videos. Try again.');
    } finally {
      setPicking(false);
    }
  }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.attach,
        disabled && styles.disabled,
        pressed && styles.attachPressed,
      ]}
      onPress={pick}
      disabled={disabled || picking}>
      <PickerGlyph name="videocam-outline" color="#fff" picking={picking} />
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

type AudioProps = {
  disabled?: boolean;
  label: string;
  onPicked: (audio: PickedAudio) => void;
  onError: (message: string) => void;
};

export function PickAudioButton({ disabled, label, onPicked, onError }: AudioProps) {
  const [picking, setPicking] = useState(false);

  async function pick() {
    tapFeedback();
    if (picking) return;
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      if (asset.size && asset.size > MAX_FILE_BYTES) {
        const mb = Math.round(asset.size / (1024 * 1024));
        onError(
          `That file is ${mb} MB. The cap is 50 MB. WAV files are huge; export it as MP3 or M4A and it will fit easily.`
        );
        return;
      }
      onPicked({
        uri: asset.uri,
        file: asset.file ?? undefined,
        mimeType: asset.mimeType ?? 'audio/mpeg',
        name: asset.name,
      });
    } catch (e) {
      console.warn('[media-pickers] files', e);
      onError('Could not open your files. Try again.');
    } finally {
      setPicking(false);
    }
  }

  return (
    <Pressable
      style={({ pressed }) => [
        styles.attach,
        disabled && styles.disabled,
        pressed && styles.attachPressed,
      ]}
      onPress={pick}
      disabled={disabled || picking}>
      <PickerGlyph name="musical-notes-outline" color="#fff" picking={picking} />
      <Text style={styles.text}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  attach: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#131519',
    borderRadius: 12,
    padding: 14,
  },
  compact: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  attachPressed: { opacity: 0.6, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.4 },
  text: { color: '#fff', fontSize: 15 },
});
