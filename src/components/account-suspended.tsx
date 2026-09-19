import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { DISPLAY_FONT } from '@/constants/type';
import { errorFeedback, pressFeedback } from '@/lib/haptics';
import { SUPPORT_EMAIL } from '@/lib/legal-content';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { useAuth } from '@/providers/auth-provider';

/** Full-screen lockout shown instead of the app when the account is banned. */
export function AccountSuspended() {
  const { signOut } = useAuth();
  const reduceMotion = useReduceMotion();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    pressFeedback();
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // Offline, signOut can reject. Without this reset the fan trades a
      // dead wait for an endless spinner.
      errorFeedback();
      setSigningOut(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Mounts fresh when the guard flips, so the fade genuinely plays. */}
      <Animated.View
        style={styles.container}
        entering={reduceMotion ? undefined : FadeIn.duration(300)}>
        <BrandMark />
        <Text style={styles.title}>Account suspended</Text>
        <Text style={styles.body}>
          This account was suspended for breaking the rules. If you think that&apos;s a mistake,
          email{' '}
          <Text
            style={styles.link}
            accessibilityRole="link"
            onPress={() => {
              Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {});
            }}>
            {SUPPORT_EMAIL}
          </Text>{' '}
          and we&apos;ll take a look.
        </Text>
        <Pressable
          style={({ pressed }) => [styles.button, (pressed || signingOut) && styles.buttonPressed]}
          onPress={handleSignOut}
          disabled={signingOut}>
          {signingOut ? (
            <ActivityIndicator color="#0b0c0e" />
          ) : (
            <Text style={styles.buttonText}>Sign out</Text>
          )}
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  title: {
    color: '#f4f5f6',
    fontSize: 30,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 12,
  },
  body: { color: '#9a9ba3', fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 28 },
  link: { color: '#c3cdd6', textDecorationLine: 'underline' },
  button: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    padding: 16,
    alignItems: 'center',
  },
  buttonPressed: { opacity: 0.85 },
  buttonText: { color: '#0b0c0e', fontSize: 15, fontWeight: '700' },
});
