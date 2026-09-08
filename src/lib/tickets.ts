// Real money: show tickets via Stripe.
//
// Flow: tap Buy → our edge function creates a PaymentIntent → Stripe's
// payment sheet → Stripe's webhook calls issue_ticket server-side → the
// app sees the ticket row appear. The client NEVER writes a ticket — the
// webhook is the only writer, same as post unlocks (see lib/payments.ts).
import { Platform } from 'react-native';

import { priceLabel } from '@/lib/shop';
import { SHOW_COLUMNS, isPast, type SalesMode, type Show } from '@/lib/shows';
import { supabase, requireUserId } from '@/lib/supabase';

export { priceLabel };
export type { SalesMode };

const STRIPE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

export type TicketStatus = 'paid' | 'checked_in' | 'refunded';

export type Ticket = {
  id: string;
  show_id: string;
  user_id: string | null;
  status: TicketStatus;
  qr_token: string;
  stripe_payment_intent_id: string;
  amount_cents: number;
  buyer_name: string | null;
  purchased_at: string;
  checked_in_at: string | null;
  /** Joined for display (the full show, so lib/shows' date helpers apply as-is). */
  show: Show | null;
};

export type CheckInResult = {
  ok: boolean;
  /** 'wrong_show' = a ticket for another date, or for a show that's cancelled / already over. */
  reason?: 'wrong_show' | 'already_checked_in' | 'refunded' | 'unknown' | string;
  buyer_name?: string | null;
  show_title?: string | null;
  status?: TicketStatus | null;
  checked_in_at?: string | null;
};

// The joined show is the FULL Show (SHOW_COLUMNS), so salesMode() and the
// date helpers work on ticket.show exactly as they do on a list row.
const TICKET_COLUMNS = `id, show_id, user_id, status, qr_token, stripe_payment_intent_id, amount_cents, buyer_name, purchased_at, checked_in_at, show:shows(${SHOW_COLUMNS})`;

/** Thrown when the fan backs out of the payment sheet — screens stay silent on it. */
export class PurchaseCancelledError extends Error {
  constructor() {
    super('Purchase cancelled.');
    this.name = 'PurchaseCancelledError';
  }
}

export function isPurchaseCancelled(error: unknown): boolean {
  return (
    error instanceof PurchaseCancelledError ||
    (error as { message?: string })?.message === 'Purchase cancelled.'
  );
}

// ---- reading -------------------------------------------------------------

/** How a show sells, with a sane answer for a row that somehow predates the column. */
export function salesMode(show: Show): SalesMode {
  if (show.sales_mode) return show.sales_mode;
  return show.ticket_url ? 'link' : 'none';
}

/** Seats left for a capped show; null when it's unlimited. */
export function remaining(show: Show, sold: number): number | null {
  if (show.capacity == null) return null;
  return Math.max(0, show.capacity - sold);
}

/** Tickets that count toward capacity (paid + checked in). */
export async function ticketsSold(showId: string): Promise<number> {
  const { data, error } = await supabase.rpc('tickets_sold', { show: showId });
  if (error) throw new Error('Could not check how many tickets are left.');
  return typeof data === 'number' ? data : Number(data ?? 0) || 0;
}

/** My tickets, soonest show first (refunded ones included — the screen decides). */
export async function fetchMyTickets(): Promise<Ticket[]> {
  const me = await requireUserId();
  const { data, error } = await supabase
    .from('tickets')
    .select(TICKET_COLUMNS)
    .eq('user_id', me)
    .order('purchased_at', { ascending: false });
  if (error) throw new Error('Could not load your tickets - check your connection and try again.');
  const rows = (data as unknown as Ticket[]) ?? [];
  return rows.sort(
    (a, b) =>
      new Date(a.show?.starts_at ?? 0).getTime() - new Date(b.show?.starts_at ?? 0).getTime()
  );
}

/** The tickets I hold for shows that haven't wrapped yet. */
export function liveTickets(tickets: Ticket[]): Ticket[] {
  return tickets.filter((t) => !t.show || !isPast(t.show));
}

/** My usable ticket for one show (refunds don't count), if any. */
export function ticketForShow(tickets: Ticket[], showId: string): Ticket | null {
  return tickets.find((t) => t.show_id === showId && t.status !== 'refunded') ?? null;
}

/** One ticket by id. Resolves null when it's gone or isn't mine (RLS). */
export async function fetchTicket(id: string): Promise<Ticket | null> {
  const { data, error } = await supabase
    .from('tickets')
    .select(TICKET_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('Could not load that ticket - try again in a moment.');
  return (data as unknown as Ticket) ?? null;
}

/** Artist: every ticket sold for a show, newest first. */
export async function fetchTicketsForShow(showId: string): Promise<Ticket[]> {
  const { data, error } = await supabase
    .from('tickets')
    .select(TICKET_COLUMNS)
    .eq('show_id', showId)
    .order('purchased_at', { ascending: false });
  if (error) throw new Error('Could not load the ticket list - try again in a moment.');
  return (data as unknown as Ticket[]) ?? [];
}

// ---- the door --------------------------------------------------------------

/**
 * Artist: scan a QR token. The database decides and says why. Pass the
 * show the scanner was opened from and a ticket for any other date is
 * refused as 'wrong_show' (without touching it); with no show, any
 * upcoming date's ticket goes through.
 */
export async function checkInTicket(token: string, showId?: string): Promise<CheckInResult> {
  const { data, error } = await supabase.rpc('check_in_ticket', {
    p_token: token.trim(),
    p_show: showId ?? null,
  });
  if (error) {
    if (error.code === '42501' || (error.message ?? '').includes('artist')) {
      throw new Error('Only the artist can check tickets in.');
    }
    throw new Error('Could not check that ticket - try scanning again.');
  }
  return (data as CheckInResult) ?? { ok: false, reason: 'unknown' };
}

// ---- buying ----------------------------------------------------------------

type IntentResponse = {
  paymentIntent?: string;
  ephemeralKey?: string;
  customer?: string;
  livemode?: boolean;
  error?: string;
};

/** Which Stripe world this build's publishable key belongs to. */
const STRIPE_MODE: 'test' | 'live' = STRIPE_KEY.startsWith('pk_live_') ? 'live' : 'test';

/**
 * Edge function errors come back as FunctionsHttpError with the raw
 * Response tucked in `context`. Surface the function's own {error}
 * message when it wrote one; otherwise the caller's copy.
 */
async function intentError(error: unknown, fallback: string): Promise<Error> {
  const ctx = (error as { context?: { status?: number; json?: () => Promise<unknown> } })
    ?.context;
  try {
    const body = (await ctx?.json?.()) as { error?: unknown } | undefined;
    if (typeof body?.error === 'string' && body.error.trim() && body.error.length < 200) {
      return new Error(body.error);
    }
  } catch {
    // no JSON body — fall through
  }
  if (ctx?.status === 404) {
    return new Error("Ticket sales aren't switched on yet — hang tight.");
  }
  if ((error as { name?: string })?.name === 'FunctionsFetchError') {
    return new Error('Could not reach checkout - check your connection and try again.');
  }
  return new Error(fallback);
}

async function stripe() {
  const module = await import('@stripe/stripe-react-native');
  return module;
}

// Stripe's catch-all sentence. It hides the real reason (a key from the
// wrong account, a stale intent...) which the SDK only puts in `message`.
const GENERIC_STRIPE_LINE = /unexpected error/i;

type StripeError = { code?: string; message?: string; localizedMessage?: string };

/**
 * The fan-facing line, plus the SDK's specific reason in parentheses on a
 * dev build only. It is always logged, so a production failure still
 * leaves a trace.
 */
function withDetail(fanLine: string, error: StripeError): string {
  const detail = (error.message ?? '').trim();
  const specific = detail && detail !== error.localizedMessage && !GENERIC_STRIPE_LINE.test(detail);
  if (specific) console.warn('[tickets] Stripe:', error.code, detail);
  return __DEV__ && specific ? `${fanLine} (${detail})` : fanLine;
}

/**
 * Buy one ticket. Resolves once the ticket is RECORDED server-side
 * (Stripe webhook round-trip) so the screen can open it with certainty.
 */
export async function buyTicket(show: Show, buyerName?: string | null): Promise<Ticket> {
  if (Platform.OS === 'web') throw new Error('Buy tickets from the app on your phone.');
  if (!STRIPE_KEY) throw new Error("Ticket sales aren't switched on yet — hang tight.");
  if (show.status === 'cancelled') throw new Error("That show's been cancelled.");
  if (show.status === 'sold_out') throw new Error('Sold out — every ticket is gone.');
  if (salesMode(show) !== 'in_app') {
    throw new Error("Tickets for this show aren't sold in the app.");
  }
  const price = show.ticket_price_cents ?? 0;
  if (price <= 0) throw new Error("This show doesn't have a ticket price yet.");

  const me = await requireUserId();

  let name = (buyerName ?? '').trim();
  if (!name) {
    const { data } = await supabase
      .from('profiles')
      .select('display_name')
      .eq('id', me)
      .maybeSingle();
    name = ((data as { display_name?: string } | null)?.display_name ?? '').trim();
  }

  // The server prices and gates the sale — the app only asks.
  const { data, error } = await supabase.functions.invoke<IntentResponse>(
    'stripe-payment-intent',
    { body: { show_id: show.id, mode: STRIPE_MODE } }
  );
  if (error) throw await intentError(error, 'Could not start checkout - try again in a moment.');
  if (data?.error) throw new Error(data.error);
  if (!data?.paymentIntent || !data.ephemeralKey || !data.customer) {
    throw new Error('Could not start checkout - try again in a moment.');
  }
  // Belt and braces for an older server build: a test app must never be
  // handed a live payment, and the reverse would only fail inside Stripe.
  if (typeof data.livemode === 'boolean' && data.livemode !== (STRIPE_MODE === 'live')) {
    throw new Error(
      `Checkout is misconfigured: the app uses Stripe ${STRIPE_MODE} keys but the server holds a ${data.livemode ? 'live' : 'test'} key.`
    );
  }

  let sdk: Awaited<ReturnType<typeof stripe>>;
  try {
    sdk = await stripe();
  } catch {
    // A build without Stripe's native module (older dev client).
    throw new Error('Ticket checkout needs the latest version of the app.');
  }

  const init = await sdk.initPaymentSheet({
    merchantDisplayName: 'S333XHUB',
    customerId: data.customer,
    customerEphemeralKeySecret: data.ephemeralKey,
    paymentIntentClientSecret: data.paymentIntent,
    applePay: { merchantCountryCode: 'US' },
    returnURL: 's333xhub://stripe-redirect',
    defaultBillingDetails: name ? { name } : undefined,
    allowsDelayedPaymentMethods: false,
  });
  if (init.error) {
    throw new Error(withDetail('Could not open checkout - try again in a moment.', init.error));
  }

  // What I already hold for this show, BEFORE paying — so the wait below
  // looks for the row this payment adds, never an older ticket of mine.
  const before = new Set(
    (await fetchMyTickets().catch(() => [] as Ticket[]))
      .filter((t) => t.show_id === show.id)
      .map((t) => t.id)
  );

  const result = await sdk.presentPaymentSheet();
  if (result.didCancel || result.error?.code === 'Canceled') throw new PurchaseCancelledError();
  if (result.error) {
    // Stripe's localizedMessage is the fan-facing line; when it's only the
    // generic "unexpected error" one, fall back to our own copy.
    const fanLine =
      result.error.localizedMessage && !GENERIC_STRIPE_LINE.test(result.error.localizedMessage)
        ? result.error.localizedMessage
        : 'The payment did not go through - try again in a moment.';
    throw new Error(withDetail(fanLine, result.error));
  }

  // Stripe took the money; now wait for the webhook to record the ticket.
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const mine = await fetchMyTickets().catch(() => [] as Ticket[]);
    const fresh = mine.find((t) => t.show_id === show.id && !before.has(t.id));
    if (!fresh) continue;
    // The gate refused (last seat went, or sales closed, while the sheet was
    // up) and recorded it as a refunded row; the webhook refunds in full.
    if (fresh.status === 'refunded') {
      throw new Error(
        'That last ticket went to someone else just now — your payment is being refunded in full.'
      );
    }
    return fresh;
  }
  // Paid but the record is lagging — it WILL arrive; tell the fan honestly.
  throw new Error(
    'Payment went through — your ticket is on its way. Pull to refresh in a moment.'
  );
}
