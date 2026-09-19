import { Link } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { ResendConfirmation } from '@/components/resend-confirmation';
import { authErrorCopy, isEmailNotConfirmed } from '@/lib/auth-errors';
import { errorFeedback, pressFeedback } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { DISPLAY_FONT } from '@/constants/type';

export default function SignInScreen() {
  const reduceMotion = useReduceMotion();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Set when sign-in failed because the address isn't confirmed yet. */
  const [unconfirmedEmail, setUnconfirmedEmail] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);
  /**
   * The layout transition is armed only around the error line's arrival
   * and exit. Left on permanently it would also fire on every keyboard
   * show/hide (KeyboardAvoidingView re-centers the column with its own
   * keyboard-curve LayoutAnimation), and the button and links would glide
   * on a different clock from the inputs.
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

  // The button looks live exactly when a tap would do something.
  const canSubmit = !submitting && email.trim().length > 0 && password.trim().length > 0;

  async function handleSignIn() {
    if (submitting || !canSubmit) return;
    Keyboard.dismiss();
    pressFeedback();
    if (error || unconfirmedEmail) armShift();
    setError(null);
    setUnconfirmedEmail(null);
    setSubmitting(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) {
      // Only a failure hands the button back. On success the spinner holds
      // until the auth provider swaps in the signed-in stack.
      setSubmitting(false);
      armShift();
      setError(authErrorCopy(signInError)); errorFeedback();
      // Supabase reports an unconfirmed address as a plain sign-in failure.
      if (isEmailNotConfirmed(signInError)) setUnconfirmedEmail(email.trim());
    }
  }

  const shift = reduceMotion || !shifting ? undefined : LinearTransition.duration(180);
  const enter = reduceMotion ? undefined : FadeInDown.duration(180);
  const exit = reduceMotion ? undefined : FadeOut.duration(120);

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        {/* The column is centered, so the error line moves what is above it
            too (up by half its height). Same clock as the rows below. */}
        <Animated.View layout={shift}>
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
            textContentType="username"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => passwordRef.current?.focus()}
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            ref={passwordRef}
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#666"
            autoComplete="current-password"
            textContentType="password"
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={handleSignIn}
            value={password}
            onChangeText={setPassword}
          />
        </Animated.View>

        {error ? (
          <Animated.Text style={styles.error} entering={enter} exiting={exit}>
            {error}
          </Animated.Text>
        ) : null}
        {unconfirmedEmail ? (
          <Animated.View entering={enter} exiting={exit} layout={shift}>
            <ResendConfirmation email={unconfirmedEmail} />
          </Animated.View>
        ) : null}

        {/* A plain Pressable inside the layout-animated wrapper: the wrapper
            slides when the error line appears, the Pressable keeps its
            function-style pressed state. */}
        <Animated.View layout={shift}>
          <Pressable
            style={({ pressed }) => [
              styles.button,
              !canSubmit && styles.buttonDisabled,
              pressed && styles.buttonPressed,
            ]}
            disabled={!canSubmit}
            onPress={handleSignIn}>
            {submitting ? (
              <ActivityIndicator color="#0b0c0e" />
            ) : (
              <Text style={styles.buttonText}>Sign in</Text>
            )}
          </Pressable>
        </Animated.View>

        <Animated.View style={styles.footer} layout={shift}>
          <Link href="/(auth)/forgot-password" asChild>
            <Pressable
              hitSlop={8}
              style={({ pressed }) => (pressed ? styles.linkPressed : undefined)}>
              <Text style={styles.footerLink}>Forgot password?</Text>
            </Pressable>
          </Link>
        </Animated.View>

        <Animated.View style={styles.footer} layout={shift}>
          <Text style={styles.footerText}>New here? </Text>
          <Link href="/(auth)/sign-up" asChild>
            <Pressable
              hitSlop={8}
              style={({ pressed }) => (pressed ? styles.linkPressed : undefined)}>
              <Text style={styles.footerLink}>Create an account</Text>
            </Pressable>
          </Link>
        </Animated.View>
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
  buttonPressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  buttonText: { color: '#0b0c0e', fontSize: 15, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  footerText: { color: '#888' },
  footerLink: { color: '#c3cdd6', fontWeight: '600' },
  linkPressed: { opacity: 0.6 },
});
