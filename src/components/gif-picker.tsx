import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
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
import Animated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { tapFeedback } from '@/lib/haptics';
import { searchGifs, trendingGifs, type GifResult } from '@/lib/gifs';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { DISPLAY_FONT } from '@/constants/type';

type Props = {
  visible: boolean;
  onClose: () => void;
  onPick: (gifUrl: string) => void;
};

/** One grid cell. Its own component so the entrance can be gated per cell. */
function GifCell({
  item,
  reduceMotion,
  onPick,
}: {
  item: GifResult;
  reduceMotion: boolean;
  onPick: (gifUrl: string) => void;
}) {
  return (
    <Animated.View style={styles.cell} entering={reduceMotion ? undefined : FadeIn.duration(180)}>
      <Pressable
        style={({ pressed }) => [styles.cellPress, pressed && styles.cellPressed]}
        onPress={() => {
          tapFeedback();
          onPick(item.url);
        }}>
        <Image source={{ uri: item.previewUrl }} style={styles.gif} contentFit="cover" />
      </Pressable>
    </Animated.View>
  );
}

export function GifPicker({ visible, onClose, onPick }: Props) {
  const reduceMotion = useReduceMotion();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchSeq = useRef(0);

  // Trending on open, search 400ms after the user stops typing. Responses
  // arriving out of order are discarded - only the latest search wins.
  // The loading flag flips INSIDE the debounce, so the grid never blanks
  // or dims on every keystroke - only once a request actually goes out.
  useEffect(() => {
    if (!visible) return;
    setError(null);
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      setLoading(true);
      (term.trim() ? searchGifs(term.trim()) : trendingGifs())
        .then((r) => {
          if (seq !== searchSeq.current) return;
          setResults(r);
        })
        .catch((e) => {
          if (seq !== searchSeq.current) return;
          setError((e as { message?: string })?.message ?? 'GIF search failed.');
        })
        .finally(() => {
          if (seq === searchSeq.current) setLoading(false);
        });
    }, term.trim() ? 400 : 0);
    return () => clearTimeout(timer);
  }, [visible, term]);

  // The old results stay on screen (and tappable) at half strength while
  // the next page is on its way - the grid never blanks under the thumb.
  const hasResults = results.length > 0;
  const dim = useSharedValue(1);
  useEffect(() => {
    const target = loading && hasResults ? 0.5 : 1;
    dim.value = reduceMotion ? target : withTiming(target, { duration: 150 });
  }, [loading, hasResults, reduceMotion, dim]);
  const gridStyle = useAnimatedStyle(() => ({ opacity: dim.value }));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>GIF</Text>
          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.close, pressed && styles.closePressed]}>
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
        <View style={styles.body}>
          <Animated.View style={[styles.body, gridStyle]}>
            <FlatList
              data={results}
              keyExtractor={(item) => item.id}
              numColumns={3}
              contentContainerStyle={styles.grid}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              renderItem={({ item }) => (
                <GifCell item={item} reduceMotion={reduceMotion} onPick={onPick} />
              )}
              ListEmptyComponent={
                loading ? null : (
                  <View style={styles.center}>
                    <Text style={styles.empty}>Nothing found.</Text>
                  </View>
                )
              }
            />
          </Animated.View>
          {loading && !hasResults ? (
            <View style={styles.overlay} pointerEvents="none">
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}
        </View>
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
  title: { color: '#fff', fontSize: 17, fontFamily: DISPLAY_FONT, letterSpacing: 2 },
  close: { position: 'absolute', right: 16 },
  closePressed: { opacity: 0.55 },
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
  body: { flex: 1 },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  empty: { color: '#55585f' },
  grid: { paddingHorizontal: 8, paddingBottom: 24, flexGrow: 1 },
  cell: { flex: 1 / 3, aspectRatio: 1, padding: 3 },
  cellPress: { flex: 1 },
  cellPressed: { opacity: 0.7 },
  gif: { flex: 1, borderRadius: 8, backgroundColor: '#131519' },
});
