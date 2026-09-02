import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DISPLAY_FONT } from '@/constants/type';
import { fetchDrop, updateDrop } from '@/lib/shop';

const WHEN_OPTIONS = [
  { label: 'KEEP AS SET', hours: 0 },
  { label: 'IN 1 HOUR', hours: 1 },
  { label: 'IN 24 HOURS', hours: 24 },
  { label: 'IN 3 DAYS', hours: 72 },
  { label: 'IN 7 DAYS', hours: 168 },
] as const;

export default function EditDropScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

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
          setError('Drop not found.');
          return;
        }
        setTitle(drop.title);
        setPrice(String(drop.price_cents / 100));
        setRunSize(String(drop.run_size));
        setOriginalDropsAt(drop.drops_at);
      })
      .catch((e) => setError((e as { message?: string })?.message ?? 'Could not load.'))
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
      setError((e as { message?: string })?.message ?? 'Could not save.');
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>EDIT DRAFT</Text>
        <View style={{ width: 48 }} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.label}>TITLE</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} maxLength={60} />

          <View style={styles.pairRow}>
            <View style={styles.pairCell}>
              <Text style={styles.label}>PRICE ($)</Text>
              <TextInput
                style={styles.input}
                keyboardType="decimal-pad"
                value={price}
                onChangeText={setPrice}
              />
            </View>
            <View style={styles.pairCell}>
              <Text style={styles.label}>RUN SIZE</Text>
              <TextInput
                style={styles.input}
                keyboardType="number-pad"
                value={runSize}
                onChangeText={setRunSize}
              />
            </View>
          </View>

          <Text style={styles.label}>COUNTDOWN ENDS</Text>
          <View style={styles.whenRow}>
            {WHEN_OPTIONS.map((option) => (
              <Pressable
                key={option.hours}
                style={[styles.whenChip, whenHours === option.hours && styles.whenChipOn]}
                onPress={() => setWhenHours(option.hours)}>
                <Text style={[styles.whenText, whenHours === option.hours && styles.whenTextOn]}>
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>

          <Pressable
            style={[styles.save, (!valid || saving) && styles.saveDisabled]}
            disabled={!valid || saving}
            onPress={handleSave}>
            {saving ? (
              <ActivityIndicator color="#0b0c0e" />
            ) : (
              <Text style={styles.saveText}>SAVE CHANGES</Text>
            )}
          </Pressable>
          <Text style={styles.sub}>Only drafts can be edited — published drops are locked.</Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { color: '#fff', fontSize: 17, fontFamily: DISPLAY_FONT, letterSpacing: 2 },
  cancel: { color: '#8f99a3', fontSize: 15 },
  error: { color: '#f87171', paddingHorizontal: 16, paddingBottom: 6, fontSize: 13 },
  body: { padding: 16, paddingBottom: 60 },
  label: {
    color: '#6d7076',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginBottom: 7,
    marginTop: 6,
  },
  input: {
    backgroundColor: '#131519',
    color: '#fff',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    marginBottom: 12,
  },
  pairRow: { flexDirection: 'row', gap: 10 },
  pairCell: { flex: 1 },
  whenRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 8 },
  whenChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#1a1d22',
  },
  whenChipOn: { backgroundColor: '#c3cdd6' },
  whenText: { color: '#8f99a3', fontWeight: '700', fontSize: 10.5, letterSpacing: 1 },
  whenTextOn: { color: '#0b0c0e' },
  save: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    padding: 15,
    alignItems: 'center',
    marginTop: 18,
  },
  saveDisabled: { opacity: 0.4 },
  saveText: { color: '#0b0c0e', fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },
  sub: { color: '#55585f', fontSize: 11.5, textAlign: 'center', marginTop: 10 },
});
