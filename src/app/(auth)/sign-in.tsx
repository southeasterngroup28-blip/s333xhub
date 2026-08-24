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

import { supabase } from '@/lib/supabase';

export default function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSignIn() {
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setSubmitting(false);
    if (signInError) {
      setError(signInError.message);
    }
    // On success the auth provider sees the new session and the app
    // automatically switches to the tabs — no navigation call needed.
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
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

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          disabled={submitting || !email || !password}
          onPress={handleSignIn}>
          {submitting ? (
            <ActivityIndicator color="#2fd0e2" />
          ) : (
            <Text style={styles.buttonText}>SIGN IN</Text>
          )}
        </Pressable>

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
  safe: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1, justifyContent: 'center', padding: 24 },
  title: {
    color: '#fff',
    fontSize: 40,
    fontFamily: 'Anton_400Regular',
    letterSpacing: 3,
    textAlign: 'center',
    marginBottom: 4,
    textShadowColor: '#2fd0e2',
    textShadowRadius: 18,
    textShadowOffset: { width: 0, height: 0 },
  },
  titleMark: { color: '#2fd0e2' },
  subtitle: {
    color: '#9a9ba3',
    fontSize: 12,
    letterSpacing: 3,
    textTransform: 'uppercase',
    textAlign: 'center',
    marginBottom: 36,
  },
  input: {
    backgroundColor: '#0d0e11',
    color: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e2026',
    padding: 16,
    fontSize: 16,
    marginBottom: 12,
  },
  error: { color: '#ff6b6b', marginBottom: 12, textAlign: 'center' },
  button: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: '#2fd0e2',
    borderRadius: 10,
    padding: 15,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#2fd0e2',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: {
    color: '#2fd0e2',
    fontSize: 15,
    fontFamily: 'Anton_400Regular',
    letterSpacing: 4,
  },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  footerText: { color: '#888' },
  footerLink: { color: '#2fd0e2', fontWeight: '600' },
});
