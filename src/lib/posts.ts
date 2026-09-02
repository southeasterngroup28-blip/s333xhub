import { supabase } from '@/lib/supabase';

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

/**
 * Newest posts, optionally filtered to one project;
 * pass `before` (oldest loaded created_at) to get the next page.
 */
export async function fetchPosts(filter: Project | 'all', before?: string): Promise<Post[]> {
  let query = supabase
    .from('posts')
    .select('id, project, kind, body, title, is_locked, price_cents, cover_path, cover_focus, created_at, author_id, author:profiles!posts_author_id_fkey(display_name, avatar_path, avatar_focus), post_media(id, storage_path, media_type, width, height, position)')
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

/**
 * The photo bucket is private. This swaps storage paths for short-lived
 * signed links (1 hour) that the <Image> components can actually load.
 */
export async function signedUrlsFor(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage.from('post-media').createSignedUrls(paths, 21600);
  if (error) throw error;
  const map: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) map[item.path] = item.signedUrl;
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

/** HARD business rule: videos over 45s are rejected to control bandwidth cost. */
export const VIDEO_MAX_SECONDS = 45;
/** Supabase per-file upload ceiling on the current plan. */
// The feed refreshes on focus only when this says so (or it's been a while)
// - otherwise returning from a post keeps your scroll position.
let feedStale = true;
export function markFeedStale() { feedStale = true; }
export function consumeFeedStale(): boolean { const v = feedStale; feedStale = false; return v; }

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

export type NewPost = {
  project: Project;
  body: string;
  title?: string;
  priceCents?: number | null;
  images?: PickedImage[];
  audio?: PickedAudio | null;
  video?: PickedVideo | null;
  /** 2–4 labels makes this a poll post; the body is the question. */
  pollOptions?: string[] | null;
  pollEndsAt?: Date | null;
  /** Optional cover image for an audio post. */
  cover?: PickedImage | null;
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

/** Create a post; uploads any attached media, then records it in post_media. */
export async function createPost(input: NewPost): Promise<void> {
  const { project, body, title, priceCents, video } = input;
  const images = input.images ?? [];
  const audio = input.audio ?? null;
  const pollOptions = input.pollOptions ?? null;

  if (video && video.durationSeconds > VIDEO_MAX_SECONDS) {
    throw new Error(`Videos are capped at ${VIDEO_MAX_SECONDS} seconds.`);
  }

  const { data: post, error: postError } = await supabase
    .from('posts')
    .insert({
      author_id: (await supabase.auth.getUser()).data.user!.id,
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
      title: title?.trim() || null,
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

  if (audio) {
    const extension = audio.name.includes('.') ? audio.name.split('.').pop()! : 'mp3';
    const path = `${post.id}/audio.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('post-media')
      .upload(path, await filePayload(audio), { contentType: audio.mimeType });
    if (uploadError) throw uploadError;

    const { error: mediaError } = await supabase.from('post_media').insert({
      post_id: post.id,
      storage_path: path,
      media_type: audio.mimeType,
      position: 0,
    });
    if (mediaError) throw mediaError;

    // Optional cover art, shown in the player card and on the lock screen.
    const cover = input.cover;
    if (cover) {
      const coverExtension = cover.mimeType === 'image/png' ? 'png' : 'jpg';
      const coverPath = `${post.id}/cover.${coverExtension}`;
      const { error: coverUploadError } = await supabase.storage
        .from('post-media')
        .upload(coverPath, cover.file ?? base64ToArrayBuffer(cover.base64!), {
          contentType: cover.mimeType,
        });
      if (coverUploadError) throw coverUploadError;
      const { error: coverError } = await supabase
        .from('posts')
        .update({ cover_path: coverPath, cover_focus: input.coverFocus ?? 0.5 })
        .eq('id', post.id);
      if (coverError) throw coverError;
    }
  }

  if (video) {
    const extension = video.name.includes('.') ? video.name.split('.').pop()! : 'mp4';
    const path = `${post.id}/video.${extension}`;

    const { error: uploadError } = await supabase.storage
      .from('post-media')
      .upload(path, await filePayload(video), { contentType: video.mimeType });
    if (uploadError) throw uploadError;

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
    const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
    const path = `${post.id}/${i}.${extension}`;

    const payload: Blob | ArrayBuffer = image.file ?? base64ToArrayBuffer(image.base64!);
    const { error: uploadError } = await supabase.storage
      .from('post-media')
      .upload(path, payload, { contentType: image.mimeType });
    if (uploadError) throw uploadError;

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
