import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { AppBackground } from '@/components/app-background';
import { Avatar } from '@/components/avatar';
import { ErrorCard } from '@/components/empty-state';
import { PushedHeader } from '@/components/pushed-header';
import { Skeleton } from '@/components/skeleton';
import { TopNotice } from '@/components/top-notice';
import {
  DISPLAY_FONT,
  capLabel,
  chip,
  confirmDanger,
  confirmQuestion,
  confirmWord,
  kicker,
  pillText,
  sectionHead,
  stockLeft,
} from '@/constants/type';
import { fanCopy } from '@/lib/fan-error';
import { pressFeedback, selectFeedback, successFeedback, tapFeedback } from '@/lib/haptics';
import { displayName } from '@/lib/profiles';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import {
  SHOP_PAYMENTS_LIVE,
  activeClaims,
  deleteDrop,
  dropImageUrl,
  dropStatus,
  fetchDrop,
  fetchFulfillment,
  markShipped,
  ownerClaims,
  priceLabel,
  publishDrop,
  remaining,
  type Claim,
  type Drop,
  type Fulfillment,
} from '@/lib/shop';
import { useAuth } from '@/providers/auth-provider';
import { countdownTo, useNow } from '@/lib/countdown';
import { serverNowMs } from '@/lib/shop';

export default function DropScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const router = useRouter();
  const isArtist = profile?.role === 'artist';
  const now = useNow();
  const reduceMotion = useReduceMotion();

  const [drop, setDrop] = useState<Drop | null>(null);
  const [fulfillment, setFulfillment] = useState<Record<string, Fulfillment>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickedNumber, setPickedNumber] = useState<number | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Which claim is getting a tracking number typed in. */
  const [shipTarget, setShipTarget] = useState<string | null>(null);
  const [trackingDraft, setTrackingDraft] = useState('');

  // If someone else takes the selected number, drop the selection.
  useEffect(() => {
    if (pickedNumber == null || !drop) return;
    const takenNow = activeClaims(drop).some((c) => c.edition_number === pickedNumber);
    if (takenNow) setPickedNumber(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop]);

  // Three callers overlap here (focus, the 12s live poll, pull-to-refresh);
  // only the NEWEST request may paint, or a stale response could flip a
  // just-taken number back to free for a whole poll tick (feed's fetchSeq
  // pattern).
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    if (!id) return;
    const seq = ++loadSeq.current;
    try {
      const fresh = await fetchDrop(id);
      const shipping = fresh
        ? await fetchFulfillment(fresh.claims.map((c) => c.id)).catch(() => ({}))
        : null;
      if (seq !== loadSeq.current) return;
      setDrop(fresh);
      if (shipping) setFulfillment(shipping);
      setError(null);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(fanCopy(e, 'Could not load the drop.'));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [id]);

  // While the drop is live the numbers grid is a race — keep it honest with
  // a slow poll while the screen has focus. Plain server reads, no webhook
  // conflict; the claim flow itself stays untouched.
  const live = drop ? dropStatus(drop) === 'live' : false;
  useFocusEffect(
    useCallback(() => {
      load();
      if (!live) return;
      const timer = setInterval(load, 12_000);
      return () => clearInterval(timer);
    }, [load, live])
  );

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/shop' as never);
  }

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flash(text: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), 3000);
  }

  async function handleBuy() {
    pressFeedback();
    // Hard gate: no Stripe yet means no orders. The screen never renders
    // the grid or the button while SHOP_PAYMENTS_LIVE is off, so this is
    // the belt to that brace.
    if (!SHOP_PAYMENTS_LIVE) return;
    // Stripe Checkout flow lands here at phase 2.
  }

  async function handlePublish() {
    setConfirmPublish(false);
    try {
      await publishDrop(drop!.id);
      successFeedback();
      flash('LIVE. Every fan just got the push.');
      await load();
    } catch (e) {
      setError(fanCopy(e, 'Could not publish the drop.'));
    }
  }

  async function handleDelete() {
    setConfirmDelete(false);
    try {
      await deleteDrop(drop!.id);
      goBack();
    } catch (e) {
      setError(fanCopy(e, 'Could not delete the drop.'));
    }
  }

  async function handleMarkShipped(claim: Claim) {
    const tracking = trackingDraft.trim();
    setShipTarget(null);
    setTrackingDraft('');
    try {
      await markShipped(claim.id, tracking);
      successFeedback();
      flash(`#${claim.edition_number} marked shipped. Its owner got the push.`);
      await load();
    } catch (e) {
      setError(fanCopy(e, 'Could not mark that piece shipped.'));
    }
  }

  if (loading || !drop) {
    // Same shell as the loaded screen: the background never flashes black
    // and the back chevron is tappable from the first frame.
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <AppBackground />
        <PushedHeader title="DROP" fallback="/(tabs)/shop" />
        {loading ? (
          <DropSkeleton />
        ) : error ? (
          // A failed lookup is not "gone": the drop may be live right now.
          <View style={styles.body}>
            <ErrorCard
              title="COULDN'T LOAD THIS DROP"
              onRetry={() => {
                tapFeedback();
                // Before load(): load() alone never re-sets loading, and the
                // skeleton coming back instantly is the acknowledgment.
                setLoading(true);
                load();
              }}
            />
          </View>
        ) : (
          // A fetch that genuinely came back empty. This one CAN say gone.
          <View style={styles.body}>
            <Text style={styles.goneTitle}>THIS DROP IS GONE</Text>
          </View>
        )}
      </SafeAreaView>
    );
  }

  const status = dropStatus(drop);
  const image = dropImageUrl(drop.image_path);
  const left = remaining(drop);
  const active = activeClaims(drop);
  const owners = ownerClaims(drop);
  const taken = new Set(active.map((c) => c.edition_number));
  const mine = active.find((c) => c.user_id === session?.user.id) ?? null;
  const gross = owners.length * drop.price_cents;
  const grossDollars = Math.floor(gross / 100).toLocaleString('en-US');
  const toShip = owners.filter((c) => c.status !== 'shipped').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <AppBackground />
      <PushedHeader
        title={`DROP ${String(drop.drop_number).padStart(3, '0')}`}
        fallback="/(tabs)/shop"
      />

      {notice ? (
        <Animated.View
          entering={reduceMotion ? undefined : FadeIn.duration(180)}
          exiting={reduceMotion ? undefined : FadeOut.duration(150)}>
          <TopNotice tone="ok" text={notice} />
        </Animated.View>
      ) : null}
      {error ? <TopNotice tone="error" text={error} onDismiss={() => setError(null)} /> : null}

      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor="#fff"
            onRefresh={async () => {
              // load() never manages a refreshing flag itself — this does.
              setRefreshing(true);
              try {
                await load();
              } finally {
                setRefreshing(false);
              }
            }}
          />
        }>
        <View style={styles.art}>
          {image ? (
            <Image source={{ uri: image }} style={StyleSheet.absoluteFill} contentFit="cover" transition={200} />
          ) : (
            <Image
              source={
                drop.project === 's333xgod'
                  ? require('../../../assets/images/emblem-s333xgod.png')
                  : require('../../../assets/images/emblem-mazze.png')
              }
              style={styles.artEmblem}
              contentFit="contain"
            />
          )}
          {status === 'sold_out' ? (
            <View style={styles.soldWash}>
              <Text style={styles.soldStamp}>SOLD OUT</Text>
            </View>
          ) : null}
          <View style={styles.artScrim} />
          <Text style={styles.artTitle}>{drop.title}</Text>
        </View>

        <Text style={styles.kicker}>
          HAND-FINISHED · {drop.run_size} NUMBERED ·{' '}
          {drop.project === 's333xgod' ? 'S333XGOD' : 'MAZZE'}
        </Text>

        <View style={styles.priceRow}>
          <Text style={styles.price}>{priceLabel(drop.price_cents)}</Text>
          {status === 'live' ? (
            <Text style={styles.leftText}>{left} LEFT</Text>
          ) : status === 'upcoming' ? (
            <Text style={styles.count}>{countdownTo(drop.drops_at, now + (serverNowMs() - Date.now()))}</Text>
          ) : (
            <Text style={styles.soldText}>NEVER AGAIN</Text>
          )}
        </View>
        {status === 'live' ? (
          <View style={styles.meter}>
            <View style={[styles.meterFill, { width: `${(active.length / drop.run_size) * 100}%` }]} />
          </View>
        ) : null}

        {/* ---------- fan side ---------- */}
        {mine ? (
          <View style={styles.mineCard}>
            <Text style={styles.mineTitle}>
              {mine.status === 'hold' ? `#${mine.edition_number} IS ON HOLD` : `#${mine.edition_number} IS YOURS`}
            </Text>
            <Text style={styles.sub}>
              {mine.status === 'hold'
                ? 'Reserved for you for a few minutes.'
                : mine.status === 'shipped'
                ? `Shipped${fulfillment[mine.id]?.tracking ? ` · tracking ${fulfillment[mine.id].tracking}` : ''}. It's on the way.`
                : mine.status === 'in_works'
                  ? 'Being printed and hand-finished.'
                  : 'Claimed. Yours goes into the works now.'}
            </Text>
          </View>
        ) : status === 'live' && !isArtist && !SHOP_PAYMENTS_LIVE ? (
          // No Stripe on this build: one line, no grid, no button.
          <Text style={styles.sub}>{"Orders aren't open yet."}</Text>
        ) : status === 'live' && !isArtist ? (
          <>
            <Text style={styles.sectionHead}>PICK YOUR NUMBER</Text>
            <Text style={styles.subHead}>{"It's printed into the piece."}</Text>
            <View style={styles.numbers}>
              {Array.from({ length: drop.run_size }, (_, i) => i + 1).map((n) => {
                const gone = taken.has(n);
                const on = pickedNumber === n;
                return (
                  <Pressable
                    key={n}
                    disabled={gone}
                    style={[styles.num, on && styles.numOn, gone && styles.numGone]}
                    onPress={() => {
                      // Picking from a set — the selection tick, not an impact.
                      selectFeedback();
                      setPickedNumber(n);
                    }}>
                    <Text style={[styles.numText, on && styles.numTextOn, gone && styles.numTextGone]}>
                      {n}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Pressable
              style={[styles.buy, pickedNumber == null && styles.buyDisabled]}
              disabled={pickedNumber == null}
              onPress={handleBuy}>
              <Text style={styles.buyText}>
                {pickedNumber == null ? 'PICK A NUMBER' : `BUY #${pickedNumber} · ${priceLabel(drop.price_cents)}`}
              </Text>
            </Pressable>
            <Text style={styles.subCenter}>
              One per fan. Ships in the US within 5 to 7 business days, shipping included.
            </Text>
          </>
        ) : null}

        {/* ---------- the registry ---------- */}
        {owners.length > 0 ? (
          <>
            <Text style={styles.sectionHead}>THE REGISTRY</Text>
            {owners.map((claim) => (
              <View key={claim.id} style={styles.claimRow}>
                <Text style={styles.claimNum}>{`#${claim.edition_number}`}</Text>
                <Avatar
                  path={claim.owner?.avatar_path}
                  focus={claim.owner?.avatar_focus}
                  name={claim.owner?.display_name}
                  size={26}
                />
                <View style={styles.claimMeta}>
                  <Text style={styles.claimName} numberOfLines={1}>
                    {displayName(claim.owner)}
                  </Text>
                  {isArtist && fulfillment[claim.id]?.address ? (
                    <Text style={styles.claimAddress} numberOfLines={2}>
                      {fulfillment[claim.id].address}
                    </Text>
                  ) : null}
                  {(isArtist || claim.user_id === session?.user.id) &&
                  fulfillment[claim.id]?.tracking ? (
                    <Text style={styles.claimTracking} numberOfLines={1}>
                      {fulfillment[claim.id].tracking}
                    </Text>
                  ) : null}
                </View>
                {isArtist ? (
                  claim.status === 'shipped' ? (
                    <Text style={styles.shippedChip}>SHIPPED</Text>
                  ) : shipTarget === claim.id ? (
                    <View style={styles.shipForm}>
                      <TextInput
                        style={styles.shipInput}
                        placeholder="Tracking #"
                        placeholderTextColor="#55585f"
                        value={trackingDraft}
                        onChangeText={setTrackingDraft}
                        autoFocus
                      />
                      <Pressable onPress={() => handleMarkShipped(claim)} hitSlop={8}>
                        <Text style={styles.shipGo}>SHIP</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      style={styles.shipButton}
                      onPress={() => {
                        setTrackingDraft('');
                        setShipTarget(claim.id);
                      }}>
                      <Text style={styles.shipButtonText}>MARK SHIPPED</Text>
                    </Pressable>
                  )
                ) : claim.status === 'shipped' ? (
                  <Text style={styles.shippedChip}>SHIPPED</Text>
                ) : null}
              </View>
            ))}
          </>
        ) : null}

        {/* ---------- artist side ---------- */}
        <Pressable
          style={styles.termsRow}
          onPress={() => router.push('/legal/shop-terms' as never)}>
          <Text style={styles.termsText}>Shop Terms</Text>
          <Ionicons name="chevron-forward" size={13} color="#55585f" />
        </Pressable>

        {isArtist ? (
          <>
            <Text style={styles.sectionHead}>ARTIST</Text>
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statBig}>
                  {owners.length}
                  <Text style={styles.statDim}>/{drop.run_size}</Text>
                </Text>
                <Text style={styles.statLabel}>SOLD</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statBig}>{`$${grossDollars}`}</Text>
                <Text style={styles.statLabel}>GROSS</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statBig}>{toShip}</Text>
                <Text style={styles.statLabel}>TO SHIP</Text>
              </View>
            </View>

            {!drop.is_published ? (
              <Pressable
                style={styles.editRow}
                onPress={() => router.push(`/drop-edit/${drop.id}` as never)}>
                <Ionicons name="pencil" size={13} color="#8f99a3" />
                <Text style={styles.editText}>Edit draft</Text>
              </Pressable>
            ) : null}
            {!drop.is_published ? (
              confirmPublish ? (
                // The inline confirm: question, go word, Cancel, in chips (post-card's).
                <Animated.View
                  style={styles.confirmRow}
                  entering={reduceMotion ? undefined : FadeInDown.duration(160)}>
                  <Text style={styles.confirmText}>Go live and push every fan?</Text>
                  <Pressable style={styles.confirmChip} onPress={handlePublish}>
                    <Text style={styles.confirmGo}>Publish</Text>
                  </Pressable>
                  <Pressable style={styles.confirmChip} onPress={() => setConfirmPublish(false)}>
                    <Text style={styles.confirmGo}>Cancel</Text>
                  </Pressable>
                </Animated.View>
              ) : (
                <Pressable style={styles.buy} onPress={() => setConfirmPublish(true)}>
                  <Text style={styles.buyText}>PUBLISH DROP · PUSH EVERY FAN</Text>
                </Pressable>
              )
            ) : null}

            {drop.claims.length === 0 ? (
              confirmDelete ? (
                <Animated.View
                  style={styles.confirmRow}
                  entering={reduceMotion ? undefined : FadeInDown.duration(160)}>
                  <Text style={styles.confirmText}>Delete this drop?</Text>
                  <Pressable style={styles.confirmChip} onPress={handleDelete}>
                    <Text style={styles.confirmDanger}>Delete</Text>
                  </Pressable>
                  <Pressable style={styles.confirmChip} onPress={() => setConfirmDelete(false)}>
                    <Text style={styles.confirmGo}>Cancel</Text>
                  </Pressable>
                </Animated.View>
              ) : (
                <Pressable style={styles.deleteRow} onPress={() => setConfirmDelete(true)}>
                  <Text style={styles.deleteText}>Delete drop</Text>
                </Pressable>
              )
            ) : null}
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Ghost of the drop page — art, kicker, price, and a numbers grid. */
function DropSkeleton() {
  return (
    <View style={styles.body}>
      <Skeleton height={0} radius={16} style={styles.skeletonArt} />
      <Skeleton width="30%" height={10} style={styles.skeletonKicker} />
      <Skeleton width="40%" height={28} style={styles.skeletonPrice} />
      <View style={styles.skeletonNumbers}>
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} width={46} height={38} radius={10} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  // Style applies after the height prop, so the aspect box wins.
  skeletonArt: { height: undefined, aspectRatio: 1 / 1.02, overflow: 'hidden' },
  skeletonKicker: { marginTop: 12 },
  skeletonPrice: { marginTop: 8 },
  skeletonNumbers: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 22 },
  goneTitle: { ...sectionHead, paddingVertical: 8 },
  body: { padding: 14, paddingBottom: 60 },
  art: {
    borderRadius: 16,
    aspectRatio: 1 / 1.02,
    backgroundColor: '#14171b',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  artEmblem: {
    position: 'absolute',
    alignSelf: 'center',
    top: '15%',
    width: '60%',
    height: '60%',
    opacity: 0.35,
  },
  artScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 90,
    backgroundColor: 'rgba(4,6,8,0.55)',
  },
  artTitle: {
    fontFamily: DISPLAY_FONT,
    color: '#fff',
    fontSize: 24,
    letterSpacing: 2,
    padding: 14,
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 8,
  },
  soldWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(6,7,9,0.55)',
  },
  soldStamp: {
    fontFamily: DISPLAY_FONT,
    color: '#fff',
    fontSize: 30,
    letterSpacing: 5,
    borderWidth: 3,
    borderColor: '#fff',
    borderRadius: 6,
    paddingHorizontal: 18,
    paddingVertical: 5,
    transform: [{ rotate: '-9deg' }],
  },
  kicker: { ...kicker, marginTop: 12 },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 8,
  },
  price: { fontFamily: DISPLAY_FONT, color: '#fff', fontSize: 30, letterSpacing: 1.5 },
  leftText: { ...stockLeft, color: '#f87171' },
  soldText: { ...stockLeft, color: '#8f99a3' },
  count: { fontFamily: DISPLAY_FONT, color: '#fff', fontSize: 24, letterSpacing: 2 },
  meter: { height: 5, borderRadius: 4, backgroundColor: '#23262b', overflow: 'hidden', marginTop: 9 },
  meterFill: { height: 5, borderRadius: 4, backgroundColor: '#c3cdd6' },
  sectionHead: { ...sectionHead, marginTop: 22, marginBottom: 10 },
  // The one-line sub directly under PICK YOUR NUMBER; closes the head's gap.
  subHead: { color: '#8f99a3', fontSize: 12.5, lineHeight: 18, marginTop: -6, marginBottom: 10 },
  numbers: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  num: {
    width: 46,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#1a1d22',
    alignItems: 'center',
  },
  numOn: { backgroundColor: '#c3cdd6' },
  numGone: { opacity: 0.28 },
  numText: { color: '#8f99a3', fontWeight: '700', fontSize: 13 },
  numTextOn: { color: '#0b0c0e' },
  numTextGone: { textDecorationLine: 'line-through' },
  buy: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    padding: 15,
    alignItems: 'center',
    marginTop: 16,
  },
  buyDisabled: { opacity: 0.4 },
  buyText: pillText,
  sub: { color: '#8f99a3', fontSize: 12.5, lineHeight: 18, marginTop: 4 },
  subCenter: { color: '#55585f', fontSize: 11.5, lineHeight: 17, textAlign: 'center', marginTop: 10 },
  mineCard: {
    backgroundColor: '#14171b',
    borderWidth: 1,
    borderColor: 'rgba(195,205,214,0.35)',
    borderRadius: 16,
    padding: 16,
    marginTop: 18,
  },
  mineTitle: { fontFamily: DISPLAY_FONT, color: '#c3cdd6', fontSize: 17, letterSpacing: 2 },
  claimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1c2025',
  },
  claimNum: {
    fontFamily: DISPLAY_FONT,
    color: '#c3cdd6',
    fontSize: 14,
    letterSpacing: 1,
    width: 36,
  },
  claimMeta: { flex: 1 },
  claimName: { color: '#fff', fontSize: 13, fontWeight: '600' },
  claimAddress: { color: '#8f99a3', fontSize: 10.5, marginTop: 1, lineHeight: 14 },
  claimTracking: { color: '#7ed354', fontSize: 10, marginTop: 1 },
  shippedChip: { color: '#7ed354', fontSize: 10, fontWeight: '700', letterSpacing: 1 },
  shipButton: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  shipButtonText: { color: '#0b0c0e', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5 },
  shipForm: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shipInput: {
    backgroundColor: '#131519',
    color: '#fff',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    fontSize: 12,
    minWidth: 110,
  },
  shipGo: { color: '#c3cdd6', fontWeight: '800', fontSize: 11, letterSpacing: 1 },
  stats: { flexDirection: 'row', gap: 8 },
  stat: {
    flex: 1,
    backgroundColor: '#14171b',
    borderWidth: 1,
    borderColor: '#23262b',
    borderRadius: 12,
    padding: 12,
  },
  statBig: { fontFamily: DISPLAY_FONT, color: '#fff', fontSize: 20, letterSpacing: 1 },
  statDim: { color: '#55585f' },
  statLabel: { ...capLabel, marginTop: 3 },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
    marginTop: 14,
  },
  confirmText: { ...confirmQuestion, flexShrink: 1 },
  confirmChip: chip,
  confirmGo: confirmWord,
  confirmDanger,
  deleteRow: { alignItems: 'center', marginTop: 18 },
  deleteText: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 14,
  },
  editText: { color: '#8f99a3', fontSize: 13, fontWeight: '600' },
  termsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 24,
  },
  termsText: { color: '#55585f', fontSize: 12 },
});
