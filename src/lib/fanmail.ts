import { filePayload } from '@/lib/posts';
import { supabase } from '@/lib/supabase';

/** $10 per submission. The charge activates with the App Store build. */
export const FAN_MAIL_PRICE_CENTS = 1000;

/**
 * Flips to true when RevenueCat goes live (step 7b, needs Apple).
 * While false, submissions are hard-blocked — no payment, no send.
 */
export const FAN_MAIL_PAYMENTS_LIVE = false;

export type FanMailKind = 'picture' | 'video' | 'audio';

export type FanMailItem = {
  id: string;
  user_id: string;
  kind: FanMailKind;
  storage_path: string;
  note: string | null;
  paid: boolean;
  created_at: string;
  reviewed_at: string | null;
  sender: { display_name: string } | null;
};

export async function submitFanMail(
  kind: FanMailKind,
  item: { file?: Blob; uri?: string; mimeType: string; name: string },
  note: string
): Promise<void> {
  const me = (await supabase.auth.getUser()).data.user!.id;
  const extension = item.name.includes('.') ? item.name.split('.').pop()! : 'bin';
  const path = `${me}/${Date.now()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from('fan-mail')
    .upload(path, await filePayload(item), { contentType: item.mimeType });
  if (uploadError) throw uploadError;

  const { data: row, error } = await supabase
    .from('fan_mail')
    .insert({
      user_id: me,
      kind,
      storage_path: path,
      note: note.trim() || null,
    })
    .select('id')
    .single();
  if (error) throw error;

  // Deliver to the artist's private inbox. Nothing displays in-app; if the
  // email function isn't deployed yet this fails silently and the row +
  // file still exist for a manual re-send.
  await supabase.functions
    .invoke('fanmail-email', { body: { fan_mail_id: row.id } })
    .catch(() => {});
}

/** My own submissions (fans) — newest first. */
export async function fetchMyFanMail(): Promise<FanMailItem[]> {
  const me = (await supabase.auth.getUser()).data.user!.id;
  const { data, error } = await supabase
    .from('fan_mail')
    .select('id, user_id, kind, storage_path, note, paid, created_at, reviewed_at, sender:profiles!fan_mail_user_id_fkey(display_name)')
    .eq('user_id', me)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as unknown as FanMailItem[]) ?? [];
}

