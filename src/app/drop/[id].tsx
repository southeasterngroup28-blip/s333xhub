import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { AppBackground } from '@/components/app-background';
import { Avatar } from '@/components/avatar';
import { DISPLAY_FONT } from '@/constants/type';
import { pressFeedback, successFeedback } from '@/lib/haptics';
import {
  SHOP_PAYMENTS_LIVE,
  deleteDrop,
  dropImageUrl,
  dropStatus,
  fetchDrop,
  fetchFulfillment,
  markShipped,
  publishDrop,
  remaining,
  type Claim,
  type Drop,
  type Fulfillment,
} from '@/lib/shop';
import { useAuth } from '@/providers/auth-provider';
import { countdownTo, useNow } from '@/lib/countdown';

export default function DropScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const router = useRouter();
  const isArtist = profile?.role === 'artist';
  const now = useNow();

  const [drop, setDrop] = useState<Drop | null>(null);
  const [fulfillment, setFulfillment] = useState<Record<string, Fulfillment>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pickedNumber, setPickedNumber] = useState<number | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  /** Which claim is getting a tracking number typed in. */
  const [shipTarget, setShipTarget] = useState<string | null>(null);
  const [trackingDraft, setTrackingDraft] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const fresh = await fetchDrop(id);
      setDrop(fresh);
      if (fresh) {
        setFulfillment(await fetchFulfillment(fresh.claims.map((c) => c.id)).catch(() => ({})));
      }
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not load the drop.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/shop' as never);
  }

  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(null), 3000);
  }

  async function handleBuy() {
    pressFeedback();
    // Hard gate, same as Fan Mail: no Stripe yet means no orders, period.
    if (!SHOP_PAYMENTS_LIVE) {
      setError('Purchases open with the App Store version — this drop is a preview.');
      return;
    }
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
      setError((e as { message?: string })?.message ?? 'Could not publish.');
    }
  }

  async function handleDelete() {
    setConfirmDelete(false);
    try {
      await deleteDrop(drop!.id);
      goBack();
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not delete.');
    }
  }

  async function handleMarkShipped(claim: Claim) {
    const tracking = trackingDraft.trim();
    setShipTarget(null);
    setTrackingDraft('');
    try {
      await markShipped(claim.id, tracking);
      successFeedback();
      flash(`#${claim.edition_number} marked shipped — its owner got the push.`);
      await load();
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not mark shipped.');
    }
  }

  if (loading || !drop) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.center}>
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.muted}>Drop not found.</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const status = dropStatus(drop);
  const image = dropImageUrl(drop.image_path);
  const left = remaining(drop);
  const taken = new Set(drop.claims.map((c) => c.edition_number));
  const mine = drop.claims.find((c) => c.user_id === session?.user.id) ?? null;
  const gross = drop.claims.length * drop.price_cents;
  const toShip = drop.claims.filter((c) => c.status !== 'shipped').length;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <AppBackground />
      <View style={styles.header}>
        <Pressable onPress={goBack} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>{`DROP ${String(drop.drop_number).padStart(3, '0')}`}</Text>
        <View style={{ width: 24 }} />
      </View>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView contentContainerStyle={styles.body}>
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
          <Text style={styles.price}>${(drop.price_cents / 100).toFixed(0)}</Text>
          {status === 'live' ? (
            <Text style={styles.leftText}>{left} LEFT</Text>
          ) : status === 'upcoming' ? (
            <Text style={styles.count}>{countdownTo(drop.drops_at, now)}</Text>
          ) : (
            <Text style={styles.soldText}>NEVER AGAIN</Text>
          )}
        </View>
        {status === 'live' ? (
          <View style={styles.meter}>
            <View style={[styles.meterFill, { width: `${(drop.claims.length / drop.run_size) * 100}%` }]} />
          </View>
        ) : null}

        {/* ---------- fan side ---------- */}
        {mine ? (
          <View style={styles.mineCard}>
            <Text style={styles.mineTitle}>#{mine.edition_number} IS YOURS</Text>
            <Text style={styles.sub}>
              {mine.status === 'shipped'
                ? `Shipped${fulfillment[mine.id]?.tracking ? ` · tracking ${fulfillment[mine.id].tracking}` : ''} — it's on the way.`
                : mine.status === 'in_works'
                  ? 'Being printed and hand-finished.'
                  : 'Claimed. It enters the works with the run.'}
            </Text>
          </View>
        ) : status === 'live' && !isArtist ? (
          <>
            <Text style={styles.sectionLabel}>PICK YOUR NUMBER — IT'S PRINTED INTO THE PIECE</Text>
            <View style={styles.numbers}>
              {Array.from({ length: drop.run_size }, (_, i) => i + 1).map((n) => {
                const gone = taken.has(n);
                const on = pickedNumber === n;
                return (
                  <Pressable
                    key={n}
                    disabled={gone}
                    style={[styles.num, on && styles.numOn, gone && styles.numGone]}
                    onPress={() => setPickedNumber(n)}>
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
                {pickedNumber == null ? 'PICK A NUMBER' : `BUY #${pickedNumber} · $${(drop.price_cents / 100).toFixed(0)}`}
              </Text>
            </Pressable>
            <Text style={styles.subCenter}>
              Secure checkout by Stripe · Limit 1 per fan{'\n'}Made in-house · ships in 5–7 days
            </Text>
          </>
        ) : null}

        {/* ---------- the registry ---------- */}
        {drop.claims.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>THE REGISTRY</Text>
            {drop.claims.map((claim) => (
              <View key={claim.id} style={styles.claimRow}>
                <Text style={styles.claimNum}>#{String(claim.edition_number).padStart(2, '0')}</Text>
                <Avatar
                  path={claim.owner?.avatar_path}
                  focus={claim.owner?.avatar_focus}
                  name={claim.owner?.display_name}
                  size={26}
                />
                <View style={styles.claimMeta}>
                  <Text style={styles.claimName} numberOfLines={1}>
                    {claim.owner?.display_name ?? 'Unknown'}
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
                    <Text style={styles.shippedChip}>SHIPPED ✓</Text>
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
                    <Pressable style={styles.shipButton} onPress={() => setShipTarget(claim.id)}>
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
        {isArtist ? (
          <>
            <Text style={styles.sectionLabel}>ARTIST</Text>
            <View style={styles.stats}>
              <View style={styles.stat}>
                <Text style={styles.statBig}>
                  {drop.claims.length}
                  <Text style={styles.statDim}>/{drop.run_size}</Text>
                </Text>
                <Text style={styles.statLabel}>SOLD</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statBig}>${(gross / 100).toFixed(0)}</Text>
                <Text style={styles.statLabel}>GROSS</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statBig}>{toShip}</Text>
                <Text style={styles.statLabel}>TO SHIP</Text>
              </View>
            </View>

            {!drop.is_published ? (
              confirmPublish ? (
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmText}>Go live and push every fan?</Text>
                  <Pressable onPress={handlePublish}>
                    <Text style={styles.confirmYes}>PUBLISH</Text>
                  </Pressable>
                  <Pressable onPress={() => setConfirmPublish(false)}>
                    <Text style={styles.confirmNo}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable style={styles.buy} onPress={() => setConfirmPublish(true)}>
                  <Text style={styles.buyText}>PUBLISH DROP · PUSH EVERY FAN</Text>
                </Pressable>
              )
            ) : null}

            {drop.claims.length === 0 ? (
              confirmDelete ? (
                <View style={styles.confirmRow}>
                  <Text style={styles.confirmText}>Delete this drop?</Text>
                  <Pressable onPress={handleDelete}>
                    <Text style={styles.confirmYes}>DELETE</Text>
                  </Pressable>
                  <Pressable onPress={() => setConfirmDelete(false)}>
                    <Text style={styles.confirmNo}>Cancel</Text>
                  </Pressable>
                </View>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#55585f' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    color: '#fff',
    fontSize: 17,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 2,
  },
  notice: { color: '#4fc07a', paddingHorizontal: 16, paddingVertical: 4, fontSize: 13 },
  error: { color: '#f87171', paddingHorizontal: 16, paddingVertical: 4, fontSize: 13 },
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
  kicker: {
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 1.6,
    color: '#8f99a3',
    marginTop: 12,
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 8,
  },
  price: { fontFamily: DISPLAY_FONT, color: '#fff', fontSize: 30, letterSpacing: 1.5 },
  leftText: { fontSize: 12, fontWeight: '700', letterSpacing: 1.4, color: '#f87171' },
  soldText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.4, color: '#8f99a3' },
  count: { fontFamily: DISPLAY_FONT, color: '#fff', fontSize: 24, letterSpacing: 2 },
  meter: { height: 5, borderRadius: 4, backgroundColor: '#23262b', overflow: 'hidden', marginTop: 9 },
  meterFill: { height: 5, borderRadius: 4, backgroundColor: '#c3cdd6' },
  sectionLabel: {
    color: '#6d7076',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginTop: 22,
    marginBottom: 10,
  },
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
  buyText: { color: '#0b0c0e', fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },
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
  statLabel: { color: '#6d7076', fontSize: 9, fontWeight: '700', letterSpacing: 1.2, marginTop: 3 },
  confirmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#131519',
    borderRadius: 12,
    padding: 13,
    marginTop: 14,
  },
  confirmText: { color: '#ccc', flex: 1, fontSize: 13 },
  confirmYes: { color: '#7ed354', fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  confirmNo: { color: '#8f99a3', fontSize: 13 },
  deleteRow: { alignItems: 'center', marginTop: 18 },
  deleteText: { color: '#f87171', fontSize: 13, fontWeight: '600' },
});
