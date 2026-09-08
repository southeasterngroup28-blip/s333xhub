// S333XHUB — starts an in-app ticket purchase. The app calls this with
// the signed-in fan's session; we make sure the show is really selling
// (in-app, priced, not full), then ask Stripe for everything the native
// payment sheet needs and hand it back. Nothing is written to tickets
// here — the ticket row appears only when Stripe's webhook confirms the
// payment (see stripe-webhook).
//
// Required secrets (Dashboard → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY — sk_test_… while testing, sk_live_… for real money
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
// provided automatically.)
//
// Request:  POST { show_id }   with the fan's Authorization header
// Success:  200 { paymentIntent, ephemeralKey, customer }
// Failure:  4xx/5xx { error: "friendly sentence" }
import { createClient } from 'npm:@supabase/supabase-js@2';

// Browsers send a CORS "preflight" request before the real one; answer it.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Pin the API version so the ephemeral key matches what the Stripe SDK in
// the app expects. Bump both together, never one side alone.
const STRIPE_VERSION = '2024-06-20';

const uuidish = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function fail(message: string, status: number) {
  return json({ error: message }, status);
}

/**
 * One POST to Stripe's REST API. Stripe takes form-encoded bodies, so no
 * SDK is needed — nested fields are written as `metadata[kind]`.
 */
async function stripePost(
  path: string,
  params: Record<string, string>,
  extraHeaders: Record<string, string> = {}
): Promise<Record<string, any>> {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...extraHeaders,
    },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? `Stripe ${path} failed (${res.status})`);
    (err as any).code = data?.error?.code;
    throw err;
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (!Deno.env.get('STRIPE_SECRET_KEY')) {
    return fail('Ticket sales are not set up yet.', 500);
  }

  let showId = '';
  try {
    const body = await req.json();
    showId = String(body?.show_id ?? '');
  } catch {
    return fail('Bad request.', 400);
  }
  if (!uuidish.test(showId)) return fail('Missing show.', 400);

  // Act AS the caller only to learn who they are — everything after this
  // uses the service role, because fans can't read other people's tickets
  // (needed for the capacity count) or write their own Stripe customer id.
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
  );
  const { data: userData, error: userError } = await caller.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return fail('Please sign in again.', 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // ---- Is this show really selling? --------------------------------
  const { data: show, error: showError } = await admin
    .from('shows')
    .select('id, title, venue, city, status, sales_mode, ticket_price_cents, capacity')
    .eq('id', showId)
    .maybeSingle();
  if (showError) return fail('Could not load that show. Try again.', 500);
  if (!show) return fail('That show is gone.', 404);
  if (show.status === 'cancelled') return fail('This show was cancelled.', 409);
  if (show.sales_mode !== 'in_app') return fail('Tickets for this show are not sold in the app.', 409);
  if (!show.ticket_price_cents || show.ticket_price_cents <= 0) {
    return fail('This show has no ticket price yet.', 409);
  }
  if (show.status === 'sold_out') return fail('This show is sold out.', 409);
  if (show.capacity !== null) {
    const { data: sold, error: soldError } = await admin.rpc('tickets_sold', { show: showId });
    if (soldError) return fail('Could not check availability. Try again.', 500);
    if (Number(sold ?? 0) >= show.capacity) return fail('This show is sold out.', 409);
  }

  // ---- Who is paying? ----------------------------------------------
  const { data: profile } = await admin
    .from('profiles')
    .select('display_name, stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle();
  const buyerName = (profile?.display_name ?? '').trim() || 'fan';

  try {
    // Get-or-create the Stripe Customer. A returning fan keeps their saved
    // cards; a customer deleted from the Stripe dashboard is replaced.
    let customerId: string | null = profile?.stripe_customer_id ?? null;
    let ephemeralKey: Record<string, any> | null = null;
    if (customerId) {
      try {
        ephemeralKey = await stripePost(
          'ephemeral_keys',
          { customer: customerId },
          { 'Stripe-Version': STRIPE_VERSION }
        );
      } catch (error) {
        if ((error as any)?.code !== 'resource_missing') throw error;
        customerId = null; // gone on Stripe's side — make a fresh one below
      }
    }
    if (!customerId) {
      const customer = await stripePost('customers', {
        name: buyerName,
        ...(user.email ? { email: user.email } : {}),
        'metadata[user_id]': user.id,
      });
      customerId = String(customer.id);
      const { error: saveError } = await admin
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
      if (saveError) console.error('could not save stripe_customer_id', saveError.message);
      ephemeralKey = await stripePost(
        'ephemeral_keys',
        { customer: customerId },
        { 'Stripe-Version': STRIPE_VERSION }
      );
    }

    // The PaymentIntent. The metadata is how the webhook knows this is a
    // ticket, for which show, for whom — it never trusts the app for that.
    // Cards only (Apple Pay rides on 'card' in the payment sheet): the
    // redirect-based methods Stripe would otherwise add need a return-URL
    // handler the app doesn't have, so a fan could pay and never come back.
    const label = (show.title ?? '').trim() || `${show.venue} · ${show.city}`;
    const intent = await stripePost('payment_intents', {
      amount: String(show.ticket_price_cents),
      currency: 'usd',
      customer: customerId,
      'payment_method_types[]': 'card',
      description: `S333XHUB ticket — ${label}`,
      'metadata[kind]': 'ticket',
      'metadata[show_id]': show.id,
      'metadata[user_id]': user.id,
      'metadata[buyer_name]': buyerName,
    });

    return json({
      paymentIntent: intent.client_secret,
      ephemeralKey: ephemeralKey!.secret,
      customer: customerId,
    });
  } catch (error) {
    console.error('stripe setup failed', String(error));
    return fail('Could not start checkout. Try again in a moment.', 502);
  }
});
