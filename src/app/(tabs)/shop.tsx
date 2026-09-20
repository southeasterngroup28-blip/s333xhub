import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/app-background';
import { EdgeGlass, FadeMask } from '@/components/edge-fade';
import { countdownTo, useNow } from '@/lib/countdown';
import { EmptyState } from '@/components/empty-state';
import { ChatRowSkeleton } from '@/components/skeleton';
import { ScalePressable } from '@/components/ui/scale-pressable';
import { RETRY } from '@/constants/copy';
import { DISPLAY_FONT } from '@/constants/type';
import { fanCopy } from '@/lib/fan-error';
import { tapFeedback } from '@/lib/haptics';
import {
  activeClaims,
  dropImageUrl,
  serverNowMs,
  dropStatus,
  fetchDrops,
  priceLabel,
  remaining,
  type Drop,
} from '@/lib/shop';
import { useAuth } from '@/providers/auth-provider';

/**
 * The "DROPS IN" clock. Owns the 1 s tick so it re-renders this one Text,
 * not the whole tab; reports once when the moment passes so the parent
 * re-derives the drop's status (upcoming -> live) exactly as it used to.
 */
function Countdown({ to, onElapsed }: { to: string; onElapsed: () => void }) {
  const now = useNow();
  const text = countdownTo(to, now + (serverNowMs() - Date.now()));
  useEffect(() => {
    if (!text) onElapsed();
  }, [text, onElapsed]);
  return <Text style={styles.count}>{text}</Text>;
}

export default function ShopScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const isArtist = profile?.role === 'artist';
  // Bumped by a Countdown reaching zero, so the card flips to live.
  const [, setEpoch] = useState(0);
  const onElapsed = useCallback(() => setEpoch((n) => n + 1), []);
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);

  // Re-tapping the shop bubble scrolls back to the top (switch-to is ignored).
  useEffect(
    () =>
      navigation.addListener('tabPress' as never, (() => {
        if (!navigation.isFocused()) return;
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }) as never),
    [navigation]
  );

  const [drops, setDrops] = useState<Drop[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDrops(await fetchDrops());
      setError(null);
    } catch (e) {
      setError(fanCopy(e, 'Could not load the shop.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBackground />

      {loading ? (
        <View style={[styles.list, styles.loadingPad]}>
          <ChatRowSkeleton />
          <ChatRowSkeleton />
        </View>
      ) : (
        <FadeMask>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor="#fff"
              onRefresh={async () => {
                // load() never manages a refreshing flag itself; this does.
                setRefreshing(true);
                try {
                  await load();
                } finally {
                  setRefreshing(false);
                }
              }}
            />
          }>
          {drops.length === 0 ? (
            error ? (
              // A failed load must never masquerade as an empty shelf.
              <EmptyState
                icon="cloud-offline-outline"
                title="Couldn't load the shop"
                sub="Check your connection."
                action={{
                  label: RETRY,
                  onPress: () => {
                    tapFeedback();
                    setLoading(true);
                    load();
                  },
                }}
              />
            ) : (
              <EmptyState
                icon="bag-outline"
                title="Nothing on the shelf"
                sub={
                  isArtist
                    ? 'Tap + to set up Drop 001.'
                    : 'You get a push when it goes live.'
                }
              />
            )
          ) : (
            drops.map((drop) => {
              const status = dropStatus(drop);
              const image = dropImageUrl(drop.image_path);
              const left = remaining(drop);
              return (
                <ScalePressable
                  key={drop.id}
                  style={[styles.card, drop.project === 's333xgod' ? styles.cardGod : styles.cardMazze]}
                  onPress={() => router.push(`/drop/${drop.id}` as never)}>
                  <View style={styles.cardHead}>
                    <Text
                      style={[
                        styles.kicker,
                        status === 'live' && styles.kickerLive,
                        status === 'sold_out' && styles.kickerSold,
                      ]}>
                      {`DROP ${String(drop.drop_number).padStart(3, '0')}`}
                      {!drop.is_published
                        ? ' · DRAFT'
                        : status === 'live'
                          ? ' · LIVE NOW'
                          : status === 'upcoming'
                            ? ' · UPCOMING'
                            : ' · SOLD OUT'}
                    </Text>
                    <Text style={styles.chip}>LIMIT 1 PER FAN</Text>
                  </View>

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
                    <Text style={styles.artTitle} numberOfLines={1}>
                      {drop.title}
                    </Text>
                  </View>

                  <View style={styles.cardFoot}>
                    {status === 'upcoming' ? (
                      <>
                        <Text style={styles.footLabel}>DROPS IN</Text>
                        <Countdown to={drop.drops_at} onElapsed={onElapsed} />
                      </>
                    ) : status === 'live' ? (
                      <>
                        <Text style={styles.leftText}>
                          {left} OF {drop.run_size} LEFT
                        </Text>
                        <Text style={styles.price}>{priceLabel(drop.price_cents)}</Text>
                      </>
                    ) : (
                      <>
                        <Text style={styles.footLabel}>
                          {drop.run_size} MADE · NEVER AGAIN
                        </Text>
                        <Text style={styles.price}>{priceLabel(drop.price_cents)}</Text>
                      </>
                    )}
                  </View>
                  {status === 'live' ? (
                    <View style={styles.meter}>
                      <View
                        style={[styles.meterFill, { width: `${(activeClaims(drop).length / drop.run_size) * 100}%` }]}
                      />
                    </View>
                  ) : null}
                </ScalePressable>
              );
            })
          )}
        </ScrollView>
        </FadeMask>
      )}

      <EdgeGlass />
      <View style={[styles.topBar, { top: insets.top }]} pointerEvents="box-none">
        <Text style={styles.title}>S333XSHOP</Text>
        {isArtist ? (
          <Pressable
            onPress={() => router.push('/drop-new' as never)}
            hitSlop={12}
            style={styles.newButton}>
            <Ionicons name="add" size={22} color="#0b0c0e" />
          </Pressable>
        ) : null}
      </View>
      {error && drops.length > 0 ? (
        <Text style={[styles.error, { top: insets.top + 48 }]}>{error}</Text>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { color: '#f4f5f6', fontSize: 22, fontFamily: DISPLAY_FONT, letterSpacing: 3 },
  newButton: {
    position: 'absolute',
    right: 16,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    textAlign: 'center',
    color: '#f87171',
    paddingHorizontal: 16,
    fontSize: 13,
  },
  list: { padding: 14, paddingTop: 52, paddingBottom: 150, flexGrow: 1 },
  loadingPad: { paddingTop: 52 },
  card: {
    backgroundColor: '#101216',
    borderRadius: 16,
    padding: 13,
    marginBottom: 14,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  cardGod: { borderColor: 'rgba(88, 178, 235, 0.22)' },
  cardMazze: { borderColor: 'rgba(126, 211, 84, 0.18)' },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  kicker: { fontSize: 10, fontWeight: '700', letterSpacing: 1.6, color: '#8f99a3' },
  kickerLive: { color: '#7ed354' },
  kickerSold: { color: '#f87171' },
  chip: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    color: '#c3cdd6',
    backgroundColor: 'rgba(195,205,214,0.1)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  art: {
    marginTop: 10,
    borderRadius: 12,
    aspectRatio: 4 / 3,
    backgroundColor: '#14171b',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  artEmblem: {
    position: 'absolute',
    alignSelf: 'center',
    top: '12%',
    width: '55%',
    height: '60%',
    opacity: 0.35,
  },
  artScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 70,
    backgroundColor: 'rgba(4,6,8,0.55)',
  },
  artTitle: {
    fontFamily: DISPLAY_FONT,
    color: '#fff',
    fontSize: 19,
    letterSpacing: 1.5,
    padding: 12,
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
    fontSize: 26,
    letterSpacing: 4,
    borderWidth: 3,
    borderColor: '#fff',
    borderRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 4,
    transform: [{ rotate: '-9deg' }],
  },
  cardFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 11,
  },
  footLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, color: '#8f99a3' },
  leftText: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: '#f87171' },
  count: {
    fontFamily: DISPLAY_FONT,
    color: '#fff',
    fontSize: 22,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  price: { color: '#fff', fontSize: 16, fontWeight: '700' },
  meter: { height: 5, borderRadius: 4, backgroundColor: '#23262b', overflow: 'hidden', marginTop: 9 },
  meterFill: { height: 5, borderRadius: 4, backgroundColor: '#c3cdd6' },
});
