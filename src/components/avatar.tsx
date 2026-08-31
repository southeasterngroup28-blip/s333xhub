import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';

import { avatarUrl } from '@/lib/avatars';

type Props = {
  /** profiles.avatar_path — falls back to the first letter of the name. */
  path?: string | null;
  name?: string | null;
  size?: number;
};

/** One circular profile photo (or letter placeholder), any size. */
export function Avatar({ path, name, size = 36 }: Props) {
  const url = avatarUrl(path);
  const radius = size / 2;

  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: '#1e2126' }}
        contentFit="cover"
        transition={150}
      />
    );
  }
  return (
    <View
      style={[
        styles.fallback,
        { width: size, height: size, borderRadius: radius },
      ]}>
      <Text style={[styles.letter, { fontSize: Math.max(10, size * 0.4) }]}>
        {(name ?? '?').slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: '#1e2126',
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: { color: '#8f99a3', fontWeight: '700' },
});
