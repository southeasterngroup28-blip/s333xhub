import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
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

import { PushedHeader } from '@/components/pushed-header';
import { TopNotice } from '@/components/top-notice';
import { fanCopy } from '@/lib/fan-error';
import { errorFeedback, successFeedback } from '@/lib/haptics';
import { displayName } from '@/lib/profiles';
import {
  fetchTopFans,
  removeTopFan,
  searchProfiles,
  setTopFan,
  type TopFan,
} from '@/lib/social';
import { useAuth } from '@/providers/auth-provider';
import { DISPLAY_FONT } from '@/constants/type';

export default function Top3ManagerScreen() {
  const { profile } = useAuth();
  const [fans, setFans] = useState<TopFan[]>([]);
  const [pickingSlot, setPickingSlot] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ id: string; display_name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** The control mid-flight: a fan's id (assign) or `slot-N` (clear). */
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setFans(await fetchTopFans());
    } catch (e) {
      setError(fanCopy(e, 'Could not load the Top 3.'));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (pickingSlot === null) {
      setResults([]);
      return;
    }
    // Show the full fan list immediately; each letter typed narrows it.
    const timer = setTimeout(() => {
      searchProfiles(query)
        .then(setResults)
        .catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [query, pickingSlot]);

  if (!profile || profile.role !== 'artist') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.muted}>Only the artist can pick the Top 3.</Text>
        </View>
      </SafeAreaView>
    );
  }

  async function assign(userId: string) {
    if (pickingSlot === null || busyId) return;
    setBusyId(userId);
    try {
      // Picker stays open with the spinner on the tapped row; it closes only
      // once the server said yes and the slots reloaded.
      await setTopFan(pickingSlot, userId);
      await load();
      successFeedback();
      setPickingSlot(null);
      setQuery('');
    } catch (e) {
      errorFeedback();
      setError(fanCopy(e, 'Could not set that fan.'));
    } finally {
      setBusyId(null);
    }
  }

  async function clear(position: number) {
    if (busyId) return;
    setBusyId(`slot-${position}`);
    try {
      await removeTopFan(position);
      await load();
    } catch (e) {
      errorFeedback();
      setError(fanCopy(e, 'Could not clear that spot.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <PushedHeader title="TOP 3" />

      <Text style={styles.hint}>
        Your three hand-picked fans, shown to everyone at the top of the feed. Change it
        weekly. Three spots keep them fighting for it.
      </Text>

      {error ? <TopNotice tone="error" text={error} onDismiss={() => setError(null)} /> : null}

      <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
        {Array.from({ length: 3 }, (_, i) => i + 1).map((position) => {
          const fan = fans.find((f) => f.position === position);
          return (
            <View key={position} style={styles.slotRow}>
              <Text style={styles.slotNumber}>{position}</Text>
              {fan ? (
                <>
                  <Text style={styles.slotName}>{displayName(fan.profile)}</Text>
                  <Pressable
                    onPress={() => clear(position)}
                    hitSlop={8}
                    disabled={busyId !== null}>
                    {busyId === `slot-${position}` ? (
                      <ActivityIndicator size="small" color="#8f99a3" />
                    ) : (
                      <Ionicons name="close-circle" size={19} color="#6d7076" />
                    )}
                  </Pressable>
                </>
              ) : (
                <Pressable
                  style={styles.assign}
                  onPress={() => {
                    setPickingSlot(position);
                    setQuery('');
                  }}>
                  <Text style={styles.assignText}>
                    {pickingSlot === position ? 'Type a name below…' : '+ Pick a fan'}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}

        {pickingSlot !== null ? (
          <View style={styles.picker}>
            <TextInput
              style={styles.search}
              placeholder={`Search fans for slot ${pickingSlot}…`}
              placeholderTextColor="#55585f"
              value={query}
              onChangeText={setQuery}
              autoFocus
            />
            {results.map((result) => (
              <Pressable
                key={result.id}
                style={({ pressed }) => [styles.result, pressed && !busyId && styles.pressedDim]}
                disabled={busyId !== null}
                onPress={() => assign(result.id)}>
                {busyId === result.id ? (
                  <ActivityIndicator size="small" color="#8f99a3" />
                ) : (
                  <Text style={[styles.resultText, busyId ? styles.resultDim : null]}>
                    {result.display_name}
                  </Text>
                )}
              </Pressable>
            ))}
            <Pressable onPress={() => setPickingSlot(null)} style={styles.cancelPick}>
              <Text style={styles.muted}>Cancel</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  hint: { color: '#6d7076', fontSize: 12.5, paddingHorizontal: 16, paddingBottom: 12, lineHeight: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: '#6d7076' },
  list: { paddingHorizontal: 16, paddingBottom: 48 },
  slotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#131519',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 8,
  },
  slotNumber: { color: '#c3cdd6', fontFamily: DISPLAY_FONT, fontSize: 15, width: 18 },
  slotName: { color: '#fff', fontSize: 14.5, fontWeight: '600', flex: 1 },
  assign: { flex: 1 },
  assignText: { color: '#8f99a3', fontSize: 13.5 },
  picker: { marginTop: 6 },
  search: {
    backgroundColor: '#131519',
    color: '#fff',
    borderRadius: 12,
    padding: 13,
    fontSize: 14,
  },
  result: { paddingVertical: 11, paddingHorizontal: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#23262b' },
  resultText: { color: '#fff', fontSize: 14 },
  resultDim: { opacity: 0.5 },
  pressedDim: { opacity: 0.6 },
  cancelPick: { alignItems: 'center', paddingVertical: 12 },
});
