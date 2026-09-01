import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  sub?: string;
};

/** A designed "nothing here yet" moment instead of a bare gray line. */
export function EmptyState({ icon, title, sub }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.iconRing}>
        <Ionicons name={icon} size={26} color="#8f99a3" />
      </View>
      <Text style={styles.title}>{title}</Text>
      {sub ? <Text style={styles.sub}>{sub}</Text> : null}
    </View>
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
    fontSize: 21,
    fontFamily: 'SixCaps_400Regular',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  sub: { color: '#6d7076', fontSize: 13, marginTop: 6, textAlign: 'center', lineHeight: 19 },
});
