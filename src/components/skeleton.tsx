import { useEffect } from 'react';
import { StyleSheet, View, type DimensionValue } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

/** One shimmering placeholder block. Compose these into loading layouts. */
export function Skeleton({
  width,
  height,
  radius = 8,
  style,
}: {
  width?: DimensionValue;
  height: number;
  radius?: number;
  style?: object;
}) {
  const pulse = useSharedValue(0.45);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 750 }), -1, true);
    return () => cancelAnimation(pulse);
  }, [pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <Animated.View
      style={[
        { width: width ?? '100%', height, borderRadius: radius, backgroundColor: '#1b1f24' },
        animated,
        style,
      ]}
    />
  );
}

/** Ghost of a feed post while the real ones load. */
export function PostSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Skeleton width={36} height={36} radius={18} />
        <View style={styles.headerLines}>
          <Skeleton width="45%" height={12} />
          <Skeleton width="25%" height={9} style={styles.gap} />
        </View>
      </View>
      <Skeleton height={13} style={styles.gapBig} />
      <Skeleton width="80%" height={13} style={styles.gap} />
      <Skeleton height={140} radius={12} style={styles.gapBig} />
    </View>
  );
}

/** Ghost of a chat-list row. */
export function ChatRowSkeleton() {
  return (
    <View style={styles.chatRow}>
      <Skeleton width={40} height={40} radius={20} />
      <View style={styles.headerLines}>
        <Skeleton width="40%" height={13} />
        <Skeleton width="60%" height={10} style={styles.gap} />
      </View>
    </View>
  );
}

/** Ghost of a comment row. */
export function CommentSkeleton() {
  return (
    <View style={styles.row}>
      <Skeleton width={30} height={30} radius={15} />
      <View style={styles.headerLines}>
        <Skeleton width="30%" height={11} />
        <Skeleton height={34} radius={10} style={styles.gap} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#101216',
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 14,
    marginBottom: 12,
  },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 4 },
  chatRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    backgroundColor: '#131519',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  headerLines: { flex: 1, paddingTop: 3 },
  gap: { marginTop: 6 },
  gapBig: { marginTop: 12 },
});
