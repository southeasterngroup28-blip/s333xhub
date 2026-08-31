import { base64ToArrayBuffer, type PickedImage } from '@/lib/posts';
import { supabase } from '@/lib/supabase';

/** avatar_path → a plain public URL (the avatars bucket is public). */
export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl;
}

/** Uploads a new profile photo and points my profile at it. */
export async function setMyAvatar(image: PickedImage, focus = 0.5): Promise<string> {
  const userId = (await supabase.auth.getUser()).data.user!.id;
  const ext = image.mimeType === 'image/png' ? 'png' : 'jpg';
  // Timestamped name = old cached copies can't shadow the new photo.
  const path = `${userId}/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, image.file ?? base64ToArrayBuffer(image.base64!), {
      contentType: image.mimeType,
    });
  if (uploadError) throw uploadError;

  const { data: me } = await supabase
    .from('profiles')
    .select('avatar_path')
    .eq('id', userId)
    .single();

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_path: path, avatar_focus: focus })
    .eq('id', userId);
  if (error) throw error;

  // Best-effort cleanup of the photo being replaced.
  if (me?.avatar_path) {
    supabase.storage.from('avatars').remove([me.avatar_path]).then(undefined, () => {});
  }
  return path;
}

export async function removeMyAvatar(): Promise<void> {
  const userId = (await supabase.auth.getUser()).data.user!.id;
  const { data: me } = await supabase
    .from('profiles')
    .select('avatar_path')
    .eq('id', userId)
    .single();
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_path: null })
    .eq('id', userId);
  if (error) throw error;
  if (me?.avatar_path) {
    supabase.storage.from('avatars').remove([me.avatar_path]).then(undefined, () => {});
  }
}
