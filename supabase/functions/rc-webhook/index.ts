// RevenueCat webhook: the ONLY writer of purchase rows.
// RC calls this on every purchase event; we verify the shared secret,
// validate the product tier against the post's price, and record the
// unlock. The client never writes its own "I paid" row.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// product id → price the post must have for this unlock to count
const TIER_CENTS: Record<string, number> = {
  unlock_tier_499: 499,
  unlock_tier_999: 999,
  unlock_tier_1499: 1499,
  unlock_tier_1999: 1999,
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // RevenueCat sends the configured Authorization header on every call.
  const auth = req.headers.get('authorization') ?? '';
  const secret = Deno.env.get('RC_WEBHOOK_SECRET') ?? '';
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401, headers: corsHeaders });
  }

  let event: Record<string, unknown>;
  try {
    const body = await req.json();
    event = (body?.event ?? {}) as Record<string, unknown>;
  } catch {
    return new Response('bad json', { status: 400, headers: corsHeaders });
  }

  const type = String(event.type ?? '');
  const productId = String(event.product_id ?? '');
  const appUserId = String(event.app_user_id ?? '');
  // Consumable purchases arrive as NON_RENEWING_PURCHASE.
  if (type !== 'NON_RENEWING_PURCHASE' || !(productId in TIER_CENTS)) {
    return new Response('ignored', { status: 200, headers: corsHeaders });
  }

  // Which post? The app stamps it as a subscriber attribute right
  // before purchasing.
  const attrs = (event.subscriber_attributes ?? {}) as Record<string, { value?: string }>;
  const postId = attrs.pending_post_id?.value ?? '';
  const uuidish = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidish.test(postId) || !uuidish.test(appUserId)) {
    return new Response('missing target', { status: 200, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // The paid tier must match the post's price — no unlocking a $19.99
  // post with a $4.99 receipt.
  const { data: post } = await supabase
    .from('posts')
    .select('id, is_locked, price_cents')
    .eq('id', postId)
    .maybeSingle();
  if (!post || !post.is_locked || post.price_cents !== TIER_CENTS[productId]) {
    console.log('tier mismatch or post gone', postId, productId);
    return new Response('mismatch', { status: 200, headers: corsHeaders });
  }

  const { error } = await supabase.from('purchases').upsert(
    {
      user_id: appUserId,
      post_id: postId,
      platform: 'apple',
      product_id: productId,
    },
    { onConflict: 'user_id,post_id', ignoreDuplicates: true }
  );
  if (error) {
    console.error('purchase insert failed', error.message);
    return new Response('db error', { status: 500, headers: corsHeaders });
  }
  return new Response('recorded', { status: 200, headers: corsHeaders });
});
