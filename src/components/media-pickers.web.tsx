// Web versions of the attach buttons: real HTML <label>+<input type="file">.
// The browser opens its file dialog natively when the label is tapped —
// no simulated clicks, which iPhone Safari refuses to honor.
import type { CSSProperties } from 'react';

import {
  MAX_FILE_BYTES,
  VIDEO_MAX_SECONDS,
  type PickedAudio,
  type PickedImage,
  type PickedVideo,
} from '@/lib/posts';

export type PickedImageDraft = PickedImage & { previewUri: string };

function boxStyle(disabled?: boolean): CSSProperties {
  return {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#131519',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    fontFamily: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    userSelect: 'none',
  };
}

type PhotoProps = {
  disabled?: boolean;
  label: string;
  maxCount: number;
  onPicked: (images: PickedImageDraft[]) => void;
  onError: (message: string) => void;
};

export function PickPhotosButton({ disabled, label, maxCount, onPicked, onError }: PhotoProps) {
  return (
    <label style={boxStyle(disabled)}>
      <span aria-hidden>📷</span>
      <span>{label}</span>
      <input
        type="file"
        accept="image/*"
        multiple
        disabled={disabled}
        style={{ display: 'none' }}
        onChange={async (e) => {
          const files = Array.from(e.currentTarget.files ?? []).slice(0, maxCount);
          e.currentTarget.value = '';
          if (files.length === 0) return;
          try {
            const images: PickedImageDraft[] = await Promise.all(
              files.map(async (file) => {
                let width: number | null = null;
                let height: number | null = null;
                try {
                  const bitmap = await createImageBitmap(file);
                  width = bitmap.width;
                  height = bitmap.height;
                  bitmap.close();
                } catch {
                  // Dimensions are a nice-to-have; the feed falls back to square.
                }
                return {
                  file,
                  mimeType: file.type || 'image/jpeg',
                  width,
                  height,
                  previewUri: URL.createObjectURL(file),
                };
              })
            );
            onPicked(images);
          } catch (err) {
            onError(`Couldn't read those photos: ${(err as { message?: string })?.message ?? String(err)}`);
          }
        }}
      />
    </label>
  );
}

/** Reads a video's duration and dimensions without uploading anything. */
function probeVideo(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const info = {
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      };
      URL.revokeObjectURL(url);
      resolve(info);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('could not read the video'));
    };
    video.src = url;
  });
}

type VideoProps = {
  disabled?: boolean;
  label: string;
  onPicked: (video: PickedVideo) => void;
  onError: (message: string) => void;
};

export function PickVideoButton({ disabled, label, onPicked, onError }: VideoProps) {
  return (
    <label style={boxStyle(disabled)}>
      <span aria-hidden>🎬</span>
      <span>{label}</span>
      <input
        type="file"
        accept="video/*,.mp4,.mov,.m4v,.webm"
        disabled={disabled}
        style={{ display: 'none' }}
        onChange={async (e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          if (file.size > MAX_FILE_BYTES) {
            onError(
              `That video is ${(file.size / (1024 * 1024)).toFixed(0)} MB — the limit is 50 MB. Export it smaller.`
            );
            return;
          }
          try {
            const info = await probeVideo(file);
            if (info.duration > VIDEO_MAX_SECONDS) {
              onError(
                `That video is ${Math.round(info.duration)} seconds — the cap is ${VIDEO_MAX_SECONDS}. Trim it and try again.`
              );
              return;
            }
            onPicked({
              file,
              mimeType: file.type || 'video/mp4',
              name: file.name,
              durationSeconds: info.duration,
              width: info.width || null,
              height: info.height || null,
            });
          } catch (err) {
            onError(`Couldn't read that video: ${(err as { message?: string })?.message ?? String(err)}`);
          }
        }}
      />
    </label>
  );
}

type AudioProps = {
  disabled?: boolean;
  label: string;
  onPicked: (audio: PickedAudio) => void;
  onError: (message: string) => void;
};

export function PickAudioButton({ disabled, label, onPicked, onError }: AudioProps) {
  return (
    <label style={boxStyle(disabled)}>
      <span aria-hidden>🎵</span>
      <span>{label}</span>
      <input
        type="file"
        accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg"
        disabled={disabled}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (!file) return;
          const looksLikeAudio =
            file.type.startsWith('audio/') || /\.(mp3|m4a|aac|wav|flac|ogg|aiff?)$/i.test(file.name);
          if (!looksLikeAudio) {
            onError(`"${file.name}" doesn't look like an audio file. Pick an MP3, M4A, or WAV.`);
            return;
          }
          onPicked({
            file,
            mimeType: file.type || 'audio/mpeg',
            name: file.name,
          });
        }}
      />
    </label>
  );
}
