import { base64ToArrayBuffer, type PickedImage } from '@/lib/posts';
import { supabase } from '@/lib/supabase';

/**
 * Flip to true when Stripe is wired (LLC + business bank done).
 * Until then, BUY explains that purchases open with the App Store
 * version — same hard-gate pattern as Fan Mail.
 */
export const SHOP_PAYMENTS_LIVE = false;

export type DropStatus = 'upcoming' | 'live' | 'sold_out';

export type Claim = {
  id: string;
  drop_id: string;
  user_id: string;
  edition_number: number;
  status: 'paid' | 'in_works' | 'shipped';
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

export function dropStatus(drop: Drop): DropStatus {
  if (new Date(drop.drops_at).getTime() > Date.now()) return 'upcoming';
  return drop.claims.length >= drop.run_size ? 'sold_out' : 'live';
}

export function remaining(drop: Drop): number {
  return Math.max(0, drop.run_size - drop.claims.length);
}

/** All drops (published for fans; drafts too for the artist), newest first. */
export async function fetchDrops(): Promise<Drop[]> {
  const [{ data: drops, error }, { data: claims, error: claimsError }] = await Promise.all([
    supabase.from('drops').select(DROP_COLUMNS).order('drop_number', { ascending: false }),
    supabase
      .from('drop_claims')
      .select(
        'id, drop_id, user_id, edition_number, status, owner:profiles!drop_claims_user_id_fkey(display_name, avatar_path, avatar_focus)'
      ),
  ]);
  if (error) throw error;
  if (claimsError) throw claimsError;

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
  const all = await fetchDrops();
  return all.find((d) => d.id === id) ?? null;
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
      drop_number: nextNumber,
      title: input.title,
      project: input.project,
      price_cents: input.priceCents,
      run_size: input.runSize,
      drops_at: input.dropsAt.toISOString(),
      image_path: imagePath,
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id as string;
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

/** Artist: mark a claim shipped (fires the tracking push to its owner). */
export async function markShipped(claimId: string, tracking: string): Promise<void> {
  const { error: fulfillError } = await supabase
    .from('drop_fulfillment')
    .upsert({ claim_id: claimId, tracking, shipped_at: new Date().toISOString() });
  if (fulfillError) throw fulfillError;
  const { error } = await supabase
    .from('drop_claims')
    .update({ status: 'shipped' })
    .eq('id', claimId);
  if (error) throw error;
}

export type Fulfillment = { address: string | null; tracking: string | null };

/**
 * Shipping details for a drop's claims. RLS trims the result server-side:
 * the artist gets every row, a fan gets only their own.
 */
export async function fetchFulfillment(claimIds: string[]): Promise<Record<string, Fulfillment>> {
  if (claimIds.length === 0) return {};
  const { data, error } = await supabase
    .from('drop_fulfillment')
    .select('claim_id, address, tracking')
    .in('claim_id', claimIds);
  if (error) throw error;
  const map: Record<string, Fulfillment> = {};
  for (const row of data ?? []) {
    map[row.claim_id as string] = {
      address: (row.address as string | null) ?? null,
      tracking: (row.tracking as string | null) ?? null,
    };
  }
  return map;
}
