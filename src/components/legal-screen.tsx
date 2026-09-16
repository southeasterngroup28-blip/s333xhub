import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PushedHeader } from '@/components/pushed-header';
import { EFFECTIVE_DATE, type LegalSection } from '@/lib/legal-content';

type Props = {
  title: string;
  sections: LegalSection[];
};

export function LegalScreen({ title, sections }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <PushedHeader title={title.toUpperCase()} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.effective}>Effective {EFFECTIVE_DATE}</Text>
        {sections.map((section) => (
          <View key={section.heading} style={styles.section}>
            <Text style={styles.heading}>{section.heading}</Text>
            <Text style={styles.body}>{section.body}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  content: { padding: 20, paddingBottom: 64, maxWidth: 700, alignSelf: 'center' },
  effective: { color: '#6d7076', fontSize: 13, marginBottom: 20 },
  section: { marginBottom: 22 },
  heading: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  // The comments thread's body colour, so legal reads like the rest of the app.
  body: { color: '#cbcdd1', fontSize: 14.5, lineHeight: 22 },
});
