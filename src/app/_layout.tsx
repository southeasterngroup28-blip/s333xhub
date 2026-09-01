import { useFonts } from 'expo-font';
import { Butcherman_400Regular } from '@expo-google-fonts/butcherman';
import { SixCaps_400Regular } from '@expo-google-fonts/six-caps';
import { DarkTheme, DefaultTheme, ThemeProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { ProfileCardProvider } from '@/components/profile-card';
import { AuthProvider, useAuth } from '@/providers/auth-provider';
import { PlayerProvider } from '@/providers/player-provider';

SplashScreen.preventAutoHideAsync();

function RootNavigator() {
  const { session, isLoading } = useAuth();
  const [fontsLoaded] = useFonts({ SixCaps_400Regular, Butcherman_400Regular });

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
      </Stack.Protected>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      {/* Legal pages are readable signed-in or out (the signup checkbox links here). */}
      <Stack.Screen name="legal/terms" />
      <Stack.Screen name="legal/privacy" />
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
