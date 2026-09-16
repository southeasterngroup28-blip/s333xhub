import type { UploadTask } from 'expo-file-system/legacy';

import { requireUserId, supabase } from '@/lib/supabase';

export type Project = 'mazze' | 's333xgod';

export type PostMedia = {
  id: string;
  storage_path: string;
  media_type: string;
  width: number | null;
  height: number | null;
  position: number;
};

export type Post = {
  id: string;
  project: Project;
  kind: 'text' | 'photo' | 'audio' | 'video' | 'poll';
  body: string | null;
  title: string | null;
  is_locked: boolean;
  price_cents: number | null;
  cover_path: string | null;
  cover_focus: number;
  created_at: string;
  author_id: string;
  author: { display_name: string; avatar_path: string | null; avatar_focus: number | null } | null;
  post_media: PostMedia[];
};

export const PAGE_SIZE = 20;

/** The exact columns the feed renders — the post detail screen reuses this. */
const POST_SELECT =
  'id, project, kind, body, title, is_locked, price_cents, cover_path, cover_focus, created_at, author_id, author:profiles!posts_author_id_fkey(display_name, avatar_path, avatar_focus), post_media(id, storage_path, media_type, width, height, position)';

/**
 * Newest posts, optionally filtered to one project;
 * pass `before` (oldest loaded created_at) to get the next page.
 */
export async function fetchPosts(filter: Project | 'all', before?: string): Promise<Post[]> {
  let query = supabase
    .from('posts')
    .select(POST_SELECT)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (filter !== 'all') {
    query = query.eq('project', filter);
  }
  if (before) {
    query = query.lte('created_at', before);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as Post[]) ?? [];
}

/** One post by id, same shape the feed renders. Resolves null when it's gone. */
export async function fetchPostById(id: string): Promise<Post | null> {
  const { data, error } = await supabase
    .from('posts')
    .select(POST_SELECT)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as Post) ?? null;
}

/**
 * The photo bucket is private. This swaps storage paths for signed
 * links (7 days) that the <Image> components can actually load.
 */
// Signed URLs get a fresh ?token= on every call, which busts the image
// cache and re-downloads everything. Memoize per path until near expiry.
const signedUrlMemo = new Map<string, { url: string; expiresAt: number }>();

export async function signedUrlsFor(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const now = Date.now();
  const map: Record<string, string> = {};
  const missing: string[] = [];
  for (const path of paths) {
    const hit = signedUrlMemo.get(path);
    if (hit && hit.expiresAt > now + 10 * 60 * 1000) map[path] = hit.url;
    else missing.push(path);
  }
  if (missing.length === 0) return map;
  const { data, error } = await supabase.storage
    .from('post-media')
    .createSignedUrls(missing, 604800);
  if (error) throw error;
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) {
      map[item.path] = item.signedUrl;
      signedUrlMemo.set(item.path, { url: item.signedUrl, expiresAt: now + 604800 * 1000 });
    }
  }
  return map;
}

export type PickedImage = {
  /** Native pickers hand us base64 text… */
  base64?: string;
  /** …web file inputs hand us the file itself. Either works for upload. */
  file?: Blob;
  mimeType: string;
  width: number | null;
  height: number | null;
};

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export type PickedAudio = {
  /** Local file location on a phone. */
  uri?: string;
  /** The actual file object when picked in a web browser. */
  file?: Blob;
  mimeType: string;
  name: string;
};

/** "hotel 2.mp3" → "hotel 2": the default title for an audio post. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').trim();
}

/** HARD business rule: videos over 45s are rejected to control bandwidth cost. */
export const VIDEO_MAX_SECONDS = 45;
/** Supabase per-file upload ceiling on the current plan. */
// The feed refreshes on focus only when this says so (or it's been a while)
// - otherwise returning from a post keeps your scroll position.
let feedStale = true;
const staleListeners = new Set<() => void>();

/**
 * What a stale mark can carry: after posting, the feed opens at the top
 * with the new post already in place instead of waiting on the refetch.
 */
export type FeedStalePayload = { scrollToTop?: boolean; post?: Post };
let stalePayload: FeedStalePayload | null = null;

export function markFeedStale(opts?: FeedStalePayload) {
  feedStale = true;
  // A plain mark (a push tap, a show edit) never wipes a richer payload
  // that a just-made post left for the feed to consume.
  if (opts) stalePayload = { ...stalePayload, ...opts };
  staleListeners.forEach((notify) => notify());
}

/** Reads and clears the stale flag plus whatever payload rode along with it. */
export function consumeFeedStale(): { stale: boolean; payload: FeedStalePayload | null } {
  const result = { stale: feedStale, payload: stalePayload };
  feedStale = false;
  stalePayload = null;
  return result;
}
/**
 * Fires the moment the feed is marked stale. A feed that is already on
 * screen gets no focus event, so it listens here to refetch right away
 * (a new-post push tapped while sitting on the feed). Returns an unsubscribe.
 */
export function onFeedStale(listener: () => void): () => void {
  staleListeners.add(listener);
  return () => {
    staleListeners.delete(listener);
  };
}

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type PickedVideo = {
  uri?: string;
  file?: Blob;
  mimeType: string;
  name: string;
  durationSeconds: number;
  width: number | null;
  height: number | null;
};

/**
 * A picked image as compose hands it over: the phone picker also gives a
 * local file path, which is what gets streamed to storage (byte progress,
 * no base64 read on the JS thread). Web callers still carry the File.
 */
export type UploadableImage = PickedImage & { previewUri?: string };

export type NewPost = {
  project: Project;
  body: string;
  /** Audio posts: what the artist typed. Blank falls back to the file name. */
  title?: string;
  priceCents?: number | null;
  images?: UploadableImage[];
  audio?: PickedAudio | null;
  video?: PickedVideo | null;
  /** 2–4 labels makes this a poll post; the body is the question. */
  pollOptions?: string[] | null;
  pollEndsAt?: Date | null;
  /** Optional cover image for an audio post. */
  cover?: UploadableImage | null;
  /** Which vertical slice of the cover shows: 0 top … 1 bottom. */
  coverFocus?: number;
};

/** Reads a picked file into upload form: browser File directly, phone path via base64. */
export async function filePayload(item: { file?: Blob; uri?: string }): Promise<Blob | ArrayBuffer> {
  if (item.file) return item.file;
  const { readAsStringAsync, EncodingType } = await import('expo-file-system/legacy');
  const base64 = await readAsStringAsync(item.uri!, { encoding: EncodingType.Base64 });
  return base64ToArrayBuffer(base64);
}

// ---- streaming uploads ----

/** Thrown when the caller cancelled an in-flight upload. Not a failure. */
export class UploadCancelledError extends Error {
  constructor() {
    super('Upload cancelled.');
    this.name = 'UploadCancelledError';
  }
}

/** Where a file comes from: a local path on a phone, or a File on the web. */
export type UploadSource = { uri?: string; file?: Blob };

/** A handle on an in-flight native upload, so a screen can call it off. */
export type UploadHandle = { cancel: () => Promise<void> };

export type UploadOptions = {
  /**
   * Receives the cancel handle before the helper's first network round
   * trip, so a cancel tapped while the URL is still being signed lands too.
   */
  onHandle?: (handle: UploadHandle) => void;
};

const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/**
 * Streams one file into a private bucket with real byte progress.
 *
 * Native: asks storage for a signed upload URL, then hands the file path to
 * expo-file-system's upload task, which reads and sends it off the JS
 * thread (the base64 read that used to freeze the UI is gone). A PUT to
 * the signed URL with the token in the query is exactly what storage-js's
 * uploadToSignedUrl does. The task runs in a BACKGROUND session so an app
 * switch mid-transfer does not kill it. Status outside 200-299 throws.
 *
 * Web (or any caller holding a Blob): the plain storage upload, reported
 * as one completed step.
 */
export async function uploadWithProgress(
  bucket: string,
  path: string,
  source: UploadSource,
  contentType: string,
  onBytes?: (bytesSent: number, totalBytes: number) => void,
  options?: UploadOptions
): Promise<void> {
  if (source.file) {
    const { error } = await supabase.storage.from(bucket).upload(path, source.file, { contentType });
    if (error) throw error;
    onBytes?.(source.file.size, source.file.size);
    return;
  }
  if (!source.uri) throw new Error('That file could not be read. Pick it again.');

  // The handle exists before the first await: a cancel tapped during the
  // signing round trip (easily a second on cell) is not lost, because every
  // await below re-checks the flag before doing the next thing.
  let cancelled = false;
  let task: UploadTask | null = null;
  options?.onHandle?.({
    cancel: async () => {
      cancelled = true;
      await task?.cancelAsync().catch(() => {});
    },
  });
  const bailIfCancelled = () => {
    if (cancelled) throw new UploadCancelledError();
  };

  const { data: signed, error: signError } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);
  bailIfCancelled();
  if (signError) throw signError;

  // The legacy entry: the package root's SDK 57 default is the new File
  // API, which has no createUploadTask.
  const FileSystem = await import('expo-file-system/legacy');
  const { data: sessionData } = await supabase.auth.getSession();
  bailIfCancelled();
  const accessToken = sessionData.session?.access_token ?? SUPABASE_ANON_KEY;

  task = FileSystem.createUploadTask(
    signed.signedUrl,
    source.uri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
      headers: {
        'content-type': contentType,
        'cache-control': 'max-age=3600',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
      },
    },
    (progress) => {
      if (cancelled) return;
      onBytes?.(progress.totalBytesSent, progress.totalBytesExpectedToSend);
    }
  );
  bailIfCancelled();

  const result = await task.uploadAsync();
  // A cancelled task resolves empty rather than rejecting.
  if (cancelled || !result) {
    // A cancel that raced the final response: the bytes did land, so a
    // "cancelled" upload must not leave a stored object behind.
    if (result && result.status >= 200 && result.status < 300) {
      await supabase.storage.from(bucket).remove([path]).then(undefined, () => {});
    }
    throw new UploadCancelledError();
  }
  if (result.status < 200 || result.status >= 300) {
    let message = `Upload failed (${result.status}).`;
    try {
      const parsed = JSON.parse(result.body) as { message?: string; error?: string };
      message = parsed.message ?? parsed.error ?? message;
    } catch {}
    throw new Error(message);
  }
}

/** Bytes a source will send: the File's size on web, a stat on the phone. */
async function sourceSize(source: UploadSource): Promise<number> {
  if (source.file) return source.file.size;
  if (!source.uri) return 0;
  try {
    const { getInfoAsync } = await import('expo-file-system/legacy');
    const info = await getInfoAsync(source.uri);
    return info.exists ? info.size : 0;
  } catch {
    return 0;
  }
}

/** Live upload progress across a whole post's media batch. */
export type UploadProgress = (
  bytesSent: number,
  totalBytes: number,
  fileIndex: number,
  fileCount: number
) => void;

/** One file in a post's upload batch, planned before the post row exists. */
type UploadStep = {
  source: UploadSource;
  contentType: string;
  pathFor: (postId: string) => string;
};

/** Where a picked image's bytes come from: the File on web, the local path on a phone. */
function imageSource(image: UploadableImage): UploadSource {
  return image.file ? { file: image.file } : { uri: image.previewUri };
}

export type CreatePostOptions = {
  /**
   * Receives each file's cancel handle as its upload begins. Cancelling
   * throws UploadCancelledError out of createPost, which rolls the
   * half-made post back like any other failure.
   */
  onUpload?: (handle: UploadHandle) => void;
};

/**
 * Create a post; uploads any attached media (sequentially, with byte
 * progress), then records it in post_media. Resolves to the finished row
 * as the feed renders it (media and cover included), or null if that
 * final read failed - the post itself is already saved by then.
 */
export async function createPost(
  input: NewPost,
  onProgress?: UploadProgress,
  options?: CreatePostOptions
): Promise<Post | null> {
  const { project, body, title, priceCents, video } = input;
  const images = input.images ?? [];
  const audio = input.audio ?? null;
  const cover = audio ? (input.cover ?? null) : null;
  const pollOptions = input.pollOptions ?? null;

  if (video && video.durationSeconds > VIDEO_MAX_SECONDS) {
    throw new Error(`Videos are capped at ${VIDEO_MAX_SECONDS} seconds.`);
  }

  // Plan the whole batch first so the progress bar knows its total from
  // the first byte: audio, then cover, then video, then each photo.
  const steps: UploadStep[] = [];
  if (audio) {
    const extension = audio.name.includes('.') ? audio.name.split('.').pop()! : 'mp3';
    steps.push({
      source: { uri: audio.uri, file: audio.file },
      contentType: audio.mimeType,
      pathFor: (id) => `${id}/audio.${extension}`,
    });
  }
  if (cover) {
    const coverExtension = cover.mimeType === 'image/png' ? 'png' : 'jpg';
    steps.push({
      source: imageSource(cover),
      contentType: cover.mimeType,
      pathFor: (id) => `${id}/cover.${coverExtension}`,
    });
  }
  if (video) {
    const extension = video.name.includes('.') ? video.name.split('.').pop()! : 'mp4';
    steps.push({
      source: { uri: video.uri, file: video.file },
      contentType: video.mimeType,
      pathFor: (id) => `${id}/video.${extension}`,
    });
  }
  images.forEach((image, i) => {
    const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
    steps.push({
      source: imageSource(image),
      contentType: image.mimeType,
      pathFor: (id) => `${id}/${i}.${extension}`,
    });
  });
  const sizes = await Promise.all(steps.map((step) => sourceSize(step.source)));
  const totalBytes = () => sizes.reduce((sum, n) => sum + n, 0);
  let doneBytes = 0;

  /** Streams step `i` to its path, mapping its bytes into the batch total. */
  async function send(i: number, postId: string): Promise<string> {
    const step = steps[i];
    const path = step.pathFor(postId);
    onProgress?.(doneBytes, totalBytes(), i, steps.length);
    await uploadWithProgress(
      'post-media',
      path,
      step.source,
      step.contentType,
      (sent, expected) => {
        // The task's expected total is the real number; trust it over the stat.
        if (expected > 0 && sizes[i] !== expected) sizes[i] = expected;
        onProgress?.(doneBytes + Math.min(sent, sizes[i]), totalBytes(), i, steps.length);
      },
      { onHandle: options?.onUpload }
    );
    doneBytes += sizes[i];
    onProgress?.(doneBytes, totalBytes(), i, steps.length);
    return path;
  }

  // A typed title wins; an audio post with the field cleared uses its file name.
  const resolvedTitle = title?.trim() || (audio ? titleFromFileName(audio.name) : '');

  const { data: post, error: postError } = await supabase
    .from('posts')
    .insert({
      author_id: await requireUserId(),
      project,
      kind: pollOptions
        ? 'poll'
        : video
          ? 'video'
          : audio
            ? 'audio'
            : images.length > 0
              ? 'photo'
              : 'text',
      body: body.trim() || null,
      title: resolvedTitle || null,
      is_locked: !!priceCents,
      price_cents: priceCents ?? null,
    })
    .select('id')
    .single();
  if (postError) throw postError;

  try {
    if (pollOptions) {
      const { createPollForPost } = await import('@/lib/social');
      await createPollForPost(post.id, pollOptions, input.pollEndsAt ?? null);
    }

    let step = 0;

    if (audio) {
      const path = await send(step++, post.id);

      const { error: mediaError } = await supabase.from('post_media').insert({
        post_id: post.id,
        storage_path: path,
        media_type: audio.mimeType,
        position: 0,
      });
      if (mediaError) throw mediaError;

      // Optional cover art, shown in the player card and on the lock screen.
      if (cover) {
        const coverPath = await send(step++, post.id);
        const { error: coverError } = await supabase
          .from('posts')
          .update({ cover_path: coverPath, cover_focus: input.coverFocus ?? 0.5 })
          .eq('id', post.id);
        if (coverError) throw coverError;
      }
    }

    if (video) {
      const path = await send(step++, post.id);

      const { error: mediaError } = await supabase.from('post_media').insert({
        post_id: post.id,
        storage_path: path,
        media_type: video.mimeType,
        width: video.width,
        height: video.height,
        duration_seconds: Math.round(video.durationSeconds),
        position: 0,
      });
      if (mediaError) throw mediaError;
    }

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      const path = await send(step++, post.id);

      const { error: mediaError } = await supabase.from('post_media').insert({
        post_id: post.id,
        storage_path: path,
        media_type: image.mimeType,
        width: image.width,
        height: image.height,
        position: i,
      });
      if (mediaError) throw mediaError;
    }
  } catch (e) {
    // A half-made post must never haunt the feed - roll it back, then rethrow.
    await supabase.from('posts').delete().eq('id', post.id).then(undefined, () => {});
    throw e;
  }

  // The insert-time row has no media or cover yet; the feed wants the
  // finished one. A failed read here is not a failed post.
  return fetchPostById(post.id).catch(() => null);
}

/** "3m ago" style timestamps for the feed. */
export function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
