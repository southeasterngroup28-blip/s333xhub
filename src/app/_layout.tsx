import { useFonts } from 'expo-font';
import { Anton_400Regular } from '@expo-google-fonts/anton';
import { Butcherman_400Regular } from '@expo-google-fonts/butcherman';
import { SixCaps_400Regular } from '@expo-google-fonts/six-caps';
import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, type ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';

import { AccountSuspended } from '@/components/account-suspended';
import { ProfileCardProvider } from '@/components/profile-card';
import { installCrashReporting } from '@/lib/crash';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { PlayerProvider, usePlayer } from '@/providers/player-provider';

SplashScreen.preventAutoHideAsync();
installCrashReporting();

// Stripe (show tickets). The SDK looks up its native module the moment
// the package is imported, so a web bundle or a dev client built before
// Stripe was added would throw before the first screen. Load it lazily,
// only when there's a key; with no Stripe the app runs without checkout.
const STRIPE_KEY = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '';

type StripeModule = typeof import('@stripe/stripe-react-native');
let stripeProvider: StripeModule['StripeProvider'] | null | undefined;

function loadStripeProvider(): StripeModule['StripeProvider'] | null {
  if (stripeProvider !== undefined) return stripeProvider;
  if (!STRIPE_KEY || Platform.OS === 'web') {
    stripeProvider = null;
  } else {
    try {
      stripeProvider = (require('@stripe/stripe-react-native') as StripeModule).StripeProvider;
    } catch {
      stripeProvider = null;
    }
  }
  return stripeProvider;
}

// Stripe's provider only accepts element children (ReactElement, not
// ReactNode), so whatever we're handed goes in wrapped in one fragment.
function StripeGate({ children }: { children: ReactNode }) {
  const Provider = loadStripeProvider();
  if (!Provider) return <>{children}</>;
  return (
    <Provider
      publishableKey={STRIPE_KEY}
      merchantIdentifier="merchant.com.s333xhub.app"
      urlScheme="s333xhub">
      <>{children}</>
    </Provider>
  );
}

function RootNavigator() {
  const { session, profile, isLoading } = useAuth();
  const { current: loadedTrack, stop: stopPlayer } = usePlayer();
  const [fontsLoaded] = useFonts({
    Anton_400Regular,
    SixCaps_400Regular,
    Butcherman_400Regular,
  });

  // Signing out silences and unloads whatever was playing — music must
  // never keep playing over the login screen or leak into the next account.
  useEffect(() => {
    if (!session && loadedTrack) stopPlayer();
  }, [session, loadedTrack, stopPlayer]);

  const ready = !isLoading && fontsLoaded;

  useEffect(() => {
    if (ready) {
      SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  // Banned accounts get a dead-end notice instead of the app.
  if (session && profile?.banned_at) {
    return <AccountSuspended />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        {/* Stable identity: deep links (push taps) navigate INTO the mounted
            tab group instead of stacking a second one. */}
        <Stack.Screen name="(tabs)" getId={() => '(tabs)'} />
        <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
        <Stack.Screen name="channel/[id]" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="reports" />
        <Stack.Screen name="post/[id]" />
        <Stack.Screen name="top8" />
        <Stack.Screen name="drop/[id]" />
        <Stack.Screen name="drop-new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="drop-edit/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="show-new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="ticket/[id]" />
        <Stack.Screen name="scan" options={{ presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      {/* Legal pages are readable signed-in or out (the signup checkbox links here). */}
      <Stack.Screen name="legal/terms" />
      <Stack.Screen name="legal/privacy" />
      <Stack.Screen name="legal/shop-terms" />
    </Stack>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <StripeGate>
      <AuthProvider>
        <PlayerProvider>
          <ProfileCardProvider>
            <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
              <RootNavigator />
            </ThemeProvider>
          </ProfileCardProvider>
        </PlayerProvider>
      </AuthProvider>
    </StripeGate>
  );
}
