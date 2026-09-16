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
import { DISPLAY_FONT, pillText } from '@/constants/type';
import { fanCopy } from '@/lib/fan-error';
import { errorFeedback, pressFeedback, successFeedback } from '@/lib/haptics';
import { isUnnamed } from '@/lib/profiles';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';

// The one screen a fan sees before the tabs when their profile still
// carries the database's placeholder name (an account created outside the
// sign-up screen, or a row that predates the rule). Same 2+ character rule
// as sign-up; the write rides the existing update(display_name) grant.
//
// The placeholder itself is refused here, client-side, with a hint: a name
// the gate would still read as unnamed (isUnnamed) would save, refresh,
// and leave this screen up with a spinner and nothing to say.

export default function NameScreen() {
  const { session, refreshProfile, signOut } = useAuth();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();
  const longEnough = trimmed.length >= 2;
  const placeholder = longEnough && isUnnamed(trimmed);
  const canSave = longEnough && !placeholder && !saving;

  async function handleSave() {
    if (!canSave || !session) return;
    pressFeedback();
    setSaving(true);
    setError(null);
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ display_name: trimmed })
        .eq('id', session.user.id);
      if (updateError) throw updateError;
      await refreshProfile();
      successFeedback();
      // The root layout swaps this screen for the tabs once the profile
      // carries a real name; nothing to navigate here.
    } catch (e) {
      errorFeedback();
      setError(fanCopy(e, 'Could not save your name. Try again.'));
    } finally {
      // Runs after the refresh too: if the profile still reads as unnamed
      // (a trigger rewrote it, say), the button must come back, not spin.
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <BrandMark />
        <Text style={styles.title}>YOUR NAME</Text>
        <Text style={styles.explain}>This is what other fans see next to what you post.</Text>
        <TextInput
          style={styles.input}
          placeholder="Display name"
          placeholderTextColor="#55585f"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          autoCorrect={false}
          maxLength={40}
          returnKeyType="done"
          onSubmitEditing={handleSave}
          autoFocus
        />
        {placeholder ? (
          <Text style={styles.hint}>Pick a different name.</Text>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : null}
        <Pressable
          style={({ pressed }) => [
            styles.button,
            !canSave && styles.buttonDisabled,
            pressed && canSave && styles.buttonPressed,
          ]}
          disabled={!canSave}
          onPress={handleSave}
          accessibilityRole="button">
          {saving ? <ActivityIndicator color="#0b0c0e" /> : <Text style={styles.buttonText}>CONTINUE</Text>}
        </Pressable>
        {/* The one way off a gate that cannot be skipped: the wrong account
            signed in, or a write that keeps failing. */}
        <Pressable onPress={() => signOut()} hitSlop={8} style={styles.signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
        <View style={styles.spacer} />
      </KeyboardAvoidingView>
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
    marginBottom: 10,
  },
  explain: {
    color: '#9a9ba3',
    fontSize: 13.5,
    lineHeight: 20,
    marginBottom: 16,
    textAlign: 'center',
  },
  input: {
    backgroundColor: '#131519',
    color: '#fff',
    borderRadius: 14,
    padding: 16,
    fontSize: 16,
    marginBottom: 12,
  },
  error: { color: '#f87171', marginBottom: 12, textAlign: 'center' },
  hint: { color: '#9a9ba3', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  button: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    padding: 16,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonPressed: { transform: [{ scale: 0.97 }], opacity: 0.9 },
  buttonText: pillText,
  signOut: { alignSelf: 'center', marginTop: 20, padding: 8 },
  signOutText: { color: '#6d7076', fontSize: 14, fontWeight: '600' },
  spacer: { height: 40 },
});
