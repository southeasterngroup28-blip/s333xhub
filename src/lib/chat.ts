import type { RealtimeChannel } from '@supabase/supabase-js';

import { cleanMessage } from '@/lib/profanity';
import { supabase } from '@/lib/supabase';

export type ChannelType = 'group' | 'dm';

/** One row in the chat list: a channel plus MY membership state for it. */
export type ChatListItem = {
  channelId: string;
  type: ChannelType;
  /** "Community" for the group chat; the other person's name for a DM. */
  title: string;
  mutedAt: string | null;
  leftAt: string | null;
};

export type Message = {
  id: string;
  channel_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  deleted_at: string | null;
  sender: { display_name: string } | null;
};

export const MESSAGE_PAGE_SIZE = 50;
export const MESSAGE_MAX_LENGTH = 1000;

/** Everything I'm a member of, with DM titles resolved to the other person. */
export async function fetchChatList(myUserId: string): Promise<ChatListItem[]> {
  const { data, error } = await supabase
    .from('channel_members')
    .select('channel_id, muted_at, left_at, channel:channels(id, type, created_at)')
    .eq('user_id', myUserId);
  if (error) throw error;

  type Row = {
    channel_id: string;
    muted_at: string | null;
    left_at: string | null;
    channel: { id: string; type: ChannelType; created_at: string } | null;
  };
  const rows = ((data as unknown as Row[]) ?? []).filter((r) => r.channel);

  // For DMs, look up who the other member is so we can show their name.
  const dmIds = rows.filter((r) => r.channel!.type === 'dm').map((r) => r.channel_id);
  const names: Record<string, string> = {};
  if (dmIds.length > 0) {
    const { data: others, error: othersError } = await supabase
      .from('channel_members')
      .select('channel_id, user_id, profile:profiles(display_name)')
      .in('channel_id', dmIds)
      .neq('user_id', myUserId);
    if (othersError) throw othersError;
    for (const other of (others as unknown as {
      channel_id: string;
      profile: { display_name: string } | null;
    }[]) ?? []) {
      names[other.channel_id] = other.profile?.display_name ?? 'Deleted user';
    }
  }

  const items = rows.map((r) => ({
    channelId: r.channel_id,
    type: r.channel!.type,
    title: r.channel!.type === 'group' ? 'S333XHUB' : names[r.channel_id] ?? 'DM',
    mutedAt: r.muted_at,
    leftAt: r.left_at,
  }));

  // Group chat first, then DMs alphabetically.
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'group' ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
  return items;
}

/**
 * Newest messages for a channel, newest FIRST (that's the order an
 * inverted chat list wants); pass `before` (the oldest loaded
 * created_at) to page further back in history.
 */
export async function fetchMessages(channelId: string, before?: string): Promise<Message[]> {
  let query = supabase
    .from('messages')
    .select('id, channel_id, sender_id, body, created_at, deleted_at, sender:profiles(display_name)')
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  if (before) {
    query = query.lt('created_at', before);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as Message[]) ?? [];
}

/** One message by id, with the sender's name (used for realtime arrivals). */
export async function fetchMessage(id: string): Promise<Message | null> {
  const { data, error } = await supabase
    .from('messages')
    .select('id, channel_id, sender_id, body, created_at, deleted_at, sender:profiles(display_name)')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Message | null;
}

/** Sends a message; profanity is masked before it's stored. */
export async function sendMessage(channelId: string, body: string): Promise<Message> {
  const cleaned = cleanMessage(body.trim());
  const { data, error } = await supabase
    .from('messages')
    .insert({
      channel_id: channelId,
      sender_id: (await supabase.auth.getUser()).data.user!.id,
      body: cleaned,
    })
    .select('id, channel_id, sender_id, body, created_at, deleted_at, sender:profiles(display_name)')
    .single();
  if (error) throw error;
  return data as unknown as Message;
}

/**
 * Live feed of new messages in a channel. Returns the subscription —
 * the caller MUST call supabase.removeChannel() on it when leaving.
 */
export function subscribeToMessages(
  channelId: string,
  onMessage: (message: Message) => void
): RealtimeChannel {
  const sub = supabase
    .channel(`messages-${channelId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `channel_id=eq.${channelId}` },
      async (payload) => {
        // The realtime payload has no joined sender name — fetch the
        // full row (also re-checks our read permission server-side).
        const full = await fetchMessage((payload.new as { id: string }).id);
        if (full && !full.deleted_at) onMessage(full);
      }
    )
    .subscribe();
  return sub;
}

/** Finds (or creates) my DM with the artist; returns its channel id. */
export async function getOrCreateDm(): Promise<string> {
  const { data, error } = await supabase.rpc('get_or_create_dm');
  if (error) throw error;
  return data as string;
}

async function updateMyMembership(
  channelId: string,
  myUserId: string,
  patch: { muted_at?: string | null; left_at?: string | null; last_read_at?: string }
): Promise<void> {
  const { error } = await supabase
    .from('channel_members')
    .update(patch)
    .eq('channel_id', channelId)
    .eq('user_id', myUserId);
  if (error) throw error;
}

export function setMuted(channelId: string, myUserId: string, muted: boolean) {
  return updateMyMembership(channelId, myUserId, {
    muted_at: muted ? new Date().toISOString() : null,
  });
}

export function setLeft(channelId: string, myUserId: string, left: boolean) {
  return updateMyMembership(channelId, myUserId, {
    left_at: left ? new Date().toISOString() : null,
  });
}

export function markRead(channelId: string, myUserId: string) {
  return updateMyMembership(channelId, myUserId, { last_read_at: new Date().toISOString() });
}
