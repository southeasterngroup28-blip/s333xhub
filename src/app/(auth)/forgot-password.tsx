import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
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
} from 'react-native';
import Animated, { FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandMark } from '@/components/brand-mark';
import { RESET_PAGE_URL } from '@/constants/links';
import { authErrorCopy } from '@/lib/auth-errors';
import { errorFeedback, pressFeedback, successFeedback } from '@/lib/haptics';
import { supabase } from '@/lib/supabase';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { DISPLAY_FONT, pillText } from '@/constants/type';

/** Seconds before "Send the email again" is offered again. */
const RESEND_COOLDOWN = 30;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Seconds left before a resend is offered; ticks down once a second. */
  const [cooldown, setCooldown] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * The layout transition is armed only around the error/notice lines and
   * the sent-state swap (see sign-in): permanently on, it would also fire
   * on every keyboard show/hide and desync the rows from the input.
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

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const canSend = !submitting && email.trim().length > 0;

  /** First send and every resend: the same reset email, never the signup one. */
  async function handleSend() {
    if (submitting || !email.trim()) return;
    if (sent && cooldown > 0) return;
    Keyboard.dismiss();
    pressFeedback();
    if (error || notice) armShift();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    const { error: sendError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: RESET_PAGE_URL,
    });
    setSubmitting(false);
    armShift();
    if (sendError) {
      setError(authErrorCopy(sendError)); errorFeedback();
      return;
    }
    if (sent) {
      successFeedback();
      setNotice('Sent again.');
    }
    setCooldown(RESEND_COOLDOWN);
    setSent(true);
  }

  const shift = reduceMotion || !shifting ? undefined : LinearTransition.duration(180);
  const enter = reduceMotion ? undefined : FadeInDown.duration(180);
  const exit = reduceMotion ? undefined : FadeOut.duration(120);
  const resendLocked = submitting || cooldown > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}>
        {/* Centered column: whatever changes height below moves this block
            up too. Same clock as the rows below. */}
        <Animated.View layout={shift}>
          <BrandMark />
          <Text style={styles.title}>S333XHUB</Text>
          <Text style={styles.subtitle}>Reset password</Text>
        </Animated.View>

        {sent ? (
          <Animated.View key="sent" entering={enter} exiting={exit} layout={shift}>
            <Ionicons name="mail-unread-outline" size={40} color="#c3cdd6" style={styles.icon} />
            <Text style={styles.explain}>
              Check {email.trim()} for a reset email and tap the link inside. It opens a page
              where you choose a new password. Then come back here and sign in with it.
            </Text>
            {notice ? (
              <Animated.Text style={styles.notice} entering={enter} exiting={exit}>
                {notice}
              </Animated.Text>
            ) : null}
            {error ? (
              <Animated.Text style={styles.error} entering={enter} exiting={exit}>
                {error}
              </Animated.Text>
            ) : null}
            <Animated.View layout={shift}>
              <Pressable
                onPress={handleSend}
                disabled={resendLocked}
                hitSlop={8}
                style={({ pressed }) => [styles.resend, pressed && styles.linkPressed]}>
                <Text style={[styles.resendText, resendLocked && styles.resendTextDisabled]}>
                  {submitting
                    ? 'Sending…'
                    : cooldown > 0
                      ? `Send the email again (${cooldown}s)`
                      : 'Send the email again'}
                </Text>
              </Pressable>
            </Animated.View>
          </Animated.View>
        ) : (
          <Animated.View key="form" exiting={exit} layout={shift}>
            <Text style={styles.explain}>
              Enter your account email and we&apos;ll send you a link to set a new password.
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor="#666"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              returnKeyType="send"
              onSubmitEditing={handleSend}
              value={email}
              onChangeText={setEmail}
            />
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
                  !canSend && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                disabled={!canSend}
                onPress={handleSend}>
                {submitting ? (
                  <ActivityIndicator color="#0b0c0e" />
                ) : (
                  <Text style={styles.buttonText}>SEND RESET LINK</Text>
                )}
              </Pressable>
            </Animated.View>
          </Animated.View>
        )}

        <Animated.View layout={shift}>
          <Pressable
            onPress={() => (router.canGoBack() ? router.back() : router.replace('/(auth)/sign-in' as never))}
            hitSlop={8}
            style={({ pressed }) => [styles.back, pressed && styles.linkPressed]}>
            <Text style={styles.backText}>Back to sign in</Text>
          </Pressable>
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
  notice: { color: '#4fc07a', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  button: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    padding: 16,
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  buttonText: pillText,
  resend: { alignItems: 'center', marginTop: 18 },
  resendText: { color: '#c3cdd6', fontSize: 13, fontWeight: '600' },
  resendTextDisabled: { color: '#666' },
  back: { alignItems: 'center', marginTop: 26 },
  backText: { color: '#888', fontSize: 13 },
  linkPressed: { opacity: 0.6 },
});
