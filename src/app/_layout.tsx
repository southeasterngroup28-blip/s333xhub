import { useFonts } from 'expo-font';
import { Anton_400Regular } from '@expo-google-fonts/anton';
import { Butcherman_400Regular } from '@expo-google-fonts/butcherman';
import { SixCaps_400Regular } from '@expo-google-fonts/six-caps';
import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { ProfileCardProvider } from '@/components/profile-card';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { PlayerProvider, usePlayer } from '@/providers/player-provider';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, isLoading } = useAuth();
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

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
        <Stack.Screen name="channel/[id]" />
        <Stack.Screen name="settings" />
        <Stack.Screen name="reports" />
        <Stack.Screen name="post/[id]" />
        <Stack.Screen name="top8" />
        <Stack.Screen name="drop/[id]" />
        <Stack.Screen name="drop-new" options={{ presentation: 'modal' }} />
        <Stack.Screen name="drop-edit/[id]" options={{ presentation: 'modal' }} />
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
    <AuthProvider>
      <PlayerProvider>
        <ProfileCardProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <RootNavigator />
          </ThemeProvider>
        </ProfileCardProvider>
      </PlayerProvider>
    </AuthProvider>
  );
}
