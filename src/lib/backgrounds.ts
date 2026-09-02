import { base64ToArrayBuffer, type PickedImage } from '@/lib/posts';
import { supabase, requireUserId } from '@/lib/supabase';

const DEFAULT_KEY = 'default_background';

/**
 * The background this user should see: their own if set, otherwise the
 * artist's app-wide default, otherwise none. Returns a 24h viewing URL.
 */
export async function fetchEffectiveBackgroundUrl(myUserId: string): Promise<string | null> {
  const [mine, fallback] = await Promise.all([
    supabase.from('profiles').select('background_path').eq('id', myUserId).maybeSingle(),
    supabase.from('app_settings').select('value').eq('key', DEFAULT_KEY).maybeSingle(),
  ]);
  const path = mine.data?.background_path ?? fallback.data?.value ?? null;
  if (!path) return null;
  // Stable URL per path: a fresh token every call would make expo-image
  // re-download the full background on every screen focus.
  const hit = bgUrlMemo.get(path);
  if (hit && hit.expiresAt > Date.now() + 30 * 60 * 1000) return hit.url;
  const { data, error } = await supabase.storage
    .from('backgrounds')
    .createSignedUrl(path, 60 * 60 * 24);
  if (error) return null;
  bgUrlMemo.set(path, { url: data.signedUrl, expiresAt: Date.now() + 60 * 60 * 24 * 1000 });
  return data.signedUrl;
}

const bgUrlMemo = new Map<string, { url: string; expiresAt: number }>();

async function uploadBackground(image: PickedImage): Promise<string> {
  const me = await requireUserId();
  const extension = image.mimeType === 'image/png' ? 'png' : 'jpg';
  const path = `${me}/${Date.now()}.${extension}`;
  const { error } = await supabase.storage
    .from('backgrounds')
    .upload(path, image.file ?? base64ToArrayBuffer(image.base64!), {
      contentType: image.mimeType,
      upsert: true,
    });
  if (error) throw error;
  return path;
}

/** Best-effort delete of a background file nothing points at anymore. */
function discard(path: string | null | undefined) {
  if (path) supabase.storage.from('backgrounds').remove([path]).then(undefined, () => {});
}

/** Set MY personal background (overrides the default on this account). */
export async function setMyBackground(image: PickedImage): Promise<void> {
  const me = await requireUserId();
  const { data: before } = await supabase
    .from('profiles')
    .select('background_path')
    .eq('id', me)
    .maybeSingle();
  const path = await uploadBackground(image);
  const { error } = await supabase
    .from('profiles')
    .update({ background_path: path })
    .eq('id', me);
  if (error) {
    discard(path);
    throw error;
  }
  discard(before?.background_path);
}

/** Back to the artist's default. */
export async function clearMyBackground(): Promise<void> {
  const me = await requireUserId();
  const { data: before } = await supabase
    .from('profiles')
    .select('background_path')
    .eq('id', me)
    .maybeSingle();
  const { error } = await supabase
    .from('profiles')
    .update({ background_path: null })
    .eq('id', me);
  if (error) throw error;
  discard(before?.background_path);
}

/** Artist only: set the app-wide default background everyone sees. */
export async function setDefaultBackground(image: PickedImage): Promise<void> {
  const { data: before } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', DEFAULT_KEY)
    .maybeSingle();
  const path = await uploadBackground(image);
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: DEFAULT_KEY, value: path, updated_at: new Date().toISOString() });
  if (error) {
    discard(path);
    throw error;
  }
  discard(before?.value);
}
