// One word for a user who is gone, and one way to read a name.

/** What the app calls a user whose profile row no longer exists. */
export const GONE_NAME = 'Deleted user';

/**
 * A profile's name for a sentence or a name line. Pass the raw
 * display_name into Avatar separately, so a deleted user never gets a
 * 'D' initial (avatar.tsx owns the '?' placeholder).
 */
export function displayName(p?: { display_name?: string | null } | null): string {
  return p?.display_name ?? GONE_NAME;
}

/**
 * True when a profile still carries the database's placeholder name.
 * The app forces a real name on first open (see app/name.tsx).
 *
 * The match is case-insensitive on purpose: 'Fan' and 'FAN' read as the
 * placeholder to every other fan, so the name screen refuses them too
 * (with a hint), and sign-up should do the same.
 */
export function isUnnamed(name: string | null | undefined): boolean {
  const trimmed = (name ?? '').trim();
  return trimmed.length === 0 || trimmed.toLowerCase() === 'fan';
}
