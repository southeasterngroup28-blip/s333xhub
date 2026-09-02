import { base64ToArrayBuffer, type PickedImage } from '@/lib/posts';
import { supabase, requireUserId } from '@/lib/supabase';

/**
 * Flip to true when Stripe is wired (LLC + business bank done).
 * Until then, BUY explains that purchases open with the App Store
 * version — same hard-gate pattern as Fan Mail.
 */
export const SHOP_PAYMENTS_LIVE = false;

/**
 * Submission-day switch: false turns the dock's shop bubble back into
 * the dimmed "coming soon" teaser (App Review must never see a BUY
 * button that can't complete — guideline 2.1).
 */
export const SHOP_TAB_LIVE = true;

/** "$65" for whole-dollar prices, "$64.99" otherwise — never rounds. */
export function priceLabel(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

export type DropStatus = 'upcoming' | 'live' | 'sold_out';

export type Claim = {
  id: string;
  drop_id: string;
  user_id: string;
  edition_number: number;
  status: 'hold' | 'paid' | 'in_works' | 'shipped' | 'refunded';
  expires_at: string | null;
  owner: { display_name: string; avatar_path: string | null; avatar_focus: number | null } | null;
};

export type Drop = {
  id: string;
  drop_number: number;
  title: string;
  project: 'mazze' | 's333xgod';
  price_cents: number;
  run_size: number;
  drops_at: string;
  image_path: string | null;
  is_published: boolean;
  created_at: string;
  claims: Claim[];
};

const DROP_COLUMNS =
  'id, drop_number, title, project, price_cents, run_size, drops_at, image_path, is_published, created_at';

export function dropImageUrl(path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from('shop-media').getPublicUrl(path).data.publicUrl;
}

/** Claims that block a number: live holds + everything paid-and-beyond. */
export function activeClaims(drop: Drop): Claim[] {
  const now = serverNowMs();
  return drop.claims.filter(
    (c) =>
      c.status !== 'refunded' &&
      (c.status !== 'hold' || (c.expires_at != null && new Date(c.expires_at).getTime() > now))
  );
}

/** Claims that are real ownership — what the registry and stats show. */
export function ownerClaims(drop: Drop): Claim[] {
  return drop.claims.filter(
    (c) => c.status === 'paid' || c.status === 'in_works' || c.status === 'shipped'
  );
}

export function dropStatus(drop: Drop): DropStatus {
  if (new Date(drop.drops_at).getTime() > serverNowMs()) return 'upcoming';
  return activeClaims(drop).length >= drop.run_size ? 'sold_out' : 'live';
}

export function remaining(drop: Drop): number {
  return Math.max(0, drop.run_size - activeClaims(drop).length);
}

/** All drops (published for fans; drafts too for the artist), newest first. */
export async function fetchDrops(): Promise<Drop[]> {
  const [{ data: drops, error }, { data: claims, error: claimsError }] = await Promise.all([
    supabase.from('drops').select(DROP_COLUMNS).order('drop_number', { ascending: false }),
    supabase
      .from('drop_claims')
      .select(
        'id, drop_id, user_id, edition_number, status, expires_at, owner:profiles!drop_claims_user_id_fkey(display_name, avatar_path, avatar_focus)'
      ),
  ]);
  if (error) throw error;
  if (claimsError) throw claimsError;
  syncServerClock();

  const byDrop = new Map<string, Claim[]>();
  for (const claim of (claims as unknown as Claim[]) ?? []) {
    const list = byDrop.get(claim.drop_id) ?? [];
    list.push(claim);
    byDrop.set(claim.drop_id, list);
  }
  return ((drops as unknown as Omit<Drop, 'claims'>[]) ?? []).map((d) => ({
    ...d,
    claims: (byDrop.get(d.id) ?? []).sort((a, b) => a.edition_number - b.edition_number),
  }));
}

export async function fetchDrop(id: string): Promise<Drop | null> {
  const [{ data: drop, error }, { data: claims, error: claimsError }] = await Promise.all([
    supabase.from('drops').select(DROP_COLUMNS).eq('id', id).maybeSingle(),
    supabase
      .from('drop_claims')
      .select(
        'id, drop_id, user_id, edition_number, status, expires_at, owner:profiles!drop_claims_user_id_fkey(display_name, avatar_path, avatar_focus)'
      )
      .eq('drop_id', id),
  ]);
  if (error) throw error;
  if (claimsError) throw claimsError;
  if (!drop) return null;
  syncServerClock();
  return {
    ...(drop as unknown as Omit<Drop, 'claims'>),
    claims: ((claims as unknown as Claim[]) ?? []).sort(
      (a, b) => a.edition_number - b.edition_number
    ),
  };
}

// ---- server clock: countdowns and hold expiries follow the DATABASE's
// ---- clock, not the phone's (device clocks drift).
let clockOffsetMs = 0;
export function serverNowMs(): number {
  return Date.now() + clockOffsetMs;
}
function syncServerClock(): void {
  supabase
    .rpc('server_now')
    .then(({ data }) => {
      if (data) clockOffsetMs = new Date(data as string).getTime() - Date.now();
    })
    .then(undefined, () => {});
}

/** Artist: create a drop as a draft (publish is the go-live moment). */
export async function createDrop(input: {
  title: string;
  project: 'mazze' | 's333xgod';
  priceCents: number;
  runSize: number;
  dropsAt: Date;
  image?: PickedImage | null;
}): Promise<string> {
  const { data: maxRow } = await supabase
    .from('drops')
    .select('drop_number')
    .order('drop_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextNumber = (maxRow?.drop_number ?? 0) + 1;

  let imagePath: string | null = null;
  if (input.image) {
    const ext = input.image.mimeType === 'image/png' ? 'png' : 'jpg';
    imagePath = `drops/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from('shop-media')
      .upload(imagePath, input.image.file ?? base64ToArrayBuffer(input.image.base64!), {
        contentType: input.image.mimeType,
      });
    if (uploadError) throw uploadError;
  }

  const { data, error } = await supabase
    .from('drops')
    .insert({
      drop_number: nextNumber,  // eslint-disable-line
      title: input.title,
      project: input.project,
      price_cents: input.priceCents,
      run_size: input.runSize,
      drops_at: input.dropsAt.toISOString(),
      image_path: imagePath,
    })
    .select('id')
    .single();
  if (error) {
    // Don't strand the uploaded artwork if the row insert failed.
    if (imagePath) {
      supabase.storage.from('shop-media').remove([imagePath]).then(undefined, () => {});
    }
    throw error;
  }
  return data.id as string;
}

/** Artist: edit a DRAFT's basics (published drops stay immutable). */
export async function updateDrop(
  id: string,
  patch: { title: string; priceCents: number; runSize: number; dropsAt: Date }
): Promise<void> {
  const { data, error } = await supabase
    .from('drops')
    .update({
      title: patch.title,
      price_cents: patch.priceCents,
      run_size: patch.runSize,
      drops_at: patch.dropsAt.toISOString(),
    })
    .eq('id', id)
    .eq('is_published', false)
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error('Published drops are locked - only drafts can be edited.');
  }
}

export type MyPiece = {
  id: string;
  edition_number: number;
  status: Claim['status'];
  drop: { id: string; drop_number: number; title: string; image_path: string | null } | null;
};

/** Everything this fan owns, across every drop — for the My Pieces list. */
export async function fetchMyPieces(): Promise<MyPiece[]> {
  const userId = await requireUserId();
  const { data, error } = await supabase
    .from('drop_claims')
    .select('id, edition_number, status, drop:drops(id, drop_number, title, image_path)')
    .eq('user_id', userId)
    .in('status', ['paid', 'in_works', 'shipped'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as unknown as MyPiece[]) ?? [];
}

/** Artist: the go-live switch. Publishing fires the drop push to every fan. */
export async function publishDrop(id: string): Promise<void> {
  const { error } = await supabase.from('drops').update({ is_published: true }).eq('id', id);
  if (error) throw error;
}

export async function deleteDrop(id: string): Promise<void> {
  const { error } = await supabase.from('drops').delete().eq('id', id);
  if (error) throw error;
}

/** Artist: mark a claim shipped — one atomic step server-side. */
export async function markShipped(claimId: string, tracking: string): Promise<void> {
  const { error } = await supabase.rpc('mark_claim_shipped', {
    p_claim: claimId,
    p_tracking: tracking,
  });
  if (error) throw error;
}

export type Fulfillment = { address: string | null; tracking: string | null };

/**
 * Shipping details for a drop's claims. RLS trims the result server-side:
 * the artist gets every row, a fan gets only their own.
 */
export async function fetchFulfillment(claimIds: string[]): Promise<Record<string, Fulfillment>> {
  const map: Record<string, Fulfillment> = {};
  // Chunked: a big run's worth of UUIDs won't fit in one querystring.
  for (let i = 0; i < claimIds.length; i += 100) {
    const { data, error } = await supabase
      .from('drop_fulfillment')
      .select('claim_id, address, tracking')
      .in('claim_id', claimIds.slice(i, i + 100));
    if (error) throw error;
    for (const row of data ?? []) {
      map[row.claim_id as string] = {
        address: (row.address as string | null) ?? null,
        tracking: (row.tracking as string | null) ?? null,
      };
    }
  }
  return map;
}
