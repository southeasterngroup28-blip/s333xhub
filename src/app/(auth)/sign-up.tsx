import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ResendConfirmation } from '@/components/resend-confirmation';
import { CONFIRM_EMAIL_URL } from '@/constants/links';
import { authErrorCopy } from '@/lib/auth-errors';
import { errorFeedback, pressFeedback, tapFeedback } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { DISPLAY_FONT } from '@/constants/type';

export default function SignUpScreen() {
  const reduceMotion = useReduceMotion();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [needsEmailConfirm, setNeedsEmailConfirm] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  /**
   * The layout transition is armed only around the error line's arrival
   * and exit (see sign-in): permanently on, it would also fire on every
   * keyboard show/hide and desync the button from the inputs.
   */
  const [shifting, setShifting] = useState(false);
  const shiftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function armShift() {
    if (shiftTimer.current) clearTimeout(shiftTimer.current);
    setShifting(true);
    shiftTimer.current = setTimeout(() => setShifting(false), 260);
  }

  useEffect(
    () => () => {
      if (shiftTimer.current) clearTimeout(shiftTimer.current);
    },
    []
  );

  const canSubmit =
    !submitting && displayName.trim().length >= 2 && email.trim().length > 3 && password.length >= 8 && acceptedTerms;

  async function handleSignUp() {
    if (submitting || !canSubmit) return;
    Keyboard.dismiss();
    pressFeedback();
    if (error) armShift();
    setError(null);
    setSubmitting(true);
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        // Saved onto the auth user; the database trigger copies it into profiles.
        data: { display_name: displayName.trim() },
        emailRedirectTo: CONFIRM_EMAIL_URL,
      },
    });
    if (signUpError) {
      // Only a failure hands the button back; a success holds the spinner
      // until the confirm notice or the signed-in stack takes over.
      setSubmitting(false);
      armShift();
      setError(authErrorCopy(signUpError)); errorFeedback();
      return;
    }
    // If email confirmation is on in Supabase, there's no session yet.
    if (!data.session) {
      setNeedsEmailConfirm(true);
    }
  }

  /** The keyboard's Go key: guarded exactly like the button (terms included). */
  function submitFromKeyboard() {
    if (canSubmit) handleSignUp();
    else Keyboard.dismiss();
  }

  const shift = reduceMotion || !shifting ? undefined : LinearTransition.duration(180);
  const enter = reduceMotion ? undefined : FadeInDown.duration(180);
  const exit = reduceMotion ? undefined : FadeOut.duration(120);

  if (needsEmailConfirm) {
    return (
      <SafeAreaView style={styles.safe}>
        <Animated.View style={styles.container} entering={enter} exiting={exit}>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            We sent a confirmation link to {email.trim()}. Tap it, then come back and sign in.
          </Text>
          <Animated.View entering={enter}>
            <ResendConfirmation email={email.trim()} />
          </Animated.View>
          <Link href="/(auth)/sign-in" asChild>
            <Pressable
              hitSlop={8}
              style={({ pressed }) => (pressed ? styles.linkPressed : undefined)}>
              <Text style={styles.footerLink}>Back to sign in</Text>
            </Pressable>
          </Link>
        </Animated.View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Exits with a fade when the "check your email" notice takes over. */}
      <Animated.View style={styles.flex} exiting={exit}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}>
          <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
            {/* Centered column: the error line moves this block up as well
                as the rows below down. One clock for both. */}
            <Animated.View layout={shift}>
              <Text style={styles.title}>Create account</Text>
              <Text style={styles.subtitle}>Free. No subscription, ever.</Text>

              <TextInput
                style={styles.input}
                placeholder="Display name"
                placeholderTextColor="#666"
                textContentType="name"
                autoComplete="name"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => emailRef.current?.focus()}
                value={displayName}
                onChangeText={setDisplayName}
              />
              <TextInput
                ref={emailRef}
                style={styles.input}
                placeholder="Email"
                placeholderTextColor="#666"
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordRef.current?.focus()}
                value={email}
                onChangeText={setEmail}
              />
              <TextInput
                ref={passwordRef}
                style={styles.input}
                placeholder="Password (8+ characters)"
                placeholderTextColor="#666"
                autoComplete="new-password"
                textContentType="newPassword"
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={submitFromKeyboard}
                value={password}
                onChangeText={setPassword}
              />

              <Pressable
                style={({ pressed }) => [styles.termsRow, pressed && styles.linkPressed]}
                onPress={() => {
                  tapFeedback();
                  setAcceptedTerms(!acceptedTerms);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: acceptedTerms }}>
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
            </Animated.View>

            {error ? (
              <Animated.Text style={styles.error} entering={enter} exiting={exit}>
                {error}
              </Animated.Text>
            ) : null}

            {/* Plain Pressable inside the layout-animated wrapper (see sign-in). */}
            <Animated.View layout={shift}>
              <Pressable
                style={({ pressed }) => [
                  styles.button,
                  !canSubmit && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                disabled={!canSubmit}
                onPress={handleSignUp}>
                {submitting ? (
                  <ActivityIndicator color="#0b0c0e" />
                ) : (
                  <Text style={styles.buttonText}>Create account</Text>
                )}
              </Pressable>
            </Animated.View>

            <Animated.View style={styles.footer} layout={shift}>
              <Text style={styles.footerText}>Already have an account? </Text>
              <Link href="/(auth)/sign-in" asChild>
                <Pressable
                  hitSlop={8}
                  style={({ pressed }) => (pressed ? styles.linkPressed : undefined)}>
                  <Text style={styles.footerLink}>Sign in</Text>
                </Pressable>
              </Link>
            </Animated.View>
          </ScrollView>
        </KeyboardAvoidingView>
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  flex: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  title: {
    color: '#fff',
    fontSize: 30,
    fontFamily: DISPLAY_FONT,
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
  checkboxChecked: { backgroundColor: 'transparent', borderColor: '#c3cdd6' },
  checkmark: { color: '#c3cdd6', fontWeight: '800' },
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
  buttonPressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  buttonText: { color: '#0b0c0e', fontSize: 15, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  footerText: { color: '#888' },
  footerLink: { color: '#c3cdd6', fontWeight: '600' },
  linkPressed: { opacity: 0.6 },
});
