import { Link } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { supabase } from '@/lib/supabase';

export default function SignUpScreen() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);

  async function handleSignUp() {
    setError(null);
    setSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // Saved onto the auth user; the database trigger copies it into profiles.
        data: { display_name: displayName.trim() },
      },
    });
    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message);
      return;
    }
    // If email confirmation is on in Supabase, there's no session yet.
    if (!data.session) {
      setNeedsEmailConfirm(true);
    }
  }

  if (needsEmailConfirm) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.container}>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We sent a confirmation link to {email.trim()}. Tap it, then come back and sign in.
          </Text>
          <Link href="/(auth)/sign-in" style={styles.footerLink}>
            Back to sign in
          </Link>
        </View>
      </SafeAreaView>
    );
  }

  const canSubmit =
    !submitting && displayName.trim().length >= 2 && email.trim().length > 3 && password.length >= 8 && acceptedTerms;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Create account</Text>
          <Text style={styles.subtitle}>Free. No subscription, ever.</Text>

          <TextInput
            style={styles.input}
            placeholder="Display name"
            placeholderTextColor="#666"
            value={displayName}
            onChangeText={setDisplayName}
          />
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
            placeholder="Password (8+ characters)"
            placeholderTextColor="#666"
            autoComplete="new-password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
          />

          <Pressable style={styles.termsRow} onPress={() => setAcceptedTerms(!acceptedTerms)}>
            <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
              {acceptedTerms ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.termsText}>
              I agree to the{' '}
              <Link href="/legal/terms">
                <Text style={styles.termsLink}>Terms of Service</Text>
              </Link>{' '}
              and{' '}
              <Link href="/legal/privacy">
                <Text style={styles.termsLink}>Privacy Policy</Text>
              </Link>
            </Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Pressable
            style={[styles.button, !canSubmit && styles.buttonDisabled]}
            disabled={!canSubmit}
            onPress={handleSignUp}>
            {submitting ? (
              <ActivityIndicator color="#0b0c0e" />
            ) : (
              <Text style={styles.buttonText}>Create account</Text>
            )}
          </Pressable>

          <View style={styles.footer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Link href="/(auth)/sign-in">
              <Text style={styles.footerLink}>Sign in</Text>
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: {
    color: '#fff',
    fontSize: 30,
    fontFamily: 'Anton_400Regular',
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    color: '#9a9ba3',
    fontSize: 12,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 32,
  },
  input: {
    backgroundColor: '#131519',
    color: '#fff',
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
    marginBottom: 12,
  },
  termsRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 12 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#444',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: { backgroundColor: 'transparent', borderColor: '#37c8d8' },
  checkmark: { color: '#37c8d8', fontWeight: '800' },
  termsText: { color: '#aaa', flex: 1 },
  termsLink: { color: '#fff', textDecorationLine: 'underline' },
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
  footerLink: { color: '#37c8d8', fontWeight: '600' },
});
