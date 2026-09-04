import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CONFIRM_EMAIL_URL } from '@/constants/links';
import { supabase } from '@/lib/supabase';

/**
 * "Resend email" link for the confirmation email, with a 30s cooldown so
 * people can't hammer Supabase's rate limit. Used on sign-up (the "check
 * your email" notice) and sign-in (when the address isn't confirmed yet).
 */
export function ResendConfirmation({ email }: { email: string }) {
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  // Tick the cooldown down once a second until it hits zero.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleResend() {
    setNotice(null);
    setSendError(null);
    setSending(true);
    // Same landing page as the original sign-up email — never the project default.
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: CONFIRM_EMAIL_URL },
    });
    setSending(false);
    if (error) {
      setSendError('Could not resend the email. Wait a moment and try again.');
      return;
    }
    setNotice('Sent again ✓');
    setCooldown(30);
  }

  return (
    <View style={styles.wrap}>
      <Pressable disabled={sending || cooldown > 0} onPress={handleResend} hitSlop={8}>
        <Text style={[styles.link, (sending || cooldown > 0) && styles.linkDisabled]}>
          {cooldown > 0 ? `Resend email (${cooldown}s)` : 'Resend email'}
        </Text>
      </Pressable>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {sendError ? <Text style={styles.error}>{sendError}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginBottom: 12 },
  link: { color: '#c3cdd6', fontWeight: '600' },
  linkDisabled: { color: '#666' },
  notice: { color: '#4fc07a', marginTop: 8, fontSize: 13 },
  error: { color: '#ff6b6b', marginTop: 8, fontSize: 13, textAlign: 'center' },
});
