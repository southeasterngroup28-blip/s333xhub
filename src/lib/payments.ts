// Real money: Apple in-app purchases via RevenueCat.
//
// Flow: tap Unlock → stamp which post this purchase is for → Apple's
// payment sheet → RevenueCat's webhook verifies with Apple and writes
// the purchases row server-side → the app sees the unlock appear.
// The client NEVER writes its own unlock — the vault seal stays sealed.
import { LogBox, Platform } from 'react-native';

import { fetchMyPurchasedPostIds } from '@/lib/purchases';
import { requireUserId } from '@/lib/supabase';

const RC_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '';

/** price_cents → App Store consumable product id. */
export function productIdForCents(cents: number): string | null {
  const map: Record<number, string> = {
    499: 'unlock_tier_499',
    999: 'unlock_tier_999',
    1499: 'unlock_tier_1499',
    1999: 'unlock_tier_1999',
  };
  return map[cents] ?? null;
}

let configuredFor: string | null = null;

async function rc() {
  const module = await import('react-native-purchases');
  return module.default;
}

/** Idempotent setup — call whenever a session exists. */
export async function configurePayments(userId: string): Promise<void> {
  if (Platform.OS !== 'ios' || !RC_KEY.startsWith('appl_')) return;
  // Dev builds only: RevenueCat logs an 'Error fetching offerings' console.error
  // on every launch until Apple serves the products, and Expo's LogBox turns
  // that into a red toast. We never use offerings (we fetch products directly),
  // so keep the toast off the test screen. LogBox does not exist in release.
  if (__DEV__) LogBox.ignoreLogs([/\[RevenueCat\].*offerings/i]);
  try {
    const Purchases = await rc();
    if (configuredFor === null) {
      Purchases.configure({ apiKey: RC_KEY, appUserID: userId });
    } else if (configuredFor !== userId) {
      await Purchases.logIn(userId);
    }
    configuredFor = userId;
  } catch {
    // Payments simply stay unavailable — never break the app over billing.
  }
}

export class PaymentsNotLiveError extends Error {
  constructor() {
    super('Purchases open with the App Store version — hang tight.');
    this.name = 'PaymentsNotLiveError';
  }
}

/** The fan backed out of Apple's payment sheet — not a failure. */
export class PurchaseCancelledError extends Error {
  constructor() {
    super('Purchase cancelled.');
    this.name = 'PurchaseCancelledError';
  }
}

/** Apple took the money but the webhook row has not landed yet. */
export class UnlockPendingError extends Error {
  constructor() {
    super('Payment went through. Your unlock is on its way.');
    this.name = 'UnlockPendingError';
  }
}

/**
 * Buy one locked post. Resolves once the unlock is RECORDED server-side
 * (webhook round-trip) — so the UI can flip to unlocked with certainty.
 * `onPaid` fires the moment Apple confirms the charge, before the webhook
 * wait, so the UI can move from "buying" to "recording" honestly.
 */
export async function purchasePost(
  post: {
    id: string;
    price_cents: number | null;
  },
  onPaid?: () => void
): Promise<void> {
  if (Platform.OS !== 'ios') throw new PaymentsNotLiveError();
  const productId = productIdForCents(post.price_cents ?? 0);
  if (!productId) throw new Error('This post has no valid price tier.');
  const userId = await requireUserId();

  const Purchases = await rc();
  await configurePayments(userId);

  // Tell the webhook which post this purchase unlocks.
  await Purchases.setAttributes({ pending_post_id: post.id });

  const products = await Purchases.getProducts([productId]);
  const product = products.find((p) => p.identifier === productId);
  if (!product) throw new PaymentsNotLiveError();

  try {
    await Purchases.purchaseStoreProduct(product);
  } catch (e) {
    const err = e as { userCancelled?: boolean; message?: string };
    if (err.userCancelled) throw new PurchaseCancelledError();
    throw new Error(err.message ?? 'The purchase did not go through.');
  }

  onPaid?.();

  // Apple confirmed payment; now wait for the webhook to record it.
  // Check first, THEN sleep — an instant webhook adds zero latency.
  for (let attempt = 0; attempt < 20; attempt++) {
    const owned = await fetchMyPurchasedPostIds().catch(() => new Set<string>());
    if (owned.has(post.id)) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  // Paid but the record is lagging — it WILL arrive; tell the user honestly.
  throw new UnlockPendingError();
}

/**
 * Apple-required Restore button. Our unlocks live server-side keyed to
 * the account, so mostly this just re-syncs; the RC call satisfies the
 * platform requirement and heals any receipt-level weirdness.
 */
export async function restorePurchases(): Promise<number> {
  if (Platform.OS === 'ios' && RC_KEY.startsWith('appl_')) {
    try {
      const Purchases = await rc();
      await Purchases.restorePurchases();
    } catch {
      // Fall through to the server-side sync either way.
    }
  }
  const owned = await fetchMyPurchasedPostIds().catch(() => new Set<string>());
  return owned.size;
}
