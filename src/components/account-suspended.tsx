import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { DISPLAY_FONT } from '@/constants/type';
import { useAuth } from '@/providers/auth-provider';

/** Full-screen lockout shown instead of the app when the account is banned. */
export function AccountSuspended() {
  const { signOut } = useAuth();
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.container}>
        <BrandMark />
        <Text style={styles.title}>Account suspended</Text>
        <Text style={styles.body}>
          This account was suspended for breaking the rules. If you think that&apos;s a mistake,
          email southeasterngroup28@gmail.com and we&apos;ll take a look.
        </Text>
        <Pressable style={styles.button} onPress={signOut}>
          <Text style={styles.buttonText}>Sign out</Text>
        </Pressable>
      </View>
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
  button: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    padding: 16,
    alignItems: 'center',
  },
  buttonText: { color: '#0b0c0e', fontSize: 15, fontWeight: '700' },
});
