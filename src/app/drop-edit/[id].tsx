import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/providers/auth-provider';

import { Chip, ChipRow, Field, FieldLabel, FormNote, PrimaryButton } from '@/components/form';
import { PushedHeader } from '@/components/pushed-header';
import { TopNotice } from '@/components/top-notice';
import { DROP_WHEN_OPTIONS } from '@/constants/drops';
import { fanCopy } from '@/lib/fan-error';
import { fetchDrop, updateDrop } from '@/lib/shop';

/** Editing adds "leave the countdown where it is" ahead of the shared list. */
const WHEN_OPTIONS = [{ label: 'KEEP AS SET', hours: 0 }, ...DROP_WHEN_OPTIONS] as const;

export default function EditDropScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [originalDropsAt, setOriginalDropsAt] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [price, setPrice] = useState('');
  const [runSize, setRunSize] = useState('');
  const [whenHours, setWhenHours] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchDrop(id)
      .then((drop) => {
        if (!drop) {
          setError('This drop is gone.');
          return;
        }
        setTitle(drop.title);
        setPrice(String(drop.price_cents / 100));
        setRunSize(String(drop.run_size));
        setOriginalDropsAt(drop.drops_at);
      })
      .catch((e) => setError(fanCopy(e, 'Could not load the drop.')))
      .finally(() => setLoading(false));
  }, [id]);

  const priceCents = Math.round((parseFloat(price) || 0) * 100);
  const size = parseInt(runSize, 10) || 0;
  const valid = title.trim().length > 0 && priceCents >= 100 && size >= 1 && size <= 1000;

  async function handleSave() {
    if (!valid || saving || !id) return;
    setSaving(true);
    setError(null);
    try {
      await updateDrop(id, {
        title: title.trim(),
        priceCents,
        runSize: size,
        dropsAt:
          whenHours > 0
            ? new Date(Date.now() + whenHours * 3600 * 1000)
            : new Date(originalDropsAt ?? Date.now()),
      });
      router.back();
    } catch (e) {
      setError(fanCopy(e, 'Could not save the draft.'));
      setSaving(false);
    }
  }

  // Artist-only surface; a deep-linked fan sees nothing, not a broken form.
  if (profile?.role !== 'artist') {
    return <SafeAreaView style={styles.safe} />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <PushedHeader
        title="EDIT DRAFT"
        left={
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        }
      />

      {error ? <TopNotice tone="error" text={error} onDismiss={() => setError(null)} /> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <FieldLabel>TITLE</FieldLabel>
          <Field value={title} onChangeText={setTitle} maxLength={60} />

          <View style={styles.pairRow}>
            <View style={styles.pairCell}>
              <FieldLabel>PRICE ($)</FieldLabel>
              <Field keyboardType="decimal-pad" value={price} onChangeText={setPrice} />
            </View>
            <View style={styles.pairCell}>
              <FieldLabel>RUN SIZE</FieldLabel>
              <Field keyboardType="number-pad" value={runSize} onChangeText={setRunSize} />
            </View>
          </View>

          <FieldLabel>COUNTDOWN ENDS</FieldLabel>
          <ChipRow style={styles.whenRow}>
            {WHEN_OPTIONS.map((option) => (
              <Chip
                key={option.hours}
                label={option.label}
                on={whenHours === option.hours}
                onPress={() => setWhenHours(option.hours)}
              />
            ))}
          </ChipRow>

          <PrimaryButton
            label="SAVE CHANGES"
            disabled={!valid}
            busy={saving}
            onPress={handleSave}
          />
          <FormNote center>Only drafts can be edited. Published drops are locked.</FormNote>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cancel: { color: '#8f99a3', fontSize: 15 },
  body: { padding: 16, paddingBottom: 60 },
  pairRow: { flexDirection: 'row', gap: 10 },
  pairCell: { flex: 1 },
  whenRow: { marginBottom: 8 },
});
