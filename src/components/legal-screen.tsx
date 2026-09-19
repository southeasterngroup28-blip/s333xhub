import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EFFECTIVE_DATE, type LegalSection } from '@/lib/legal-content';

type Props = {
  title: string;
  sections: LegalSection[];
};

export function LegalScreen({ title, sections }: Props) {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 24 }} />
      </View>

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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  content: { padding: 20, paddingBottom: 64, maxWidth: 700, alignSelf: 'center' },
  effective: { color: '#666', fontSize: 13, marginBottom: 20 },
  section: { marginBottom: 22 },
  heading: { color: '#fff', fontSize: 16, fontWeight: '700', marginBottom: 6 },
  body: { color: '#bbb', fontSize: 14.5, lineHeight: 22 },
});
