import { supabase } from '@/lib/supabase';

export const REACTION_EMOJIS = ['†', '🔥', '💀', '😭'] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

/** Per-post reaction state: counts per emoji + which ones are mine. */
export type ReactionSummary = {
  counts: Record<string, number>;
  mine: Set<string>;
};

export type SocialSummary = {
  reactions: Record<string, ReactionSummary>; // by post id
  commentCounts: Record<string, number>; // by post id
};

/** One round trip each for reactions and comment counts of a page of posts. */
export async function fetchSocialSummary(postIds: string[]): Promise<SocialSummary> {
  const empty: SocialSummary = { reactions: {}, commentCounts: {} };
  if (postIds.length === 0) return empty;
  const me = (await supabase.auth.getUser()).data.user?.id;

  const [reactionsRes, countsRes] = await Promise.all([
    supabase.from('post_reactions').select('post_id, user_id, emoji').in('post_id', postIds),
    supabase.rpc('comment_counts', { pids: postIds }),
  ]);
  if (reactionsRes.error) throw reactionsRes.error;
  if (countsRes.error) throw countsRes.error;

  const reactions: Record<string, ReactionSummary> = {};
  for (const row of (reactionsRes.data as { post_id: string; user_id: string; emoji: string }[]) ?? []) {
    const entry = (reactions[row.post_id] ??= { counts: {}, mine: new Set() });
    entry.counts[row.emoji] = (entry.counts[row.emoji] ?? 0) + 1;
    if (row.user_id === me) entry.mine.add(row.emoji);
  }

  const commentCounts: Record<string, number> = {};
  for (const row of (countsRes.data as { post_id: string; cnt: number }[]) ?? []) {
    commentCounts[row.post_id] = Number(row.cnt);
  }

  return { reactions, commentCounts };
}

/** Toggle my reaction; returns true if it's now on. */
export async function toggleReaction(postId: string, emoji: ReactionEmoji, isOn: boolean): Promise<boolean> {
  const me = (await supabase.auth.getUser()).data.user!.id;
  if (isOn) {
    const { error } = await supabase
      .from('post_reactions')
      .delete()
      .eq('post_id', postId)
      .eq('user_id', me)
      .eq('emoji', emoji);
    if (error) throw error;
    return false;
  }
  const { error } = await supabase
    .from('post_reactions')
    .insert({ post_id: postId, user_id: me, emoji });
  if (error && error.code !== '23505') throw error;
  return true;
}

// ---------------- Comments ----------------

export type Comment = {
  id: string;
  post_id: string;
  user_id: string;
  body: string;
  pinned: boolean;
  created_at: string;
  deleted_at: string | null;
  author: { display_name: string; role: string; status: string | null; avatar_path: string | null; avatar_focus: number | null } | null;
};

const COMMENT_SELECT =
  'id, post_id, user_id, body, pinned, created_at, deleted_at, author:profiles!post_comments_user_id_fkey(display_name, role, status, avatar_path, avatar_focus)';

export async function fetchComments(postId: string): Promise<Comment[]> {
  const { data, error } = await supabase
    .from('post_comments')
    .select(COMMENT_SELECT)
    .eq('post_id', postId)
    .is('deleted_at', null)
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data as unknown as Comment[]) ?? [];
}

export async function addComment(postId: string, body: string): Promise<Comment> {
  const me = (await supabase.auth.getUser()).data.user!.id;
  const { data, error } = await supabase
    .from('post_comments')
    .insert({ post_id: postId, user_id: me, body: body.trim() })
    .select(COMMENT_SELECT)
    .single();
  if (error) throw error;
  return data as unknown as Comment;
}

/** Artist: pin exactly one comment per post (unpins any other). */
export async function setPinned(comment: Comment, pinned: boolean): Promise<void> {
  if (pinned) {
    await supabase
      .from('post_comments')
      .update({ pinned: false })
      .eq('post_id', comment.post_id)
      .eq('pinned', true);
  }
  const { error } = await supabase
    .from('post_comments')
    .update({ pinned })
    .eq('id', comment.id);
  if (error) throw error;
}

/** Artist: soft-delete any comment. */
export async function deleteComment(commentId: string): Promise<void> {
  const { error } = await supabase
    .from('post_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', commentId);
  if (error) throw error;
}

// ---------------- Top 8 ----------------

export type TopFan = {
  position: number;
  user_id: string;
  profile: { display_name: string; avatar_path: string | null; avatar_focus: number | null } | null;
};

export async function fetchTopFans(): Promise<TopFan[]> {
  const { data, error } = await supabase
    .from('top_fans')
    .select('position, user_id, profile:profiles!top_fans_user_id_fkey(display_name, avatar_path, avatar_focus)')
    .order('position');
  if (error) throw error;
  return (data as unknown as TopFan[]) ?? [];
}

export async function setTopFan(position: number, userId: string): Promise<void> {
  // Clear both collision paths first: whoever held this slot, and this
  // fan's old slot - otherwise moving a fan between slots hits the
  // unique constraints.
  await supabase.from('top_fans').delete().or(`user_id.eq.${userId},position.eq.${position}`);
  const { error } = await supabase
    .from('top_fans')
    .upsert({ position, user_id: userId, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function removeTopFan(position: number): Promise<void> {
  const { error } = await supabase.from('top_fans').delete().eq('position', position);
  if (error) throw error;
}

/**
 * Fan search for the Top 8 picker: an empty query lists fans A→Z,
 * and every typed letter narrows the list (Instagram-style).
 */
export async function searchProfiles(query: string): Promise<{ id: string; display_name: string }[]> {
  let request = supabase
    .from('profiles')
    .select('id, display_name')
    .neq('role', 'artist')
    .order('display_name')
    .limit(20);
  if (query.trim()) {
    request = request.ilike('display_name', `%${query.trim()}%`);
  }
  const { data, error } = await request;
  if (error) throw error;
  return (data as { id: string; display_name: string }[]) ?? [];
}

// ---------------- Polls ----------------

export type PollOption = { id: string; label: string; position: number; votes: number };
export type PollState = {
  post_id: string;
  ends_at: string | null;
  options: PollOption[];
  totalVotes: number;
  myOptionId: string | null;
};

export async function fetchPolls(postIds: string[]): Promise<Record<string, PollState>> {
  if (postIds.length === 0) return {};
  const me = (await supabase.auth.getUser()).data.user?.id;

  const [pollsRes, optionsRes, votesRes] = await Promise.all([
    supabase.from('polls').select('post_id, ends_at').in('post_id', postIds),
    supabase.from('poll_options').select('id, post_id, label, position').in('post_id', postIds),
    supabase.from('poll_votes').select('post_id, option_id, user_id').in('post_id', postIds),
  ]);
  if (pollsRes.error) throw pollsRes.error;
  if (optionsRes.error) throw optionsRes.error;
  if (votesRes.error) throw votesRes.error;

  const result: Record<string, PollState> = {};
  for (const poll of (pollsRes.data as { post_id: string; ends_at: string | null }[]) ?? []) {
    result[poll.post_id] = {
      post_id: poll.post_id,
      ends_at: poll.ends_at,
      options: [],
      totalVotes: 0,
      myOptionId: null,
    };
  }
  for (const option of (optionsRes.data as { id: string; post_id: string; label: string; position: number }[]) ?? []) {
    result[option.post_id]?.options.push({ ...option, votes: 0 });
  }
  for (const vote of (votesRes.data as { post_id: string; option_id: string; user_id: string }[]) ?? []) {
    const poll = result[vote.post_id];
    if (!poll) continue;
    poll.totalVotes += 1;
    const option = poll.options.find((o) => o.id === vote.option_id);
    if (option) option.votes += 1;
    if (vote.user_id === me) poll.myOptionId = vote.option_id;
  }
  for (const poll of Object.values(result)) {
    poll.options.sort((a, b) => a.position - b.position);
  }
  return result;
}

export async function votePoll(postId: string, optionId: string): Promise<void> {
  const me = (await supabase.auth.getUser()).data.user!.id;
  const { error } = await supabase
    .from('poll_votes')
    .upsert({ post_id: postId, option_id: optionId, user_id: me });
  if (error) throw error;
}

/** Artist: create the poll rows for a freshly created poll post. */
export async function createPollForPost(
  postId: string,
  optionLabels: string[],
  endsAt: Date | null
): Promise<void> {
  const { error: pollError } = await supabase
    .from('polls')
    .insert({ post_id: postId, ends_at: endsAt ? endsAt.toISOString() : null });
  if (pollError) throw pollError;
  const { error: optionsError } = await supabase.from('poll_options').insert(
    optionLabels.map((label, index) => ({ post_id: postId, label: label.trim(), position: index }))
  );
  if (optionsError) throw optionsError;
}

