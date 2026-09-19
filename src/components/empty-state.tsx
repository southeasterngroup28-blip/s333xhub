import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { withSpring, withTiming } from 'react-native-reanimated';

import { DISPLAY_FONT } from '@/constants/type';
import { useReduceMotion } from '@/lib/use-reduce-motion';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub?: string;
  /**
   * An optional way out — a bordered pill under the copy (body font, not
   * Anton). Put the haptic inside onPress at the call site.
   */
  action?: { label: string; onPress: () => void };
};

/** The house pop: fade in over 200ms while settling up from 96%. */
const pop = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.96 }] },
    animations: {
      opacity: withTiming(1, { duration: 200 }),
      transform: [{ scale: withSpring(1, { damping: 18, stiffness: 220 }) }],
    },
  };
};

/** A designed "nothing here yet" moment instead of a bare gray line. */
export function EmptyState({ icon, title, sub, action }: Props) {
  const reduceMotion = useReduceMotion();
  return (
    <Animated.View style={styles.wrap} entering={reduceMotion ? undefined : pop}>
      <View style={styles.iconRing}>
        <Ionicons name={icon} size={26} color="#8f99a3" />
      </View>
      <Text style={styles.title}>{title}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      {action ? (
        <Pressable
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
          hitSlop={8}
          onPress={action.onPress}
          accessibilityRole="button">
          <Text style={styles.actionText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 32 },
  iconRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#14171b',
    borderWidth: 1,
    borderColor: '#23262b',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    color: '#e8e9eb',
    fontSize: 15,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  sub: { color: '#6d7076', fontSize: 13, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  action: {
    marginTop: 16,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#2a2e34',
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionPressed: { opacity: 0.7 },
  actionText: { color: '#e8e9eb', fontSize: 13, fontWeight: '600' },
});
