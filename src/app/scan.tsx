import Ionicons from '@expo/vector-icons/Ionicons';
import type { BarcodeScanningResult } from 'expo-camera';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScalePressable } from '@/components/ui/scale-pressable';
import { DISPLAY_FONT } from '@/constants/type';
import { errorFeedback, successFeedback, tapFeedback } from '@/lib/haptics';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { fetchShow, showDateParts } from '@/lib/shows';
import { checkInTicket, fetchTicketsForShow } from '@/lib/tickets';
import { useAuth } from '@/providers/auth-provider';

// expo-camera looks up its native module the moment the package is
// imported, so a build made before the scanner was added throws right
// there — and a route module that throws takes the whole router down with
// it ("Cannot read property 'ErrorBoundary' of undefined"). So the camera
// is required lazily, inside the screen, and a miss shows a note instead.
// (Only the type comes in at the top — types are erased, they can't throw.)
type CameraModule = typeof import('expo-camera');
let cameraModule: CameraModule | null | undefined;

function loadCamera(): CameraModule | null {
  if (cameraModule !== undefined) return cameraModule;
  try {
    cameraModule = require('expo-camera') as CameraModule;
  } catch (e) {
    console.warn('[scan] expo-camera is missing from this build — scanner disabled.', e);
    cameraModule = null;
  }
  return cameraModule;
}

/** The same QR code keeps firing while it's in frame — one check per 3s. */
const REPEAT_WINDOW_MS = 3000;
/** How long a result stays up before the scanner looks fresh again. */
const BANNER_MS = 6000;
/**
 * A ticket that was just ACCEPTED is ignored for as long as its green
 * banner is up (so at least BANNER_MS): a phone left in frame must never
 * flip a fresh "Checked in" into a red "Already checked in".
 */
const ACCEPTED_WINDOW_MS = BANNER_MS;

/** What check_in_ticket hands back (the RPC's jsonb, typed loosely on purpose). */
type ScanOutcome = {
  ok: boolean;
  reason?: string | null;
  buyer_name?: string | null;
  show_title?: string | null;
  status?: string | null;
  checked_in_at?: string | null;
};

type Banner = {
  tone: 'ok' | 'bad' | 'checking';
  title: string;
  detail: string;
  /** When it went up — a stale timer never clears a newer banner. */
  at: number;
};

/** "9:52 PM" in the phone's zone — the phone is at the door. */
function clockLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(when);
}

function refusedBanner(result: ScanOutcome, at: number): Banner {
  const who = result.buyer_name ?? '';
  switch (result.reason) {
    case 'wrong_show':
      return {
        tone: 'bad',
        title: 'Wrong show',
        detail: result.show_title
          ? `This ticket is for ${result.show_title}.`
          : 'This ticket is for a different show.',
        at,
      };
    case 'already_checked_in': {
      const time = clockLabel(result.checked_in_at);
      return {
        tone: 'bad',
        title: time ? `Already checked in at ${time}` : 'Already checked in',
        detail: [who, result.show_title].filter(Boolean).join(' · ') || 'This ticket was used once already.',
        at,
      };
    }
    case 'refunded':
      return {
        tone: 'bad',
        title: 'Refunded',
        detail: [who, result.show_title].filter(Boolean).join(' · ') || 'This ticket was refunded — no entry.',
        at,
      };
    default:
      return {
        tone: 'bad',
        title: 'Not a valid ticket',
        detail: "This code isn't one of ours. Ask to see the ticket in the app.",
        at,
      };
  }
}

export default function ScanScreen() {
  // Optional: /scan?show=<uuid> labels the header AND pins the door: a
  // ticket for any other date is refused as "wrong show". Without it,
  // every upcoming show's tickets scan here.
  const { show: showId } = useLocalSearchParams<{ show?: string }>();
  const router = useRouter();
  const { profile } = useAuth();

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/shows' as never);
  }

  // Profile still on its way (cold start straight into a deep link): hold
  // the frame rather than judging a role we don't know yet.
  if (!profile) {
    return <SafeAreaView style={styles.safe} />;
  }

  // Artist-only surface, same guard as show-new: a fan who deep-links here
  // gets a note and the way back, never a camera.
  if (profile.role !== 'artist') {
    return (
      <ScanNotice
        icon="lock-closed-outline"
        title="ARTIST ONLY"
        sub="The door scanner is for checking fans in on show night. Your own tickets live on the Shows tab."
        cta="BACK TO SHOWS"
        onClose={close}
      />
    );
  }

  const camera = loadCamera();
  if (!camera) {
    return (
      <ScanNotice
        icon="cloud-download-outline"
        title="UPDATE THE APP"
        sub="This version of the app doesn't have the camera scanner yet. Update the app to use the scanner at the door."
        cta="BACK TO SHOWS"
        onClose={close}
      />
    );
  }

  return <Scanner camera={camera} showId={showId} onClose={close} />;
}

type NoticeProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub: string;
  cta: string;
  onClose: () => void;
};

/** The scanner's frame with one solid card in it — for when there's no camera to show. */
function ScanNotice({ icon, title, sub, cta, onClose }: NoticeProps) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressedDim]}>
          <Ionicons name="close" size={22} color="#f4f5f6" />
        </Pressable>
        <View style={styles.headerMiddle}>
          <Text style={styles.headerTitle}>SCAN TICKETS</Text>
        </View>
        <View style={styles.headerSpacer} />
      </View>
      <View style={[styles.permission, styles.noticeCard]}>
        <View style={styles.iconRing}>
          <Ionicons name={icon} size={26} color="#8f99a3" />
        </View>
        <Text style={styles.permissionTitle}>{title}</Text>
        <Text style={styles.permissionSub}>{sub}</Text>
        <ScalePressable
          style={styles.cta}
          onPress={() => {
            tapFeedback();
            onClose();
          }}>
          <Text style={styles.ctaText}>{cta}</Text>
        </ScalePressable>
      </View>
    </SafeAreaView>
  );
}

type ScannerProps = {
  /** The loaded expo-camera module — the screen only gets here once it's known to exist. */
  camera: CameraModule;
  showId?: string;
  onClose: () => void;
};

/** The door itself: camera, result banner, tonight's count. */
function Scanner({ camera, showId, onClose }: ScannerProps) {
  const { CameraView, useCameraPermissions } = camera;
  const [permission, requestPermission] = useCameraPermissions();
  const reduceMotion = useReduceMotion();

  const [showLabel, setShowLabel] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [checkedIn, setCheckedIn] = useState(0);

  const lastSeen = useRef<{ token: string; at: number } | null>(null);
  /** The ticket most recently let through — re-scans of it are ignored while its banner shows. */
  const lastAccepted = useRef<{ token: string; at: number } | null>(null);
  const busy = useRef(false);

  // The counter pops on each accept — the exact house pop from post-card.
  const countScale = useSharedValue(1);
  const countStyle = useAnimatedStyle(() => ({ transform: [{ scale: countScale.value }] }));

  // The frame brightens to white while a check is in flight.
  const checkingSV = useSharedValue(0);
  useEffect(() => {
    checkingSV.value = withTiming(banner?.tone === 'checking' ? 1 : 0, { duration: 120 });
  }, [banner, checkingSV]);
  const frameStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(checkingSV.value, [0, 1], ['#c3cdd6', '#ffffff']),
  }));

  useEffect(() => {
    if (!showId) return;
    let gone = false;
    fetchShow(showId)
      .then((show) => {
        if (gone || !show) return;
        const date = showDateParts(show);
        setShowLabel(`${show.title ?? show.venue} · ${date.weekday} ${date.month} ${date.day}`);
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [showId]);

  // Seed tonight's count from the server so closing and reopening the
  // scanner doesn't zero the number. Math.max is load-bearing: a scan
  // accepted mid-fetch counts in both, and a stale fetch must never lower
  // a number the artist just watched rise.
  useEffect(() => {
    if (!showId) return;
    let gone = false;
    fetchTicketsForShow(showId)
      .then((ts) => {
        if (gone) return;
        const server = ts.filter((t) => t.status === 'checked_in').length;
        setCheckedIn((n) => Math.max(n, server));
      })
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [showId]);

  useEffect(() => {
    // 'checking' is exempt from the auto-clear — a slow RPC must not flip
    // the banner back to READY mid-flight; the verdict or the catch always
    // replaces it, so it can never stick.
    if (!banner || banner.tone === 'checking') return;
    const timer = setTimeout(() => {
      setBanner((current) => (current?.at === banner.at ? null : current));
    }, BANNER_MS);
    return () => clearTimeout(timer);
  }, [banner]);

  async function handleScan({ data }: BarcodeScanningResult) {
    const token = (data ?? '').trim();
    if (!token) return;
    const now = Date.now();
    const accepted = lastAccepted.current;
    if (accepted && accepted.token === token && now - accepted.at < ACCEPTED_WINDOW_MS) return;
    const seen = lastSeen.current;
    if (seen && seen.token === token && now - seen.at < REPEAT_WINDOW_MS) return;
    lastSeen.current = { token, at: now };
    if (busy.current) return;
    busy.current = true;
    // The door hears the catch instantly — never dead air while the server thinks.
    tapFeedback();
    setBanner({ tone: 'checking', title: 'Checking', detail: 'Hold on one second.', at: now });
    try {
      const result = (await checkInTicket(token, showId)) as unknown as ScanOutcome;
      if (result?.ok) {
        // Verdict time, not scan time — and ONE clock for both writes: the
        // accepted-ignore window must cover the green banner's whole life,
        // so a phone left in frame can never flip a fresh "Checked in" red.
        const at = Date.now();
        lastAccepted.current = { token, at };
        successFeedback();
        // Reduce Motion skips the pop — the number still changes.
        if (!reduceMotion) {
          countScale.value = withSequence(
            withTiming(1.28, { duration: 90 }),
            withTiming(1, { duration: 130 })
          );
        }
        setCheckedIn((n) => n + 1);
        setBanner({
          tone: 'ok',
          title: 'Checked in',
          detail:
            [result.buyer_name, result.show_title].filter(Boolean).join(' · ') ||
            'Ticket accepted — let them through.',
          at,
        });
      } else {
        errorFeedback();
        setBanner(refusedBanner(result ?? { ok: false, reason: 'unknown' }, Date.now()));
      }
    } catch (e) {
      errorFeedback();
      setBanner({
        tone: 'bad',
        title: "Couldn't check that ticket",
        detail:
          (e as { message?: string })?.message ?? 'Check your connection and scan it again.',
        at: Date.now(),
      });
    } finally {
      busy.current = false;
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={({ pressed }) => [styles.headerButton, pressed && styles.pressedDim]}>
          <Ionicons name="close" size={22} color="#f4f5f6" />
        </Pressable>
        <View style={styles.headerMiddle}>
          <Text style={styles.headerTitle}>SCAN TICKETS</Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {showLabel ?? 'Any upcoming show'}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            tapFeedback();
            setTorch((on) => !on);
          }}
          hitSlop={12}
          disabled={!permission?.granted}
          style={({ pressed }) => [
            styles.headerButton,
            torch && styles.headerButtonOn,
            pressed && styles.pressedDim,
          ]}>
          <Ionicons
            name={torch ? 'flashlight' : 'flashlight-outline'}
            size={20}
            color={torch ? '#0b0c0e' : '#f4f5f6'}
          />
        </Pressable>
      </View>

      {!permission ? (
        <View style={styles.camera} />
      ) : !permission.granted ? (
        <View style={styles.permission}>
          <View style={styles.iconRing}>
            <Ionicons name="camera-outline" size={26} color="#8f99a3" />
          </View>
          <Text style={styles.permissionTitle}>CAMERA NEEDED</Text>
          <Text style={styles.permissionSub}>
            Point the camera at a fan&apos;s ticket and it checks them in — no typing at the door.
          </Text>
          <ScalePressable
            style={styles.cta}
            onPress={() => {
              tapFeedback();
              if (permission.canAskAgain) requestPermission();
              else Linking.openSettings().catch(() => {});
            }}>
            <Text style={styles.ctaText}>
              {permission.canAskAgain ? 'ALLOW CAMERA' : 'OPEN SETTINGS'}
            </Text>
          </ScalePressable>
          {!permission.canAskAgain ? (
            <Text style={styles.permissionHint}>
              Camera access is off for S333XHUB — switch it on in Settings and come back.
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.camera}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={torch}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleScan}
          />
          <View pointerEvents="none" style={styles.frameWrap}>
            <Animated.View style={[styles.frame, frameStyle]} />
          </View>
        </View>
      )}

      {/* The outer shell holds layout (minHeight 92) while keyed inner views
          crossfade — an exiting snapshot renders out of flow, so the card
          never doubles in height mid-swap. */}
      <View style={styles.banner}>
        {banner ? (
          <Animated.View
            key={String(banner.at)}
            style={[
              styles.bannerInner,
              banner.tone === 'ok' && styles.bannerOk,
              banner.tone === 'bad' && styles.bannerBad,
              banner.tone === 'checking' && styles.bannerChecking,
            ]}
            // Reduce Motion trades the slide for a plain fade (house pattern).
            entering={reduceMotion ? FadeIn.duration(150) : FadeInDown.duration(150)}
            exiting={FadeOut.duration(200)}>
            <Text style={styles.bannerTitle} numberOfLines={2}>
              {banner.title.toUpperCase()}
            </Text>
            <Text style={styles.bannerDetail} numberOfLines={2}>
              {banner.detail}
            </Text>
          </Animated.View>
        ) : (
          <Animated.View
            key="ready"
            style={styles.bannerInner}
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(200)}>
            <Text style={styles.bannerIdleTitle}>READY</Text>
            <Text style={styles.bannerIdle}>
              Line up the QR code on a fan&apos;s ticket — it checks in on its own.
            </Text>
          </Animated.View>
        )}
      </View>

      <View style={styles.counter}>
        <Text style={styles.counterLabel}>
          {showId ? 'CHECKED IN TONIGHT' : 'CHECKED IN THIS SESSION'}
        </Text>
        <Animated.Text style={[styles.counterValue, countStyle]}>{checkedIn}</Animated.Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a1d22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonOn: { backgroundColor: '#fff' },
  /** Keeps the title centred when there's no torch button on the right. */
  headerSpacer: { width: 36 },
  headerMiddle: { flex: 1, alignItems: 'center' },
  headerTitle: {
    color: '#fff',
    fontSize: 17,
    lineHeight: 21,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 2,
  },
  headerSub: { color: '#8f99a3', fontSize: 11.5, marginTop: 2 },
  camera: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  frameWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frame: {
    width: 220,
    height: 220,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: '#c3cdd6',
  },
  permission: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#101216',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  /** The notice stands alone (no banner or counter under it), so it keeps its own bottom margin. */
  noticeCard: { marginBottom: 16 },
  iconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#14171b',
    borderWidth: 1,
    borderColor: '#23262b',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  permissionTitle: {
    color: '#e8e9eb',
    fontSize: 18,
    lineHeight: 22,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  permissionSub: {
    color: '#8f99a3',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 22,
  },
  permissionHint: {
    color: '#55585f',
    fontSize: 11.5,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: 14,
  },
  cta: {
    backgroundColor: '#fff',
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  ctaText: { color: '#0b0c0e', fontWeight: '800', fontSize: 13, letterSpacing: 1 },
  banner: {
    marginHorizontal: 16,
    marginTop: 14,
    borderRadius: 16,
    backgroundColor: '#131519',
    minHeight: 92,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  bannerInner: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    minHeight: 92,
    justifyContent: 'center',
  },
  bannerOk: { backgroundColor: '#15803d' },
  bannerBad: { backgroundColor: '#b91c1c' },
  bannerChecking: { backgroundColor: '#1a1d22' },
  pressedDim: { opacity: 0.6 },
  bannerTitle: { color: '#fff', fontSize: 24, lineHeight: 30, fontFamily: DISPLAY_FONT, letterSpacing: 1 },
  bannerDetail: { color: '#fff', fontSize: 14, lineHeight: 20, marginTop: 4, fontWeight: '600' },
  bannerIdleTitle: { color: '#c3cdd6', fontSize: 10.5, fontWeight: '700', letterSpacing: 1.6 },
  bannerIdle: { color: '#8f99a3', fontSize: 13, lineHeight: 19, marginTop: 4 },
  counter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: '#101216',
  },
  counterLabel: { color: '#6d7076', fontSize: 10.5, fontWeight: '700', letterSpacing: 1.6 },
  counterValue: { color: '#fff', fontSize: 28, lineHeight: 34, fontFamily: DISPLAY_FONT },
});
