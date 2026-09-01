import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { searchGifs, trendingGifs, type GifResult } from '@/lib/gifs';

type Props = {
  visible: boolean;
  onClose: () => void;
  onPick: (gifUrl: string) => void;
};

export function GifPicker({ visible, onClose, onPick }: Props) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Trending on open, search 400ms after the user stops typing.
  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      (term.trim() ? searchGifs(term.trim()) : trendingGifs())
        .then(setResults)
        .catch((e) => setError((e as { message?: string })?.message ?? 'GIF search failed.'))
        .finally(() => setLoading(false));
    }, term.trim() ? 400 : 0);
    return () => clearTimeout(timer);
  }, [visible, term]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>GIF</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.close}>
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
        </View>
        <TextInput
          style={styles.search}
          placeholder="Search GIFs…"
          placeholderTextColor="#55585f"
          value={term}
          onChangeText={setTerm}
          autoFocus
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : (
          <FlatList
            data={results}
            keyExtractor={(item) => item.id}
            numColumns={3}
            contentContainerStyle={styles.grid}
            renderItem={({ item }) => (
              <Pressable style={styles.cell} onPress={() => onPick(item.url)}>
                <Image source={{ uri: item.previewUrl }} style={styles.gif} contentFit="cover" />
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.empty}>Nothing found.</Text>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  title: { color: '#fff', fontSize: 24, fontFamily: 'SixCaps_400Regular', letterSpacing: 3 },
  close: { position: 'absolute', right: 16 },
  search: {
    backgroundColor: '#131519',
    color: '#fff',
    borderRadius: 12,
    marginHorizontal: 14,
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  error: { color: '#f87171', paddingHorizontal: 16, paddingBottom: 6, fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  empty: { color: '#55585f' },
  grid: { paddingHorizontal: 8, paddingBottom: 24, flexGrow: 1 },
  cell: { flex: 1 / 3, aspectRatio: 1, padding: 3 },
  gif: { flex: 1, borderRadius: 8, backgroundColor: '#131519' },
});
