import { Pressable, StyleSheet, Text } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { OFFLINE_SUB, RETRY } from '@/constants/copy';
import { sectionHead } from '@/constants/type';
import { useReduceMotion } from '@/lib/use-reduce-motion';

type ErrorCardProps = {
  /** Anton caps: COULDN'T LOAD THE FEED. */
  title: string;
  sub?: string;
  onRetry?: () => void;
};

/**
 * The one load-failure card: a solid charcoal card, the title left-aligned
 * in Anton, one sub line, and the Try again pill. Modelled on the comments
 * thread's failed card, which is the reference. Genuine empties (a fetch
 * that came back with nothing) are built from each screen's own parts and
 * never use this.
 */
export function ErrorCard({ title, sub = OFFLINE_SUB, onRetry }: ErrorCardProps) {
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View
      style={styles.card}
      entering={reduceMotion ? undefined : FadeInDown.duration(220)}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>{sub}</Text>
      {onRetry ? (
        <Pressable
          style={({ pressed }) => [styles.pill, pressed && styles.pillPressed]}
          hitSlop={8}
          onPress={onRetry}
          accessibilityRole="button">
          <Text style={styles.pillText}>{RETRY}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Solid fill on purpose: a read surface over fan photo backgrounds.
  card: {
    backgroundColor: '#131519',
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  title: { ...sectionHead, lineHeight: 19 },
  sub: { color: '#6d7076', fontSize: 12.5, marginTop: 4 },
  pill: {
    alignSelf: 'flex-start',
    marginTop: 12,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2a2e34',
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillPressed: { opacity: 0.7 },
  pillText: { color: '#e8e9eb', fontSize: 13, fontWeight: '600' },
});
