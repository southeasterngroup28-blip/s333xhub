import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

/** The app logo as a circular mark for auth screens. */
export function BrandMark({ size = 84 }: { size?: number }) {
  return (
    <Image
      source={require('../../assets/images/icon.png')}
      style={[styles.mark, { width: size, height: size, borderRadius: size / 2 }]}
      contentFit="cover"
    />
  );
}

const styles = StyleSheet.create({
  mark: {
    alignSelf: 'center',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: '#262a30',
  },
});
