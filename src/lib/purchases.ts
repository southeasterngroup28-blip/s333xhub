import { supabase } from '@/lib/supabase';

/**
 * The set of post ids this user has unlocked. Purchase rows are written
 * only by trusted server code (RevenueCat webhook, once Apple approves
 * the developer account) — the app can read them, never write them.
 */
export async function fetchMyPurchasedPostIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from('purchases').select('post_id');
  if (error) throw error;
  return new Set(((data as { post_id: string }[]) ?? []).map((row) => row.post_id));
}
