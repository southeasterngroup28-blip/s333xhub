import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
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

import { useAuth } from '@/providers/auth-provider';

import { PickPhotosButton, type PickedImageDraft } from '@/components/media-pickers';
import { DISPLAY_FONT } from '@/constants/type';
import { createDrop } from '@/lib/shop';

const WHEN_OPTIONS = [
  { label: 'IN 1 HOUR', hours: 1 },
  { label: 'TONIGHT +6H', hours: 6 },
  { label: 'IN 24 HOURS', hours: 24 },
  { label: 'IN 3 DAYS', hours: 72 },
  { label: 'IN 7 DAYS', hours: 168 },
] as const;

export default function NewDropScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [title, setTitle] = useState('');
  const [project, setProject] = useState<'mazze' | 's333xgod'>('s333xgod');
  const [price, setPrice] = useState('65');
  const [runSize, setRunSize] = useState('50');
  const [whenHours, setWhenHours] = useState<number>(24);
  const [image, setImage] = useState<PickedImageDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dropsAt = new Date(Date.now() + whenHours * 3600 * 1000);
  const priceCents = Math.round((parseFloat(price) || 0) * 100);
  const size = parseInt(runSize, 10) || 0;
  const valid = title.trim().length > 0 && priceCents >= 100 && size >= 1 && size <= 1000;

  async function handleCreate() {
    if (!valid || saving) return;
    setSaving(true);
    setError(null);
    try {
      const id = await createDrop({
        title: title.trim(),
        project,
        priceCents,
        runSize: size,
        dropsAt,
        image,
      });
      router.replace(`/drop/${id}` as never);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not create the drop.');
      setSaving(false);
    }
  }

  // Artist-only surface; a deep-linked fan sees nothing, not a broken form.
  if (profile?.role !== 'artist') {
    return <SafeAreaView style={styles.safe} />;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.cancel}>Cancel</Text>
        </Pressable>
        <Text style={styles.headerTitle}>NEW DROP</Text>
        <View style={{ width: 48 }} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.projectRow}>
          {(['mazze', 's333xgod'] as const).map((p) => (
            <Pressable
              key={p}
              style={[styles.projectChip, project === p && styles.projectChipOn]}
              onPress={() => setProject(p)}>
              <Text style={[styles.projectText, project === p && styles.projectTextOn]}>
                {p.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        <TextInput
          style={styles.input}
          placeholder="Piece title (e.g. Highs & Lows Figure)"
          placeholderTextColor="#55585f"
          value={title}
          onChangeText={setTitle}
          maxLength={60}
        />

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
              <Text
                style={[styles.whenText, whenHours === option.hours && styles.whenTextOn]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.sub}>
          Opens {dropsAt.toLocaleString()} — but nothing is visible to fans until you hit
          PUBLISH on the drop page. Publishing sends the push.
        </Text>

        <Text style={styles.label}>ARTWORK</Text>
        {image ? (
          <View>
            <Image source={{ uri: image.previewUri }} style={styles.preview} contentFit="cover" />
            <Pressable onPress={() => setImage(null)} style={styles.removeImage} hitSlop={8}>
              <Ionicons name="close" size={16} color="#fff" />
            </Pressable>
          </View>
        ) : (
          <PickPhotosButton
            label="Add product photo"
            maxCount={1}
            disabled={saving}
            onPicked={(picked) => picked[0] && setImage(picked[0])}
            onError={setError}
          />
        )}

        <Pressable
          style={[styles.create, (!valid || saving) && styles.createDisabled]}
          disabled={!valid || saving}
          onPress={handleCreate}>
          {saving ? (
            <ActivityIndicator color="#0b0c0e" />
          ) : (
            <Text style={styles.createText}>CREATE AS DRAFT</Text>
          )}
        </Pressable>
        <Text style={styles.subCenter}>
          Drafts are only visible to you. Fans see it — and get the push — when you publish.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
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
  projectRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  projectChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#1a1d22',
    alignItems: 'center',
  },
  projectChipOn: { backgroundColor: '#ffffff' },
  projectText: { color: '#8f99a3', fontWeight: '800', fontSize: 12, letterSpacing: 1.5 },
  projectTextOn: { color: '#0b0c0e' },
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
  label: {
    color: '#6d7076',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginBottom: 7,
    marginTop: 6,
  },
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
  sub: { color: '#55585f', fontSize: 12, lineHeight: 17, marginBottom: 8 },
  subCenter: { color: '#55585f', fontSize: 11.5, textAlign: 'center', marginTop: 10 },
  preview: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12, backgroundColor: '#14171b' },
  removeImage: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(6,7,9,0.75)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  create: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    padding: 15,
    alignItems: 'center',
    marginTop: 18,
  },
  createDisabled: { opacity: 0.4 },
  createText: { color: '#0b0c0e', fontWeight: '800', fontSize: 14, letterSpacing: 0.5 },
});
