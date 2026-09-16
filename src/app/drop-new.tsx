import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/providers/auth-provider';

import { Chip, ChipRow, Field, FieldLabel, FormNote, PrimaryButton } from '@/components/form';
import { PickPhotosButton, type PickedImageDraft } from '@/components/media-pickers';
import { ProjectPicker } from '@/components/project-picker';
import { PushedHeader } from '@/components/pushed-header';
import { TopNotice } from '@/components/top-notice';
import { DROP_WHEN_OPTIONS } from '@/constants/drops';
import { clockTime, longDate } from '@/lib/dates';
import { fanCopy } from '@/lib/fan-error';
import type { Project } from '@/lib/posts';
import { createDrop } from '@/lib/shop';

export default function NewDropScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [title, setTitle] = useState('');
  const [project, setProject] = useState<Project>('s333xgod');
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
      setError(fanCopy(e, 'Could not create the drop.'));
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
        title="NEW DROP"
        left={
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        }
      />

      {error ? <TopNotice tone="error" text={error} onDismiss={() => setError(null)} /> : null}

      <ScrollView contentContainerStyle={styles.body}>
        <ProjectPicker value={project} onChange={setProject} />

        <Field
          placeholder="Piece title (e.g. Highs & Lows Figure)"
          value={title}
          onChangeText={setTitle}
          maxLength={60}
        />

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
          {DROP_WHEN_OPTIONS.map((option) => (
            <Chip
              key={option.hours}
              label={option.label}
              on={whenHours === option.hours}
              onPress={() => setWhenHours(option.hours)}
            />
          ))}
        </ChipRow>
        <FormNote>
          {`Opens ${longDate(dropsAt)} at ${clockTime(dropsAt.toISOString())}. Nothing is visible to fans until you hit PUBLISH on the drop page. Publishing sends the push.`}
        </FormNote>

        <FieldLabel>ARTWORK</FieldLabel>
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

        <PrimaryButton
          label="CREATE AS DRAFT"
          disabled={!valid}
          busy={saving}
          onPress={handleCreate}
        />
        <FormNote center>
          Drafts are only visible to you. Fans see it, and get the push, when you publish.
        </FormNote>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  cancel: { color: '#8f99a3', fontSize: 15 },
  body: { padding: 16, paddingBottom: 60 },
  pairRow: { flexDirection: 'row', gap: 10 },
  pairCell: { flex: 1 },
  whenRow: { marginBottom: 8 },
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
});
