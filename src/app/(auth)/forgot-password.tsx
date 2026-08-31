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

import { supabase } from '@/lib/supabase';

/**
 * In-app password reset: email → 6-digit code from the reset email →
 * new password. Verifying the code signs the user in, so setting the
 * new password immediately after just works — no links, no browser.
 */
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSendCode() {
    setError(null);
    setSubmitting(true);
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(email.trim());
    setSubmitting(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }
    setStep('code');
  }

  async function handleReset() {
    setError(null);
    if (newPassword.length < 8) {
      setError('Password needs at least 8 characters.');
      return;
    }
    setSubmitting(true);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: 'recovery',
    });
    if (verifyError) {
      setSubmitting(false);
      setError(
        verifyError.message.includes('expired') || verifyError.message.includes('invalid')
          ? 'That code is wrong or expired — check the email or request a new one.'
          : verifyError.message
      );
      return;
    }
    // The code signed us in; now store the new password.
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    // Signed in with the new password — the auth provider takes it from here.
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        <Text style={styles.title}>S333XHUB</Text>
        <Text style={styles.subtitle}>Reset password</Text>

        {step === 'email' ? (
          <>
            <Text style={styles.explain}>
              Enter your account email and we’ll send you a 6-digit reset code.
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
              onPress={handleSendCode}>
              {submitting ? (
                <ActivityIndicator color="#0b0c0e" />
              ) : (
                <Text style={styles.buttonText}>Send code</Text>
              )}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.explain}>
              Check {email.trim()} for a 6-digit code, then set your new password.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="6-digit code"
              placeholderTextColor="#666"
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={setCode}
            />
            <TextInput
              style={styles.input}
              placeholder="New password (8+ characters)"
              placeholderTextColor="#666"
              autoComplete="new-password"
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={[
                styles.button,
                (submitting || code.trim().length < 6 || !newPassword) && styles.buttonDisabled,
              ]}
              disabled={submitting || code.trim().length < 6 || !newPassword}
              onPress={handleReset}>
              {submitting ? (
                <ActivityIndicator color="#0b0c0e" />
              ) : (
                <Text style={styles.buttonText}>Set new password</Text>
              )}
            </Pressable>
            <Pressable onPress={handleSendCode} disabled={submitting} style={styles.resend}>
              <Text style={styles.resendText}>Send a new code</Text>
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
    fontFamily: 'Anton_400Regular',
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
