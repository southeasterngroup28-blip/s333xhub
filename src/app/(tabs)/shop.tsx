import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/app-background';
import { EdgeGlass, FadeMask } from '@/components/edge-fade';
import { countdownTo, useNow } from '@/lib/countdown';
import { ErrorCard } from '@/components/empty-state';
import {
  ROOT_FADE_TOP,
  ROOT_LIST_TOP,
  ROOT_NOTICE_TOP,
  RootHeader,
} from '@/components/root-header';
import { ChatRowSkeleton } from '@/components/skeleton';
import { TopNotice } from '@/components/top-notice';
import { ScalePressable } from '@/components/ui/scale-pressable';
import { CHAT_HAIRLINE_MINE, CHAT_SURFACE_ROW } from '@/constants/chat-surfaces';
import { DISPLAY_FONT, capLabel, kicker, sectionHead, stockLeft } from '@/constants/type';
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

export default function ShopScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const navigation = useNavigation();
  const isArtist = profile?.role === 'artist';
  const now = useNow();
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
        <FadeMask top={ROOT_FADE_TOP}>
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
              <ErrorCard
                title="COULDN'T LOAD THE SHOP"
                onRetry={() => {
                  tapFeedback();
                  setLoading(true);
                  load();
                }}
              />
            ) : (
              // The shelf's own shape with nothing on it: kicker, blank art, one line.
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <Text style={styles.kicker}>DROP 001</Text>
                </View>
                <View style={[styles.art, styles.artBlank]} />
                <View style={styles.cardFoot}>
                  <View>
                    <Text style={styles.emptyTitle}>NOTHING ON THE SHELF</Text>
                    <Text style={styles.footLabel}>
                      {isArtist ? 'Tap + to set up Drop 001.' : 'You get a push when it goes live.'}
                    </Text>
                  </View>
                </View>
              </View>
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
                    {/* A live drop gets the one green dot before its kicker (chat.tsx's countDot). */}
                    {status === 'live' && drop.is_published ? <View style={styles.liveDot} /> : null}
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
                        <Text style={styles.count}>{countdownTo(drop.drops_at, now + (serverNowMs() - Date.now()))}</Text>
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
      <RootHeader
        title="S333XSHOP"
        actions={
          isArtist ? (
            <Pressable
              onPress={() => router.push('/drop-new' as never)}
              hitSlop={12}
              style={styles.newButton}>
              <Ionicons name="add" size={22} color="#0b0c0e" />
            </Pressable>
          ) : null
        }
      />
      {error && drops.length > 0 ? (
        <TopNotice
          tone="error"
          text={error}
          onDismiss={() => setError(null)}
          absoluteTop={insets.top + ROOT_NOTICE_TOP}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  newButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { padding: 14, paddingTop: ROOT_LIST_TOP, paddingBottom: 150, flexGrow: 1 },
  loadingPad: { paddingTop: ROOT_LIST_TOP },
  // The same translucent surface as the shows row; the 1px project-colour
  // border is the only edge, and the art runs edge to edge beneath the kicker.
  card: {
    backgroundColor: CHAT_SURFACE_ROW,
    borderRadius: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: CHAT_HAIRLINE_MINE,
    overflow: 'hidden',
  },
  cardGod: { borderColor: 'rgba(88, 178, 235, 0.22)' },
  cardMazze: { borderColor: 'rgba(126, 211, 84, 0.18)' },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 13,
    paddingTop: 12,
    paddingBottom: 10,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#7ed354' },
  kicker,
  kickerLive: { color: '#7ed354' },
  kickerSold: { color: '#f87171' },
  art: {
    aspectRatio: 4 / 3,
    backgroundColor: '#14171b',
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  artBlank: { backgroundColor: '#07090b' },
  emptyTitle: { ...sectionHead, marginBottom: 4 },
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
    paddingHorizontal: 13,
    paddingTop: 11,
    paddingBottom: 13,
  },
  footLabel: { ...capLabel, color: '#8f99a3' },
  leftText: { ...stockLeft, color: '#f87171' },
  count: {
    fontFamily: DISPLAY_FONT,
    color: '#fff',
    fontSize: 22,
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
  },
  price: { color: '#fff', fontSize: 16, fontWeight: '700' },
  meter: {
    height: 5,
    borderRadius: 4,
    backgroundColor: '#23262b',
    overflow: 'hidden',
    marginHorizontal: 13,
    marginBottom: 13,
    marginTop: -4,
  },
  meterFill: { height: 5, borderRadius: 4, backgroundColor: '#c3cdd6' },
});
