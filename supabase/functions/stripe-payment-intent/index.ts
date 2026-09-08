// S333XHUB — starts an in-app ticket purchase. The app calls this with
// the signed-in fan's session; we make sure the show is really selling
// (in-app, priced, not full), then ask Stripe for everything the native
// payment sheet needs and hand it back. Nothing is written to tickets
// here — the ticket row appears only when Stripe's webhook confirms the
// payment (see stripe-webhook).
//
// Required secrets (Dashboard → Edge Functions → Secrets):
//   STRIPE_SECRET_KEY   — sk_test_… while testing, sk_live_… for real money
//   SB_SECRET_KEY — the sb_secret_… key (Settings → API Keys). Powers
//                         the privileged reads/writes below. If it's missing
//                         we fall back to the auto-injected legacy
//                         SUPABASE_SERVICE_ROLE_KEY JWT, which this
//                         new-generation project has rejected before.
// (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are
// provided automatically.)
//
// Request:  POST { show_id, mode? }   with the fan's Authorization header
//           mode = 'test' | 'live' — which kind of publishable key the app
//           holds; refused up front if this function's secret key is the
//           other kind (a test app can never start a live charge).
// Success:  200 { paymentIntent, ephemeralKey, customer, livemode }
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

// Which secret unlocks the privileged (row-level-security-bypassing)
// client. Decided once at startup and logged BY NAME ONLY, so the
// dashboard logs show which key a deploy is running on — the value itself
// never goes near a log line.
// Preference order: the owner-added SB_SECRET_KEY (secret names starting
// with SUPABASE_ are reserved by the dashboard), then the platform's own
// SUPABASE_SECRET_KEYS (may hold several, comma-separated), then the
// deprecated legacy service-role JWT as a last resort.
const ADMIN_KEY_NAME = Deno.env.get('SB_SECRET_KEY')
  ? 'SB_SECRET_KEY'
  : Deno.env.get('SUPABASE_SECRET_KEYS')
    ? 'SUPABASE_SECRET_KEYS'
    : 'SUPABASE_SERVICE_ROLE_KEY';
/** Read a key from an env var that may hold either a bare key or Supabase's JSON dictionary of keys. */
function envKey(name: string): string {
  const raw = (Deno.env.get(name) ?? '').trim();
  if (!raw.startsWith('{')) return raw.split(',')[0].trim();
  try {
    const dict = JSON.parse(raw) as Record<string, string>;
    return String(dict.default ?? Object.values(dict)[0] ?? '');
  } catch {
    return '';
  }
}
const ADMIN_KEY = envKey(ADMIN_KEY_NAME);
console.log(`privileged Supabase client: using ${ADMIN_KEY_NAME}`);

/** The privileged client — see ADMIN_KEY_NAME for which key it holds. */
function adminClient() {
  return createClient(Deno.env.get('SUPABASE_URL')!, ADMIN_KEY);
}

/** One log line from a PostgREST error: code | message | details | hint. */
function describe(error: { code?: string; message?: string; details?: string; hint?: string }) {
  return [error.code, error.message, error.details, error.hint].filter(Boolean).join(' | ');
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
  let appMode = '';
  try {
    const body = await req.json();
    showId = String(body?.show_id ?? '');
    appMode = String(body?.mode ?? '');
  } catch {
    return fail('Bad request.', 400);
  }
  if (!uuidish.test(showId)) return fail('Missing show.', 400);

  // Test app + live key (or the reverse) can never work: Stripe keeps the
  // two worlds apart, so the payment sheet would only ever see "No such
  // payment_intent". Say so plainly instead of creating a stray charge.
  const serverMode = Deno.env.get('STRIPE_SECRET_KEY')!.startsWith('sk_live_') ? 'live' : 'test';
  if ((appMode === 'test' || appMode === 'live') && appMode !== serverMode) {
    console.error(`Stripe key mismatch: app is ${appMode}, STRIPE_SECRET_KEY is ${serverMode}`);
    return fail(`Checkout is misconfigured: the app uses Stripe ${appMode} keys but the server holds a ${serverMode} key.`, 500);
  }

  // Act AS the caller only to learn who they are — everything after this
  // uses the service role, because fans can't read other people's tickets
  // (needed for the capacity count) or write their own Stripe customer id.
  const caller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    envKey('SUPABASE_PUBLISHABLE_KEYS') || Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
  );
  const { data: userData, error: userError } = await caller.auth.getUser();
  const user = userData?.user;
  if (userError || !user) return fail('Please sign in again.', 401);

  const admin = adminClient();

  // ---- Is this show really selling? --------------------------------
  const { data: show, error: showError } = await admin
    .from('shows')
    .select('id, title, venue, city, status, sales_mode, ticket_price_cents, capacity, starts_at')
    .eq('id', showId)
    .maybeSingle();
  if (showError) {
    // The fan sees a friendly sentence; the real cause goes to the logs.
    console.error(`show lookup failed (via ${ADMIN_KEY_NAME}):`, describe(showError));
    return fail('Could not load that show. Try again.', 500);
  }
  if (!show) return fail('That show is gone.', 404);
  if (show.status === 'cancelled') return fail('This show was cancelled.', 409);
  if (show.sales_mode !== 'in_app') return fail('Tickets for this show are not sold in the app.', 409);
  if (!show.ticket_price_cents || show.ticket_price_cents <= 0) {
    return fail('This show has no ticket price yet.', 409);
  }
  if (show.status === 'sold_out') return fail('This show is sold out.', 409);
  // A stale Shows screen can still tap Buy after the night is over.
  if (new Date(show.starts_at).getTime() + 6 * 3600 * 1000 < Date.now()) {
    return fail('This show is over.', 409);
  }
  if (show.capacity !== null) {
    const { data: sold, error: soldError } = await admin.rpc('tickets_sold', { show: showId });
    if (soldError) {
      console.error(`tickets_sold failed (via ${ADMIN_KEY_NAME}):`, describe(soldError));
      return fail('Could not check availability. Try again.', 500);
    }
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
      livemode: intent.livemode === true,
    });
  } catch (error) {
    console.error('stripe setup failed', String(error));
    return fail('Could not start checkout. Try again in a moment.', 502);
  }
});
