// Native (iOS/Android app) versions of the attach buttons.
// The web versions live in media-pickers.web.tsx and use real HTML
// file inputs, because Safari blocks the simulated-click approach.
import Ionicons from '@expo/vector-icons/Ionicons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Pressable, StyleSheet, Text } from 'react-native';

import {
  MAX_FILE_BYTES,
  VIDEO_MAX_SECONDS,
  type PickedAudio,
  type PickedImage,
  type PickedVideo,
} from '@/lib/posts';

export type PickedImageDraft = PickedImage & { previewUri: string };

type PhotoProps = {
  disabled?: boolean;
  label: string;
  maxCount: number;
  onPicked: (images: PickedImageDraft[]) => void;
  onError: (message: string) => void;
};

export function PickPhotosButton({ disabled, label, maxCount, onPicked, onError }: PhotoProps) {
  async function pick() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: maxCount,
        quality: 0.7,
        base64: true,
      });
      if (result.canceled) return;
      onPicked(
        result.assets
          .filter((a) => a.base64)
          .map((a) => ({
            base64: a.base64!,
            mimeType: a.mimeType ?? 'image/jpeg',
            width: a.width,
            height: a.height,
            previewUri: a.uri,
          }))
      );
    } catch (e) {
      onError(`Photo picker failed: ${(e as { message?: string })?.message ?? String(e)}`);
    }
  }

  return (
    <Pressable style={[styles.attach, disabled && styles.disabled]} onPress={pick} disabled={disabled}>
      <Ionicons name="image-outline" size={20} color="#fff" />
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
  async function pick() {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['videos'],
        allowsMultipleSelection: false,
        // iOS lets the user trim to length right inside the picker.
        videoMaxDuration: VIDEO_MAX_SECONDS,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];

      // expo-image-picker reports video duration in milliseconds.
      const durationSeconds = (asset.duration ?? 0) / 1000;
      if (durationSeconds > VIDEO_MAX_SECONDS) {
        onError(
          `That video is ${Math.round(durationSeconds)} seconds — the cap is ${VIDEO_MAX_SECONDS}. Trim it and try again.`
        );
        return;
      }
      if (asset.fileSize && asset.fileSize > MAX_FILE_BYTES) {
        onError(
          `That video is ${(asset.fileSize / (1024 * 1024)).toFixed(0)} MB — the limit is 50 MB. Export it smaller.`
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
      onError(`Video picker failed: ${(e as { message?: string })?.message ?? String(e)}`);
    }
  }

  return (
    <Pressable style={[styles.attach, disabled && styles.disabled]} onPress={pick} disabled={disabled}>
      <Ionicons name="videocam-outline" size={20} color="#fff" />
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
  async function pick() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'audio/*',
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      onPicked({
        uri: asset.uri,
        file: asset.file ?? undefined,
        mimeType: asset.mimeType ?? 'audio/mpeg',
        name: asset.name,
      });
    } catch (e) {
      onError(`Audio picker failed: ${(e as { message?: string })?.message ?? String(e)}`);
    }
  }

  return (
    <Pressable style={[styles.attach, disabled && styles.disabled]} onPress={pick} disabled={disabled}>
      <Ionicons name="musical-notes-outline" size={20} color="#fff" />
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
  disabled: { opacity: 0.4 },
  text: { color: '#fff', fontSize: 15 },
});
