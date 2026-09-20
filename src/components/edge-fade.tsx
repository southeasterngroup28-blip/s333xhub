import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PropsWithChildren } from 'react';

// masked-view's web fallback renders ONLY the mask element — wrapping a
// list in it on web would show a black panel instead of the content. On
// web we skip masking entirely and rely on the scrims for the edge look.
const IS_WEB = Platform.OS === 'web';

/**
 * A/B switch for the on-device comparison: `true` keeps the approved look
 * (every list wrapped in a full-screen CALayer mask, which is an offscreen
 * render of the cards, shadows and images on every scroll frame and every
 * in-list animation); `false` drops the mask and leaves the edge look to
 * the scrims alone, which already sit at 0.52-0.92 alpha in the 68/90 pt
 * bands. Flip it, rebuild, compare; nothing else reads it.
 */
const LIST_MASK = true;

// Smoothstep alpha ramp shared by every edge treatment in the app —
// eases in and out so no fade ever shows a visible start or end line.
export const EASED_STOPS = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1] as const;
const EASED_MASK = [
  'rgba(0,0,0,0)',
  'rgba(0,0,0,0.06)',
  'rgba(0,0,0,0.22)',
  'rgba(0,0,0,0.43)',
  'rgba(0,0,0,0.65)',
  'rgba(0,0,0,0.84)',
  'rgba(0,0,0,0.97)',
  'rgba(0,0,0,1)',
] as const;
const EASED_MASK_REVERSED = [...EASED_MASK].reverse() as unknown as typeof EASED_MASK;
const SCRIM = [
  'rgba(5,6,8,0.92)',
  'rgba(5,6,8,0.86)',
  'rgba(5,6,8,0.72)',
  'rgba(5,6,8,0.52)',
  'rgba(5,6,8,0.32)',
  'rgba(5,6,8,0.15)',
  'rgba(5,6,8,0.03)',
  'rgba(5,6,8,0)',
] as const;
const SCRIM_REVERSED = [...SCRIM].reverse() as unknown as typeof SCRIM;

/** Wraps a scrolling list so its content dissolves at the screen edges. */
export function FadeMask({
  children,
  top = 68,
  bottom = 90,
  style,
}: PropsWithChildren<{ top?: number; bottom?: number; style?: ViewStyle }>) {
  if (IS_WEB || !LIST_MASK) {
    return <View style={[styles.flex, style]}>{children}</View>;
  }
  return (
    <MaskedView
      style={[styles.flex, style]}
      maskElement={
        <View style={styles.flex}>
          <LinearGradient colors={EASED_MASK} locations={EASED_STOPS} style={{ height: top }} />
          <View style={styles.solid} />
          <LinearGradient
            colors={EASED_MASK_REVERSED}
            locations={EASED_STOPS}
            style={{ height: bottom }}
          />
        </View>
      }>
      {children}
    </MaskedView>
  );
}

/**
 * The frosted-glass + darkness layers for the screen edges. Render AFTER
 * the masked list (so it sits above it) and BEFORE the floating header.
 * A screen with a fixed bar at the bottom (the chat composer) passes
 * `bottom={false}` so the glass only sits under its floating header.
 */
export function EdgeGlass({ top = true, bottom = true }: { top?: boolean; bottom?: boolean } = {}) {
  const insets = useSafeAreaInsets();
  if (IS_WEB) {
    // Scrims only — the masked blur layers would render as black bands.
    return (
      <>
        {top ? (
          <LinearGradient
            pointerEvents="none"
            colors={SCRIM}
            locations={EASED_STOPS}
            style={[styles.top, { height: insets.top + 118, zIndex: 10 }]}
          />
        ) : null}
        {bottom ? (
          <LinearGradient
            pointerEvents="none"
            colors={SCRIM_REVERSED}
            locations={EASED_STOPS}
            style={[styles.bottom, { height: insets.bottom + 128, zIndex: 10 }]}
          />
        ) : null}
      </>
    );
  }
  return (
    <>
      {/* No blur under the top bar: a blur smears any bright highlight in
          the photo into a soft streak that then sits still while the list
          scrolls under it. The scrim below does the work on its own. */}
      {bottom ? (
        <MaskedView
          pointerEvents="none"
          style={[styles.bottom, { height: insets.bottom + 112 }]}
          maskElement={
            <LinearGradient colors={EASED_MASK} locations={EASED_STOPS} style={styles.flex} />
          }>
          <BlurView intensity={30} tint="dark" style={styles.flex} />
        </MaskedView>
      ) : null}
      {top ? (
        <LinearGradient
          pointerEvents="none"
          colors={SCRIM}
          locations={EASED_STOPS}
          style={[styles.top, { height: insets.top + 118, zIndex: 10 }]}
        />
      ) : null}
      {bottom ? (
        <LinearGradient
          pointerEvents="none"
          colors={SCRIM_REVERSED}
          locations={EASED_STOPS}
          style={[styles.bottom, { height: insets.bottom + 128, zIndex: 10 }]}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  solid: { flex: 1, backgroundColor: 'black' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 9 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 9 },
});
