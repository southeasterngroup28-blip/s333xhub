import { StyleSheet, Text, View } from 'react-native';

// This screen is never reachable — the tab blocks navigation — but the
// tab system requires a screen file to exist for the tab to render.
export default function ShopScreen() {
  return (
    <View style={styles.center}>
      <Text style={styles.text}>S333XSHOP — coming soon</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0c0e' },
  text: { color: '#6d7076' },
});
