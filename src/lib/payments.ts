// Real money: Apple in-app purchases via RevenueCat.
//
// Flow: tap Unlock → stamp which post this purchase is for → Apple's
// payment sheet → RevenueCat's webhook verifies with Apple and writes
// the purchases row server-side → the app sees the unlock appear.
// The client NEVER writes its own unlock — the vault seal stays sealed.
import { Platform } from 'react-native';

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

/**
 * Buy one locked post. Resolves once the unlock is RECORDED server-side
 * (webhook round-trip) — so the UI can flip to unlocked with certainty.
 */
export async function purchasePost(post: {
  id: string;
  price_cents: number | null;
}): Promise<void> {
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
    if (err.userCancelled) throw new Error('Purchase cancelled.');
    throw new Error(err.message ?? 'The purchase did not go through.');
  }

  // Apple confirmed payment; now wait for the webhook to record it.
  for (let attempt = 0; attempt < 15; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const owned = await fetchMyPurchasedPostIds().catch(() => new Set<string>());
    if (owned.has(post.id)) return;
  }
  // Paid but the record is lagging — it WILL arrive; tell the user honestly.
  throw new Error(
    'Payment went through — the unlock is on its way. Pull the feed to refresh in a moment.'
  );
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
