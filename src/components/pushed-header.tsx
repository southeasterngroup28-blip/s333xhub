import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { pushedTitle } from '@/constants/type';

type Props = {
  /** Anton caps: SETTINGS, DROP 001, NEW SHOW. */
  title: string;
  /** A smaller line under the title (the scanner's show label). */
  sub?: string;
  /** Left column. Defaults to the chevron back; pass Cancel or a close X for modals. */
  left?: ReactNode;
  /** Right column: an action, or nothing. */
  right?: ReactNode;
  /** Where the default chevron lands when there is no history (a cold deep link). */
  fallback?: string;
};

/**
 * The one header shape for every non-tab screen: three columns, the
 * title centred between two equal wings so it never drifts when one
 * side is empty. The sub, when there is one, runs the full width under
 * the row rather than sharing the title's half-width column, so a venue
 * and a date fit on one line. Tab roots use RootHeader instead.
 */
export function PushedHeader({ title, sub, left, right, fallback = '/' }: Props) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <View style={styles.row}>
        <View style={styles.wing}>
          {left === undefined ? (
            <Pressable
              onPress={() =>
                router.canGoBack() ? router.back() : router.replace(fallback as never)
              }
              hitSlop={12}
              style={({ pressed }) => [styles.back, pressed && styles.pressed]}
              accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </Pressable>
          ) : (
            left
          )}
        </View>
        <View style={styles.middle}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View style={[styles.wing, styles.wingRight]}>{right ?? null}</View>
      </View>
      {sub ? (
        <Text style={styles.sub} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  wing: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  wingRight: { justifyContent: 'flex-end' },
  middle: { flex: 2, alignItems: 'center' },
  title: { ...pushedTitle, textAlign: 'center' },
  sub: { color: '#8f99a3', fontSize: 11.5, marginTop: 2, textAlign: 'center' },
  back: { alignSelf: 'flex-start' },
  pressed: { opacity: 0.6 },
});
