import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { useReduceMotion } from '@/lib/use-reduce-motion';

// Reanimated exports no Animated.Pressable of its own.
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
};

/**
 * A Pressable that acknowledges the finger at touch-down: a quick settle
 * to 0.97 scale, springing back on release. Runs entirely on the UI
 * thread (zero re-renders). With the system Reduce Motion switch on, the
 * scale swaps for a plain opacity dim (house pattern, see voice-note).
 *
 * Press feedback acknowledges the touch only — pass disabled/busy styles
 * through `style` untouched, exactly as with a plain Pressable.
 */
export function ScalePressable({ style, onPressIn, onPressOut, ...rest }: Props) {
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(1);
  const dim = useSharedValue(1);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: dim.value,
  }));

  return (
    <AnimatedPressable
      {...rest}
      style={[style, animated]}
      onPressIn={(e) => {
        if (reduceMotion) dim.set(withTiming(0.7, { duration: 90 }));
        else scale.set(withTiming(0.97, { duration: 90 }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withTiming(1, { duration: 180 }));
        dim.set(withTiming(1, { duration: 180 }));
        onPressOut?.(e);
      }}
    />
  );
}
