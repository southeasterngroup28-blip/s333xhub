import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  deleteMessage,
  deletePost,
  fetchOpenReports,
  fetchReportTargetPreview,
  resolveReport,
  type Report,
} from '@/lib/moderation';
import { timeAgo } from '@/lib/posts';
import { useAuth } from '@/providers/auth-provider';

type ReportRow = Report & { preview: string };

export default function ReportsScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const reports = await fetchOpenReports();
      const withPreviews = await Promise.all(
        reports.map(async (r) => ({ ...r, preview: await fetchReportTargetPreview(r) }))
      );
      setRows(withPreviews);
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not load reports.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleResolve(report: ReportRow) {
    try {
      await resolveReport(report.id);
      setRows((prev) => prev.filter((r) => r.id !== report.id));
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not resolve.');
    }
  }

  async function handleDeleteContent(report: ReportRow) {
    try {
      if (report.target_type === 'post') {
        await deletePost(report.target_id);
      } else if (report.target_type === 'message') {
        await deleteMessage(report.target_id);
      }
      await resolveReport(report.id);
      setRows((prev) => prev.filter((r) => r.id !== report.id));
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not delete the content.');
    }
  }

  if (profile && profile.role !== 'artist') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Text style={styles.muted}>Only the artist can see reports.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Reports</Text>
        <Pressable onPress={load} hitSlop={12}>
          <Ionicons name="refresh" size={20} color="#888" />
        </Pressable>
      </View>

      <Text style={styles.slaNote}>
        Apple expects reported content to be acted on within 24 hours — check this screen daily.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardTop}>
                <Text style={styles.type}>{item.target_type.toUpperCase()}</Text>
                <Text style={styles.when}>{timeAgo(item.created_at)}</Text>
              </View>
              <Text style={styles.reason}>
                “{item.reason}” — reported by {item.reporter?.display_name ?? 'unknown'}
              </Text>
              <Text style={styles.preview} numberOfLines={3}>
                {item.preview}
              </Text>
              <View style={styles.actions}>
                {item.target_type !== 'user' ? (
                  <Pressable style={styles.chip} onPress={() => handleDeleteContent(item)}>
                    <Text style={styles.chipDanger}>Delete content</Text>
                  </Pressable>
                ) : null}
                <Pressable style={styles.chip} onPress={() => handleResolve(item)}>
                  <Text style={styles.chipText}>Dismiss report</Text>
                </Pressable>
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.muted}>No open reports. All clear. ✓</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerTitle: { color: '#fff', fontSize: 17, fontWeight: '700' },
  slaNote: { color: '#666', fontSize: 12, paddingHorizontal: 16, paddingBottom: 10 },
  error: { color: '#f87171', paddingHorizontal: 16, paddingVertical: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  muted: { color: '#555' },
  list: { padding: 16, flexGrow: 1 },
  card: { backgroundColor: '#131315', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  type: { color: '#fbbf24', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  when: { color: '#555', fontSize: 12 },
  reason: { color: '#ccc', fontSize: 14 },
  preview: { color: '#777', fontSize: 13, marginTop: 6, fontStyle: 'italic' },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  chip: { backgroundColor: '#222226', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  chipDanger: { color: '#f87171', fontSize: 13, fontWeight: '600' },
});
