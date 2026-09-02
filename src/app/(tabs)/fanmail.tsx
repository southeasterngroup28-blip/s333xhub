import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';

import { AppBackground } from '@/components/app-background';
import { EdgeGlass, FadeMask } from '@/components/edge-fade';
import {
  PickAudioButton,
  PickPhotosButton,
  PickVideoButton,
} from '@/components/media-pickers';
import {
  fetchMyFanMail,
  submitFanMail,
  type FanMailItem,
  type FanMailKind,
} from '@/lib/fanmail';
import { timeAgo } from '@/lib/posts';
import { useAuth } from '@/providers/auth-provider';
import { DISPLAY_FONT } from '@/constants/type';

type Draft = {
  kind: FanMailKind;
  file?: Blob;
  uri?: string;
  mimeType: string;
  name: string;
};

const KIND_ICON: Record<FanMailKind, keyof typeof Ionicons.glyphMap> = {
  picture: 'image',
  video: 'videocam',
  audio: 'musical-notes',
};

export default function FanMailScreen() {
  const { profile } = useAuth();
  const isArtist = profile?.role === 'artist';
  const insets = useSafeAreaInsets();

  const [items, setItems] = useState<FanMailItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (isArtist) {
      setLoading(false);
      return;
    }
    try {
      setItems(await fetchMyFanMail());
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not load fan mail.');
    } finally {
      setLoading(false);
    }
  }, [isArtist]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleSubmit() {
    if (!draft || sending) return;
    setSending(true);
    setError(null);
    try {
      await submitFanMail(draft.kind, draft, note);
      setDraft(null);
      setNote('');
      setNotice('Sent to the artist. 🖤');
      setTimeout(() => setNotice(null), 3000);
      await load();
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not send that.');
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <AppBackground />

      {isArtist ? (
        <View style={[styles.list, styles.loadingPad]}>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={styles.kindIcon}>
                <Ionicons name="mail" size={17} color="#c3cdd6" />
              </View>
              <View style={styles.meta}>
                <Text style={styles.sender}>Fan mail goes straight to your email</Text>
                <Text style={styles.sub}>
                  Submissions never display in the app — each one lands in your private
                  inbox with the fan's name, their note, and a download link.
                </Text>
              </View>
            </View>
          </View>
        </View>
      ) : (
        <FadeMask>
        <ScrollView contentContainerStyle={[styles.list, styles.loadingPad]}>
          <View style={styles.card}>
            <Text style={styles.pitch}>
              Send the artist your pictures, videos, beats, or music — it goes straight to
              him, privately.
            </Text>
            <Text style={styles.price}>Free · straight to his inbox</Text>

            {draft ? (
              <View style={styles.draftRow}>
                <Ionicons name={KIND_ICON[draft.kind]} size={18} color="#c3cdd6" />
                <Text style={styles.draftName} numberOfLines={1}>
                  {draft.name}
                </Text>
                <Pressable hitSlop={8} onPress={() => setDraft(null)} disabled={sending}>
                  <Ionicons name="close" size={18} color="#8f99a3" />
                </Pressable>
              </View>
            ) : (
              <View style={styles.pickRow}>
                <PickPhotosButton
                  label="Picture"
                  maxCount={1}
                  disabled={sending}
                  onPicked={(images) => {
                    const image = images[0];
                    if (!image) return;
                    setDraft({
                      kind: 'picture',
                      file: image.file,
                      uri: image.previewUri,
                      mimeType: image.mimeType,
                      name: 'picture.jpg',
                    });
                  }}
                  onError={setError}
                />
                <PickVideoButton
                  label="Video"
                  disabled={sending}
                  onPicked={(video) =>
                    setDraft({
                      kind: 'video',
                      file: video.file,
                      uri: video.uri,
                      mimeType: video.mimeType,
                      name: video.name,
                    })
                  }
                  onError={setError}
                />
                <PickAudioButton
                  label="Beat / music"
                  disabled={sending}
                  onPicked={(audio) =>
                    setDraft({
                      kind: 'audio',
                      file: audio.file,
                      uri: audio.uri,
                      mimeType: audio.mimeType,
                      name: audio.name,
                    })
                  }
                  onError={setError}
                />
              </View>
            )}

            <TextInput
              style={styles.noteInput}
              placeholder="Say something about it… (optional)"
              placeholderTextColor="#55585f"
              value={note}
              onChangeText={setNote}
              maxLength={500}
              multiline
            />

            <Pressable
              style={[styles.sendButton, (!draft || sending) && styles.sendDisabled]}
              onPress={handleSubmit}
              disabled={!draft || sending}>
              {sending ? (
                <ActivityIndicator color="#0b0c0e" />
              ) : (
                <Text style={styles.sendText}>Send to the artist</Text>
              )}
            </Pressable>
          </View>

          {items.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>YOUR SUBMISSIONS</Text>
              {items.map((item) => (
                <View key={item.id} style={styles.card}>
                  <View style={styles.row}>
                    <View style={styles.kindIcon}>
                      <Ionicons name={KIND_ICON[item.kind]} size={17} color="#c3cdd6" />
                    </View>
                    <View style={styles.meta}>
                      <Text style={styles.sender}>{item.kind}</Text>
                      <Text style={styles.sub}>{timeAgo(item.created_at)} · sent ✓</Text>
                    </View>
                  </View>
                </View>
              ))}
            </>
          ) : null}
        </ScrollView>
        </FadeMask>
      )}

      <EdgeGlass />
      <View style={[styles.topBar, { top: insets.top }]} pointerEvents="box-none">
        <Text style={styles.title}>FAN MAIL</Text>
      </View>
      {notice ? (
        <Text style={[styles.notice, { top: insets.top + 48 }]}>{notice}</Text>
      ) : null}
      {error ? (
        <Text style={[styles.error, { top: insets.top + 48 }]}>{error}</Text>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    alignItems: 'center',
  },
  title: { color: '#f4f5f6', fontSize: 22, fontFamily: DISPLAY_FONT, letterSpacing: 2 },
  notice: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    textAlign: 'center',
    color: '#4fc07a',
    paddingHorizontal: 16,
    fontSize: 13,
  },
  error: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    textAlign: 'center',
    color: '#f87171',
    paddingHorizontal: 16,
    fontSize: 13,
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  muted: { color: '#55585f' },
  list: { padding: 14, paddingBottom: 150 },
  loadingPad: { paddingTop: 52 },
  card: {
    backgroundColor: '#131519',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  pitch: { color: '#cbcdd1', fontSize: 14, lineHeight: 21 },
  price: { color: '#c3cdd6', fontSize: 12.5, fontWeight: '600', marginTop: 8 },
  pickRow: { flexDirection: 'row', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  draftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0f1114',
    borderRadius: 10,
    padding: 12,
    marginTop: 14,
  },
  draftName: { color: '#fff', fontSize: 13.5, flex: 1 },
  noteInput: {
    backgroundColor: '#0f1114',
    color: '#fff',
    borderRadius: 10,
    padding: 12,
    fontSize: 13.5,
    marginTop: 10,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  sendButton: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#0b0c0e', fontWeight: '700', fontSize: 15 },
  sectionLabel: {
    color: '#6d7076',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 8,
    marginTop: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  kindIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(195, 205, 214, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  meta: { flex: 1 },
  sender: { color: '#fff', fontWeight: '600', fontSize: 14 },
  sub: { color: '#6d7076', fontSize: 12, marginTop: 1 },
  openPill: {
    backgroundColor: '#1e2126',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  openPillText: { color: '#c3cdd6', fontWeight: '700', fontSize: 13 },
  noteText: { color: '#9a9ba3', fontSize: 13, marginTop: 10, fontStyle: 'italic' },
});
