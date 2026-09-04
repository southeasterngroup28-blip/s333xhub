import { Link } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { ResendConfirmation } from '@/components/resend-confirmation';
import { supabase } from '@/lib/supabase';
import { DISPLAY_FONT } from '@/constants/type';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Set when sign-in failed because the address isn't confirmed yet. */
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);

  async function handleSignIn() {
    setError(null);
    setUnconfirmedEmail(null);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);
    if (signInError) {
      // Supabase reports an unconfirmed address as a plain sign-in failure.
      if (signInError.message.toLowerCase().includes('email not confirmed')) {
        setError('Confirm your email first — check your inbox.');
        setUnconfirmedEmail(email.trim());
      } else {
        setError(signInError.message);
      }
    }
    // On success the auth provider sees the new session and the app
    // automatically switches to the tabs — no navigation call needed.
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        <BrandMark />
        <Text style={styles.title}>S333XHUB</Text>
        <Text style={styles.subtitle}>Sign in</Text>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#666"
          autoComplete="current-password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {unconfirmedEmail ? <ResendConfirmation email={unconfirmedEmail} /> : null}

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          disabled={submitting || !email.trim() || !password.trim()}
          onPress={handleSignIn}>
          {submitting ? (
            <ActivityIndicator color="#0b0c0e" />
          ) : (
            <Text style={styles.buttonText}>Sign in</Text>
          )}
        </Pressable>

        <View style={styles.footer}>
          <Link href="/(auth)/forgot-password">
            <Text style={styles.footerLink}>Forgot password?</Text>
          </Link>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>New here? </Text>
          <Link href="/(auth)/sign-up">
            <Text style={styles.footerLink}>Create an account</Text>
          </Link>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  title: {
    color: '#f4f5f6',
    fontSize: 36,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 4,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    color: '#9a9ba3',
    fontSize: 12,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 36,
  },
  input: {
    backgroundColor: '#131519',
    color: '#fff',
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
    marginBottom: 12,
  },
  error: { color: '#ff6b6b', marginBottom: 12, textAlign: 'center' },
  button: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#0b0c0e', fontSize: 15, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  footerText: { color: '#888' },
  footerLink: { color: '#c3cdd6', fontWeight: '600' },
});
