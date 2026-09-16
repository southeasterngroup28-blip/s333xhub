import { uploadWithProgress, type UploadHandle } from '@/lib/posts';
import { supabase, requireUserId } from '@/lib/supabase';

/** Kept for the option of charging later; unused while fan mail is free. */
export const FAN_MAIL_PRICE_CENTS = 1000;

/**
 * Owner decision 2026-09-01: fan mail is FREE. Submissions go straight
 * through — no paywall. If a price ever comes back, flip this to false
 * and re-wire the charge (RevenueCat).
 */
export const FAN_MAIL_IS_FREE = true;

/** One submission per week (also enforced by the database). */
export const FAN_MAIL_COOLDOWN_DAYS = 7;

/**
 * When this fan may send again, based on their own history —
 * null means they're clear to send right now.
 */
export function nextFanMailAt(items: { created_at: string }[]): Date | null {
  const latest = items[0];
  if (!latest) return null;
  const next = new Date(
    new Date(latest.created_at).getTime() + FAN_MAIL_COOLDOWN_DAYS * 24 * 3600 * 1000
  );
  return next.getTime() > Date.now() ? next : null;
}

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

export type SubmitFanMailOptions = {
  /** 0..1 as the file streams up; 1 means the upload is done and the record is being written. */
  onProgress?: (fraction: number) => void;
  /** Receives the in-flight upload's cancel handle (phone uploads only). */
  onUpload?: (handle: UploadHandle) => void;
};

/**
 * Uploads the file, then writes the fan_mail row. Resolves to that row as
 * the list renders it, so the screen can show this week's cooldown at once
 * instead of waiting on a refetch.
 */
export async function submitFanMail(
  kind: FanMailKind,
  item: { file?: Blob; uri?: string; mimeType: string; name: string },
  note: string,
  options?: SubmitFanMailOptions
): Promise<FanMailItem> {
  const me = await requireUserId();
  const extension = item.name.includes('.') ? item.name.split('.').pop()! : 'bin';
  const path = `${me}/${Date.now()}.${extension}`;

  // A phone upload streams straight from disk with byte progress in a
  // background session (survives an app switch); a web File goes up as
  // one step. Either way a non-2xx throws before any row is written.
  await uploadWithProgress(
    'fan-mail',
    path,
    item.file ? { file: item.file } : { uri: item.uri },
    item.mimeType,
    (sent, total) => options?.onProgress?.(total > 0 ? Math.min(sent / total, 1) : 0),
    { onHandle: options?.onUpload }
  );
  options?.onProgress?.(1);

  const { data: row, error } = await supabase
    .from('fan_mail')
    .insert({
      user_id: me,
      kind,
      storage_path: path,
      note: note.trim() || null,
    })
    .select('id, user_id, kind, storage_path, note, paid, created_at, reviewed_at')
    .single();
  if (error) {
    // Rejected insert (e.g. the once-a-week rule) must not strand the upload.
    supabase.storage.from('fan-mail').remove([path]).then(undefined, () => {});
    if ((error.message ?? '').includes('row-level security')) {
      throw new Error("You've already sent this week's submission - one per week.");
    }
    throw error;
  }

  // Deliver to the artist's private inbox. Nothing displays in-app; if the
  // email function isn't deployed yet this fails silently and the row +
  // file still exist for a manual re-send.
  // Deployed under the dashboard's default slug "swift-function".
  await supabase.functions
    .invoke('swift-function', { body: { fan_mail_id: row.id } })
    .catch(() => {});

  return { ...(row as Omit<FanMailItem, 'sender'>), sender: null };
}

/** My own submissions (fans) — newest first. */
export async function fetchMyFanMail(): Promise<FanMailItem[]> {
  const me = await requireUserId();
  const { data, error } = await supabase
    .from('fan_mail')
    .select('id, user_id, kind, storage_path, note, paid, created_at, reviewed_at, sender:profiles!fan_mail_user_id_fkey(display_name)')
    .eq('user_id', me)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data as unknown as FanMailItem[]) ?? [];
}

