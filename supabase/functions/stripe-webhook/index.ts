// S333XHUB — Stripe webhook: the ONLY writer of ticket rows.
// Stripe calls this after every payment event; we verify the signature,
// and on a successful ticket payment mint the ticket through the locked
// issue_ticket() function (idempotent — a repeat delivery returns the
// row already made). When the gate refuses (the show filled up or
// stopped selling in-app while the fan was paying) it records the
// refusal as a 'refunded' row and we refund the payment on Stripe. A
// refund made on Stripe voids the ticket the same way. The app never
// writes its own "I paid" row.
//
// Required secrets (Dashboard → Edge Functions → Secrets):
//   STRIPE_WEBHOOK_SECRET — the whsec_… from the Stripe endpoint you point
//                           at this function (events: payment_intent.succeeded,
//                           charge.refunded)
//   STRIPE_SECRET_KEY     — only used to refund a payment the gate refused
//                           (the fan is never left charged without a ticket)
//   SB_SECRET_KEY         — the sb_secret_… key (Settings → API Keys) that
//                           runs the privileged issue/refund calls below. If
//                           it's missing we fall back to the auto-injected
//                           legacy SUPABASE_SERVICE_ROLE_KEY JWT, which this
//                           new-generation project has rejected before.
// Dashboard → Edge Functions → stripe-webhook → "Verify JWT" must be OFF:
// Stripe has no Supabase session; the signature is the auth.
//
// Deliberately answers 200 for anything it doesn't handle: Stripe retries
// non-2xx for days, and retrying an event we ignore helps nobody.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
};

// Stripe rejects the event if the timestamp in the signature is older
// than this — stops a captured request from being replayed later.
const TOLERANCE_SECONDS = 300;

const uuidish = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(body: string, status = 200) {
  return new Response(body, { status, headers: corsHeaders });
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

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Same length + every character compared, no early exit — timing-safe. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Stripe signs `<timestamp>.<raw body>` with the endpoint secret
 * (HMAC-SHA256) and sends "t=<timestamp>,v1=<hex>" (possibly several v1s
 * during a secret rotation). Recompute and compare; done by hand so the
 * function needs no SDK.
 */
async function verifySignature(rawBody: string, header: string, secret: string): Promise<boolean> {
  let timestamp = '';
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') timestamp = value;
    else if (key === 'v1') signatures.push(value);
  }
  if (!timestamp || signatures.length === 0) return false;

  const sent = Number(timestamp);
  if (!Number.isFinite(sent)) return false;
  if (Math.abs(Date.now() / 1000 - sent) > TOLERANCE_SECONDS) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`));
  const expected = toHex(mac);
  return signatures.some((sig) => safeEqual(sig.toLowerCase(), expected));
}

/** Refund a payment in full (used only when a ticket could not be issued). */
async function refundOnStripe(paymentIntentId: string): Promise<boolean> {
  const secretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!secretKey) {
    console.error('auto-refund impossible: STRIPE_SECRET_KEY is not set', paymentIntentId);
    return false;
  }
  const res = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Same payment refunded twice by a retry = one refund, not two.
      'Idempotency-Key': `refund_${paymentIntentId}`,
    },
    body: new URLSearchParams({ payment_intent: paymentIntentId }).toString(),
  });
  if (res.ok) return true;
  const body = (await res.json().catch(() => ({}))) as Record<string, any>;
  // Already sent back in full (by hand in the dashboard, say): the fan has
  // their money, which is all this call is for — don't make Stripe retry.
  if (body?.error?.code === 'charge_already_refunded') return true;
  console.error('auto-refund failed', paymentIntentId, JSON.stringify(body));
  return false;
}

/** The gate said no; the fan must not stay charged for nothing. Refund, then answer Stripe. */
async function refuseAndRefund(paymentIntentId: string, why: string): Promise<Response> {
  console.log('ticket refused, refunding', paymentIntentId, why);
  const refunded = await refundOnStripe(paymentIntentId);
  // A failed refund is the one refusal worth a retry — Stripe will call again.
  return reply(refunded ? 'refused, refunded' : 'refused, refund failed', refunded ? 200 : 500);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return reply('ok');
  }

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? '';
  const signature = req.headers.get('stripe-signature') ?? '';
  // The signature covers the exact bytes Stripe sent — read them raw,
  // BEFORE any JSON parsing.
  const rawBody = await req.text();
  if (!secret || !signature || !(await verifySignature(rawBody, signature, secret))) {
    return reply('bad signature', 401);
  }

  let event: Record<string, any>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return reply('bad json', 400);
  }

  const type = String(event?.type ?? '');
  const object = (event?.data?.object ?? {}) as Record<string, any>;

  const supabase = adminClient();

  // ---- A ticket was paid for ---------------------------------------
  if (type === 'payment_intent.succeeded') {
    const metadata = (object.metadata ?? {}) as Record<string, string>;
    if (metadata.kind !== 'ticket') return reply('ignored', 200);

    const paymentIntentId = String(object.id ?? '');
    const showId = String(metadata.show_id ?? '');
    const userId = String(metadata.user_id ?? '');
    if (!paymentIntentId || !uuidish.test(showId) || !uuidish.test(userId)) {
      console.log('ticket payment missing target', paymentIntentId, showId, userId);
      return reply('missing target', 200);
    }
    const amount = Number(object.amount_received ?? object.amount ?? 0);

    const { data: ticket, error } = await supabase.rpc('issue_ticket', {
      p_show: showId,
      p_user: userId,
      p_payment_intent: paymentIntentId,
      p_amount: amount,
      p_buyer_name: metadata.buyer_name ?? null,
    });

    if (error) {
      // The one refusal the database can't write down: the show is gone,
      // so there's no row to hang a ticket on. Exact match on purpose —
      // every other error is a real failure → non-2xx so Stripe retries.
      if (error.message === 'Show not found.') {
        return refuseAndRefund(paymentIntentId, error.message);
      }
      console.error('issue_ticket failed', error.message);
      return reply('db error', 500);
    }

    // The gate answers with the row: 'paid' is a seat; 'refunded' is a
    // recorded refusal (sold out / sales closed between checkout and now),
    // which is also what a retry of an already-refunded payment gets back —
    // the idempotency key makes the second refund call a no-op on Stripe.
    const row = (ticket ?? null) as { id?: string; status?: string } | null;
    if (row?.status === 'refunded') {
      return refuseAndRefund(paymentIntentId, `refused (ticket ${row.id ?? '?'})`);
    }

    console.log('ticket issued', row?.id ?? '?', paymentIntentId);
    return reply('recorded', 200);
  }

  // ---- A ticket payment was refunded --------------------------------
  if (type === 'charge.refunded') {
    // charge.refunded also fires for PARTIAL refunds; `refunded` is only
    // true once the whole charge is returned. A partial refund (a fee, a
    // goodwill credit) keeps the ticket valid.
    if (object.refunded !== true) return reply('ignored (partial refund)', 200);
    const paymentIntentId =
      typeof object.payment_intent === 'string'
        ? object.payment_intent
        : String(object.payment_intent?.id ?? '');
    if (!paymentIntentId) return reply('missing payment intent', 200);

    const { error } = await supabase.rpc('refund_ticket', { p_payment_intent: paymentIntentId });
    if (error) {
      console.error('refund_ticket failed', error.message);
      return reply('db error', 500);
    }
    return reply('refunded', 200);
  }

  return reply('ignored', 200);
});
