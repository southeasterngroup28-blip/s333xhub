import { supabase, requireUserId } from '@/lib/supabase';

export type ReportTargetType = 'post' | 'message' | 'user' | 'comment';

export type Report = {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  target_id: string;
  reason: string;
  created_at: string;
  resolved_at: string | null;
  reporter: { display_name: string } | null;
};

export const REPORT_REASONS = ['Spam', 'Abuse or harassment', 'Inappropriate content', 'Other'];

/** The set of user ids I've blocked (used to hide their messages). */
export async function fetchBlockedIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from('blocks').select('blocked_id');
  if (error) throw error;
  return new Set(((data as { blocked_id: string }[]) ?? []).map((b) => b.blocked_id));
}

export async function blockUser(blockedId: string): Promise<void> {
  const me = await requireUserId();
  const { error } = await supabase
    .from('blocks')
    .insert({ blocker_id: me, blocked_id: blockedId });
  // Blocking someone twice is fine — ignore the duplicate error.
  if (error && error.code !== '23505') throw error;
}

export async function unblockUser(blockedId: string): Promise<void> {
  const me = await requireUserId();
  const { error } = await supabase
    .from('blocks')
    .delete()
    .eq('blocker_id', me)
    .eq('blocked_id', blockedId);
  if (error) throw error;
}

/** My block list with names, for the settings screen. */
export async function fetchBlockedUsers(): Promise<{ id: string; name: string }[]> {
  const { data, error } = await supabase
    .from('blocks')
    .select('blocked_id, profile:profiles!blocks_blocked_id_fkey(display_name)');
  if (error) throw error;
  return (
    (data as unknown as { blocked_id: string; profile: { display_name: string } | null }[]) ?? []
  ).map((row) => ({ id: row.blocked_id, name: row.profile?.display_name ?? 'Unknown user' }));
}

export async function fileReport(
  targetType: ReportTargetType,
  targetId: string,
  reason: string
): Promise<void> {
  const me = await requireUserId();
  const { error } = await supabase
    .from('reports')
    .insert({ reporter_id: me, target_type: targetType, target_id: targetId, reason });
  if (error) throw error;
}

/** Open reports, newest first (artist only — RLS enforces that). */
export async function fetchOpenReports(): Promise<Report[]> {
  const { data, error } = await supabase
    .from('reports')
    .select('id, reporter_id, target_type, target_id, reason, created_at, resolved_at, reporter:profiles!reports_reporter_id_fkey(display_name)')
    .is('resolved_at', null)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as Report[]) ?? [];
}

export async function resolveReport(reportId: string): Promise<void> {
  const { error } = await supabase
    .from('reports')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', reportId);
  if (error) throw error;
}

/** Artist: soft-delete any message (hidden from everyone, kept as evidence). */
export async function deleteMessage(messageId: string): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', messageId);
  if (error) throw error;
}

/** Friendly copy for the paid-post delete guard (the DB refuses with PROTECTED_POST). */
export function paidPostBlockedMessage(buyers?: number): string {
  const who = buyers && buyers > 0 ? `${buyers} fan${buyers === 1 ? '' : 's'}` : 'Fans';
  return `${who} paid for this post. Paid posts with buyers can't be deleted.`;
}

/** Artist: how many fans have paid to unlock a post (artist-only RPC). */
export async function countPostBuyers(postId: string): Promise<number> {
  const { data, error } = await supabase.rpc('count_post_buyers', { post: postId });
  if (error) throw error;
  return (data as number | null) ?? 0;
}

/** Artist: delete a post (its media rows cascade; files stay in storage for now). */
export async function deletePost(postId: string): Promise<void> {
  const { error } = await supabase.from('posts').delete().eq('id', postId);
  if (error) {
    // The DB blocks deleting a paid post fans have bought — never surface the raw trigger error.
    if (error.message?.includes('PROTECTED_POST')) throw new Error(paidPostBlockedMessage());
    throw error;
  }
}

/** Artist: bans (banned=true) or unbans a user — banned accounts see a suspended screen. */
export async function banUser(targetUserId: string, banned: boolean): Promise<void> {
  const { error } = await supabase.rpc('ban_user', { target_user: targetUserId, banned });
  if (error) throw error;
}

/** banned_at per user id, so the reports screen can show Ban vs Unban. */
export async function fetchBannedAt(userIds: string[]): Promise<Map<string, string | null>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, banned_at')
    .in('id', userIds);
  if (error) throw error;
  return new Map(
    ((data as { id: string; banned_at: string | null }[]) ?? []).map((r) => [r.id, r.banned_at])
  );
}

/** Fetches a short human-readable preview of whatever a report points at. */
export async function fetchReportTargetPreview(report: Report): Promise<string> {
  try {
    if (report.target_type === 'post') {
      const { data } = await supabase
        .from('posts')
        .select('kind, body, title')
        .eq('id', report.target_id)
        .maybeSingle();
      if (!data) return '(post no longer exists)';
      return data.title || data.body || `(${data.kind} post)`;
    }
    if (report.target_type === 'comment') {
      const { data } = await supabase
        .from('post_comments')
        .select('body, deleted_at, author:profiles!post_comments_user_id_fkey(display_name)')
        .eq('id', report.target_id)
        .maybeSingle();
      if (!data) return '(comment no longer exists)';
      const author = (data as unknown as { author: { display_name: string } | null }).author
        ?.display_name;
      return `${author ?? 'Unknown'} commented: ${data.body}${data.deleted_at ? ' (already deleted)' : ''}`;
    }
    if (report.target_type === 'message') {
      const { data } = await supabase
        .from('messages')
        .select('body, deleted_at, sender:profiles(display_name)')
        .eq('id', report.target_id)
        .maybeSingle();
      if (!data) return '(message no longer exists)';
      const sender = (data as unknown as { sender: { display_name: string } | null }).sender
        ?.display_name;
      return `${sender ?? 'Unknown'}: ${data.body}${data.deleted_at ? ' (already deleted)' : ''}`;
    }
    const { data } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', report.target_id)
      .maybeSingle();
    return data ? `User: ${data.display_name}` : '(user no longer exists)';
  } catch {
    return '(could not load preview)';
  }
}

/** Permanently deletes the signed-in fan's account and all their data. */
export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw error;
}
