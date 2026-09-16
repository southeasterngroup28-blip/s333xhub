// Supabase auth failures arrive as API jargon ("Invalid login credentials",
// "AuthRetryableFetchError"). Fans get a plain sentence that says what to
// do next. Matched on the error code first, then on message substrings for
// older responses that carry no code.

type AuthLikeError = {
  code?: string | null;
  message?: string | null;
  name?: string | null;
  status?: number | null;
};

export const AUTH_ERROR_COPY = {
  invalidCredentials:
    "That email and password don't match. Check them and try again, or reset your password.",
  alreadyExists: 'There is already an account with this email. Try signing in instead.',
  rateLimited: 'Too many tries. Wait a minute and try again.',
  weakPassword: 'Your password needs at least 8 characters.',
  emailNotConfirmed: 'Confirm your email first. Check your inbox.',
  invalidEmail: "That email address doesn't look right. Check it and try again.",
  network: 'Could not reach the server. Check your connection and try again.',
  fallback: 'Something went wrong. Try again in a moment.',
} as const;

/** True when a sign-in was refused because the address is not confirmed yet. */
export function isEmailNotConfirmed(error: AuthLikeError | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'email_not_confirmed') return true;
  return (error.message ?? '').toLowerCase().includes('email not confirmed');
}

/** Human copy for a Supabase auth error. Never returns the raw message. */
export function authErrorCopy(error: AuthLikeError | null | undefined): string {
  if (!error) return AUTH_ERROR_COPY.fallback;
  const code = (error.code ?? '').toLowerCase();
  const message = (error.message ?? '').toLowerCase();
  const name = (error.name ?? '').toLowerCase();

  // ---- by code ----
  switch (code) {
    case 'invalid_credentials':
      return AUTH_ERROR_COPY.invalidCredentials;
    case 'user_already_exists':
    case 'email_exists':
    case 'phone_exists':
      return AUTH_ERROR_COPY.alreadyExists;
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
    case 'over_sms_send_rate_limit':
      return AUTH_ERROR_COPY.rateLimited;
    case 'weak_password':
      return AUTH_ERROR_COPY.weakPassword;
    case 'email_not_confirmed':
      return AUTH_ERROR_COPY.emailNotConfirmed;
    case 'validation_failed':
    case 'email_address_invalid':
      // A typo'd address: retrying cannot help, so the copy must not say so.
      return AUTH_ERROR_COPY.invalidEmail;
    default:
      break;
  }

  // ---- by message ----
  if (name.includes('retryablefetch') || message.includes('network request failed')) {
    return AUTH_ERROR_COPY.network;
  }
  if (
    message.includes('failed to fetch') ||
    message.includes('network') ||
    message.includes('timed out') ||
    message.includes('timeout')
  ) {
    return AUTH_ERROR_COPY.network;
  }
  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) {
    return AUTH_ERROR_COPY.invalidCredentials;
  }
  if (message.includes('already registered') || message.includes('already exists')) {
    return AUTH_ERROR_COPY.alreadyExists;
  }
  if (message.includes('rate limit') || message.includes('too many') || error.status === 429) {
    return AUTH_ERROR_COPY.rateLimited;
  }
  if (
    message.includes('weak password') ||
    (message.includes('password') &&
      (message.includes('at least') || message.includes('characters') || message.includes('short')))
  ) {
    return AUTH_ERROR_COPY.weakPassword;
  }
  if (message.includes('email not confirmed')) {
    return AUTH_ERROR_COPY.emailNotConfirmed;
  }
  if (
    message.includes('invalid format') ||
    message.includes('unable to validate email') ||
    message.includes('invalid email')
  ) {
    return AUTH_ERROR_COPY.invalidEmail;
  }
  return AUTH_ERROR_COPY.fallback;
}
