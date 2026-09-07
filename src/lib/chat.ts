import type { RealtimeChannel } from '@supabase/supabase-js';

import { base64ToArrayBuffer, filePayload } from '@/lib/posts';
import { cleanMessage } from '@/lib/profanity';
import { supabase, requireUserId } from '@/lib/supabase';

export type ChannelType = 'group' | 'dm';

/** Just enough of a profile to draw a face and a name. */
export type ChatPerson = {
  id: string;
  display_name: string;
  avatar_path: string | null;
  avatar_focus: number | null;
  role: string;
};

/** The newest message in a channel, trimmed down for the list row. */
export type ChatPreview = {
  body: string;
  kind: MessageKind;
  senderId: string;
  senderName: string | null;
  createdAt: string;
};

/** One row in the chat list: a channel plus MY membership state for it. */
export type ChatListItem = {
  channelId: string;
  type: ChannelType;
  /** "S333XHUB" for the group chat; the other person's name for a DM. */
  title: string;
  mutedAt: string | null;
  leftAt: string | null;
  /** People still in the room (group only; null when the count is unknown). */
  memberCount: number | null;
  /**
   * Who to draw for the row: a DM has the other person; the group has the
   * artist first, then the most recent fan to speak (when previews are on).
   */
  faces: ChatPerson[];
  /** Newest message, for the preview line (only with `previews`). */
  lastMessage: ChatPreview | null;
  /** Messages from other people since I last opened it (only with `previews`). */
  unreadCount: number;
};

export type MessageKind = 'text' | 'gif' | 'voice' | 'image';

export type Message = {
  id: string;
  channel_id: string;
  sender_id: string;
  body: string;
  kind: MessageKind;
  /** Storage path for voice/image files (needs a signed URL to view). */
  media_path: string | null;
  /** Direct URL for GIFs. */
  media_url: string | null;
  duration_seconds: number | null;
  created_at: string;
  deleted_at: string | null;
  sender: {
    display_name: string;
    role: string;
    status: string | null;
    avatar_path: string | null;
    avatar_focus: number | null;
  } | null;
};

export const MESSAGE_PAGE_SIZE = 50;
export const MESSAGE_MAX_LENGTH = 1000;
export const VOICE_MAX_SECONDS = 60;

const MESSAGE_COLUMNS =
  'id, channel_id, sender_id, body, kind, media_path, media_url, duration_seconds, created_at, deleted_at, sender:profiles(display_name, role, status, avatar_path, avatar_focus)';

const PERSON_COLUMNS = 'id, display_name, avatar_path, avatar_focus, role';

/** The one artist account, for the group row's avatar cluster. */
async function fetchArtistPerson(): Promise<ChatPerson | null> {
  const { data } = await supabase
    .from('profiles')
    .select(PERSON_COLUMNS)
    .eq('role', 'artist')
    .limit(1)
    .maybeSingle();
  return (data as unknown as ChatPerson | null) ?? null;
}

/** How many people are still in a channel (haven't left). */
async function fetchMemberCount(channelId: string): Promise<number | null> {
  const { count, error } = await supabase
    .from('channel_members')
    .select('user_id', { count: 'exact', head: true })
    .eq('channel_id', channelId)
    .is('left_at', null);
  if (error) return null;
  return count ?? null;
}

type PreviewRow = {
  body: string;
  kind: MessageKind;
  sender_id: string;
  created_at: string;
  sender: ChatPerson | null;
};

/**
 * The ids I've blocked as a PostgREST list — "(a,b,c)" for
 * `.not('sender_id', 'in', …)` — or null when there's nobody to exclude.
 */
function blockedSenderList(blockedIds: Set<string> | undefined): string | null {
  if (!blockedIds || blockedIds.size === 0) return null;
  return `(${[...blockedIds].join(',')})`;
}

/**
 * The newest few messages in a channel: [0] becomes the preview, and for
 * the group the first fan among them becomes the second face in the cluster.
 * Blocked senders are left out at the query so the limit still returns the
 * newest messages I can actually see.
 */
async function fetchRecentMessages(
  channelId: string,
  limit: number,
  blockedList: string | null
): Promise<PreviewRow[]> {
  let query = supabase
    .from('messages')
    .select(`body, kind, sender_id, created_at, sender:profiles(${PERSON_COLUMNS})`)
    .eq('channel_id', channelId)
    .is('deleted_at', null);
  if (blockedList) query = query.not('sender_id', 'in', blockedList);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
  if (error) return [];
  return (data as unknown as PreviewRow[]) ?? [];
}

/**
 * Messages from other people (not blocked ones) since my read marker — all
 * of them if I never opened it.
 */
async function fetchUnreadCount(
  channelId: string,
  myUserId: string,
  lastReadAt: string | null,
  blockedList: string | null
): Promise<number> {
  let query = supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .neq('sender_id', myUserId);
  if (lastReadAt) query = query.gt('created_at', lastReadAt);
  if (blockedList) query = query.not('sender_id', 'in', blockedList);
  const { count, error } = await query;
  if (error) return 0;
  return count ?? 0;
}

/**
 * Everything I'm a member of, with DM titles resolved to the other person.
 * Pass `previews: true` (the chat list does) to also load each row's last
 * message and unread count — the conversation screen skips that work.
 * Pass `blockedIds` (see fetchBlockedIds) so nobody I've blocked shows up
 * in a preview, a face, or an unread count.
 */
export async function fetchChatList(
  myUserId: string,
  options: { previews?: boolean; blockedIds?: Set<string> } = {}
): Promise<ChatListItem[]> {
  const blockedList = blockedSenderList(options.blockedIds);
  const isBlocked = (senderId: string) => options.blockedIds?.has(senderId) ?? false;

  const { data, error } = await supabase
    .from('channel_members')
    .select('channel_id, muted_at, left_at, last_read_at, channel:channels(id, type, created_at)')
    .eq('user_id', myUserId);
  if (error) throw error;

  type Row = {
    channel_id: string;
    muted_at: string | null;
    left_at: string | null;
    last_read_at: string | null;
    channel: { id: string; type: ChannelType; created_at: string } | null;
  };
  const rows = ((data as unknown as Row[]) ?? []).filter((r) => r.channel);

  // For DMs, look up who the other member is so we can show their name and face.
  const dmIds = rows.filter((r) => r.channel!.type === 'dm').map((r) => r.channel_id);
  const others: Record<string, ChatPerson | null> = {};
  if (dmIds.length > 0) {
    const { data: members, error: othersError } = await supabase
      .from('channel_members')
      .select(`channel_id, user_id, profile:profiles(${PERSON_COLUMNS})`)
      .in('channel_id', dmIds)
      .neq('user_id', myUserId);
    if (othersError) throw othersError;
    for (const other of (members as unknown as {
      channel_id: string;
      profile: ChatPerson | null;
    }[]) ?? []) {
      others[other.channel_id] = other.profile ?? null;
    }
  }

  const hasGroup = rows.some((r) => r.channel!.type === 'group');
  const artist = hasGroup ? await fetchArtistPerson().catch(() => null) : null;

  // The extras are best-effort: a failed count or preview must never take
  // the whole list down with it.
  const items = await Promise.all(
    rows.map(async (r): Promise<ChatListItem> => {
      const type = r.channel!.type;
      const other = type === 'dm' ? others[r.channel_id] ?? null : null;
      const faces: ChatPerson[] = type === 'dm' ? (other ? [other] : []) : artist ? [artist] : [];

      let memberCount: number | null = null;
      let lastMessage: ChatPreview | null = null;
      let unreadCount = 0;

      const [count, fetched, unread] = await Promise.all([
        type === 'group' ? fetchMemberCount(r.channel_id).catch(() => null) : Promise.resolve(null),
        options.previews
          ? fetchRecentMessages(r.channel_id, type === 'group' ? 8 : 1, blockedList).catch(() => [])
          : Promise.resolve([] as PreviewRow[]),
        options.previews
          ? fetchUnreadCount(r.channel_id, myUserId, r.last_read_at, blockedList).catch(() => 0)
          : Promise.resolve(0),
      ]);
      memberCount = count;
      unreadCount = unread;
      // The query already excludes blocked senders; this is the belt to its
      // braces, so a blocked person can never become the preview or a face.
      const recent = fetched.filter((m) => !isBlocked(m.sender_id));
      if (recent[0]) {
        lastMessage = {
          body: recent[0].body,
          kind: recent[0].kind,
          senderId: recent[0].sender_id,
          senderName: recent[0].sender?.display_name ?? null,
          createdAt: recent[0].created_at,
        };
      }
      if (type === 'group') {
        const fan = recent.find((m) => m.sender && m.sender.role !== 'artist')?.sender;
        if (fan) faces.push(fan);
      }

      return {
        channelId: r.channel_id,
        type,
        title: type === 'group' ? 'S333XHUB' : other?.display_name ?? (r.channel_id in others ? 'Deleted user' : 'DM'),
        mutedAt: r.muted_at,
        leftAt: r.left_at,
        memberCount,
        faces,
        lastMessage,
        unreadCount,
      };
    })
  );

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
    .select(MESSAGE_COLUMNS)
    .eq('channel_id', channelId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  if (before) {
    query = query.lte('created_at', before);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data as unknown as Message[]) ?? [];
}

/** One message by id, with the sender's name (used for realtime arrivals). */
export async function fetchMessage(id: string): Promise<Message | null> {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_COLUMNS)
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
      sender_id: await requireUserId(),
      body: cleaned,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as Message;
}

/** Sends a GIF picked from search (we store its URL, not the file). */
export async function sendGifMessage(channelId: string, gifUrl: string): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({
      channel_id: channelId,
      sender_id: await requireUserId(),
      body: '',
      kind: 'gif',
      media_url: gifUrl,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as Message;
}

/**
 * Uploads a voice note or picture, then sends the message pointing at it.
 * Files live at <my user id>/<channel id>/<timestamped name> so storage
 * rules can verify both the sender and the room.
 */
export async function sendMediaMessage(
  channelId: string,
  kind: 'voice' | 'image',
  media: { uri?: string; file?: Blob; base64?: string; mimeType: string },
  durationSeconds?: number
): Promise<Message> {
  const userId = await requireUserId();
  const ext = kind === 'voice' ? 'm4a' : media.mimeType.includes('png') ? 'png' : 'jpg';
  const path = `${userId}/${channelId}/${Date.now()}.${ext}`;

  const payload = media.base64 ? base64ToArrayBuffer(media.base64) : await filePayload(media);
  const { error: uploadError } = await supabase.storage
    .from('chat-media')
    .upload(path, payload, { contentType: media.mimeType });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('messages')
    .insert({
      channel_id: channelId,
      sender_id: userId,
      body: '',
      kind,
      media_path: path,
      duration_seconds: durationSeconds ?? null,
    })
    .select(MESSAGE_COLUMNS)
    .single();
  if (error) throw error;
  return data as unknown as Message;
}

/** storage path → temporary viewing URL, for voice notes and pictures. */
const chatUrlMemo = new Map<string, { url: string; expiresAt: number }>();

export async function chatMediaUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const now = Date.now();
  const map: Record<string, string> = {};
  const missing: string[] = [];
  for (const path of paths) {
    const hit = chatUrlMemo.get(path);
    if (hit && hit.expiresAt > now + 30 * 60 * 1000) map[path] = hit.url;
    else missing.push(path);
  }
  if (missing.length === 0) return map;
  const { data, error } = await supabase.storage.from('chat-media').createSignedUrls(missing, 86400);
  if (error) throw error;
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) {
      map[row.path] = row.signedUrl;
      chatUrlMemo.set(row.path, { url: row.signedUrl, expiresAt: now + 86400 * 1000 });
    }
  }
  return map;
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

/**
 * Live "something happened" feed for the chat LIST: fires whenever a new
 * message lands in any channel I can see (RLS filters the rest), so the
 * list can refresh its previews and unread counts. The caller MUST call
 * supabase.removeChannel() on the result when leaving.
 */
export function subscribeToChatActivity(onActivity: () => void): RealtimeChannel {
  return supabase
    .channel('chat-list-activity')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      () => onActivity()
    )
    .subscribe();
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
