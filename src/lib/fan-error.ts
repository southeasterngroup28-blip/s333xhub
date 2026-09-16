// The one place backend text is allowed to become fan-facing text.
//
// A FanError carries a sentence written for a fan. Anything else that
// reaches a catch block (a Postgres message, a fetch TypeError, a Stripe
// SDK object) is logged and replaced by the caller's own fallback, so a
// fan never reads "row-level security policy for table messages" in red.

export class FanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FanError';
  }
}

export const NETWORK_COPY = 'Could not reach the server. Check your connection and try again.';
export const SESSION_COPY = 'Your session expired. Sign in again.';

/**
 * True when `e` is the phone failing to reach the server at all: a fetch
 * TypeError, the supabase-js wrapper around one ({ error: { message:
 * 'TypeError: Network request failed' } }), or a FunctionsFetchError.
 */
export function isNetworkError(e: unknown): boolean {
  const err = e as { name?: string; message?: unknown } | null;
  const message = typeof err?.message === 'string' ? err.message : '';
  return (
    (e instanceof TypeError && /fetch|network/i.test(message)) ||
    /Network request failed|Failed to fetch/i.test(message) ||
    err?.name === 'FunctionsFetchError'
  );
}

/**
 * The sentence a screen may show for `e`. A FanError (and its subclasses:
 * UnlockPendingError, PurchaseCancelledError, TicketPendingError,
 * PaymentsNotLiveError) speaks for itself. Three raw cases get a house
 * sentence of their own; everything else logs and returns `fallback`.
 */
export function fanCopy(e: unknown, fallback: string): string {
  if (e instanceof FanError) return e.message;
  console.warn('[fan-error]', e);
  const err = e as { message?: unknown; code?: unknown } | null;
  const message = typeof err?.message === 'string' ? err.message : '';
  const code = typeof err?.code === 'string' ? err.code : '';
  if (isNetworkError(e)) return NETWORK_COPY;
  if (code === 'PGRST301' || /JWT expired/i.test(message)) return SESSION_COPY;
  // 42501 / row-level security: the caller's sentence, never the raw text.
  return fallback;
}
