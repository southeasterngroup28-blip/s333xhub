import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { supabase } from '@/lib/supabase';

/** Where the emailed reset link sends people to choose a new password. */
const RESET_PAGE_URL = 'https://southeasterngroup28-blip.github.io/s333xgod/reset-password.html';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSend() {
    setError(null);
    setSubmitting(true);
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: RESET_PAGE_URL,
    });
    setSubmitting(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setSent(true);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        <BrandMark />
        <Text style={styles.title}>S333XHUB</Text>
        <Text style={styles.subtitle}>Reset password</Text>

        {sent ? (
          <>
            <Ionicons name="mail-unread-outline" size={40} color="#c3cdd6" style={styles.icon} />
            <Text style={styles.explain}>
              Check {email.trim()} for a reset email and tap the link inside — it opens a page
              where you choose a new password. Then come back here and sign in with it.
            </Text>
            <Pressable onPress={handleSend} disabled={submitting} style={styles.resend}>
              <Text style={styles.resendText}>
                {submitting ? 'Sending…' : 'Send the email again'}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.explain}>
              Enter your account email and we’ll send you a link to set a new password.
            </Text>
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
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[styles.button, (submitting || !email.trim()) && styles.buttonDisabled]}
              disabled={submitting || !email.trim()}
              onPress={handleSend}>
              {submitting ? (
                <ActivityIndicator color="#0b0c0e" />
              ) : (
                <Text style={styles.buttonText}>Send reset link</Text>
              )}
            </Pressable>
          </>
        )}

        <Pressable onPress={() => router.back()} style={styles.back}>
          <Text style={styles.backText}>Back to sign in</Text>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  title: {
    color: '#f4f5f6',
    fontSize: 38,
    fontFamily: 'SixCaps_400Regular',
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
    marginBottom: 28,
  },
  icon: { alignSelf: 'center', marginBottom: 14 },
  explain: { color: '#9a9ba3', fontSize: 13.5, lineHeight: 20, marginBottom: 16, textAlign: 'center' },
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
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#0b0c0e', fontSize: 15, fontWeight: '700' },
  resend: { alignItems: 'center', marginTop: 18 },
  resendText: { color: '#c3cdd6', fontSize: 13, fontWeight: '600' },
  back: { alignItems: 'center', marginTop: 26 },
  backText: { color: '#888', fontSize: 13 },
});
