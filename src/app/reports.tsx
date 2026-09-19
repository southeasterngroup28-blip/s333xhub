import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut, LinearTransition } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Skeleton } from '@/components/skeleton';
import { fanCopy } from '@/lib/fan-error';
import { errorFeedback, successFeedback } from '@/lib/haptics';
import { displayName } from '@/lib/profiles';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import {
  banUser,
  deleteMessage,
  deletePost,
  fetchBannedAt,
  fetchOpenReports,
  fetchReportTargetPreview,
  resolveReport,
  type Report,
} from '@/lib/moderation';
import { timeAgo } from '@/lib/posts';
import { deleteComment } from '@/lib/social';
import { useAuth } from '@/providers/auth-provider';

type ReportRow = Report & {
  preview: string;
  targetBannedAt: string | null;
  /** False when a reported user has since deleted their account: nothing left to ban. */
  targetExists: boolean;
};

export default function ReportsScreen() {
  const { profile } = useAuth();
  const router = useRouter();
  const reduceMotion = useReduceMotion();
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Report id whose Ban/Unban action is waiting on an inline confirm. */
  const [confirmBanId, setConfirmBanId] = useState<string | null>(null);
  /** The control mid-flight: report id (dismiss), `delete-<id>`, or `ban-<id>`. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const reports = await fetchOpenReports();
      const bannedAt = await fetchBannedAt(
        reports.filter((r) => r.target_type === 'user').map((r) => r.target_id)
      );
      const withPreviews = await Promise.all(
        reports.map(async (r) => ({
          ...r,
          preview: await fetchReportTargetPreview(r),
          targetBannedAt: bannedAt.get(r.target_id) ?? null,
          targetExists: r.target_type !== 'user' || bannedAt.has(r.target_id),
        }))
      );
      setRows(withPreviews);
      setError(null);
    } catch (e) {
      setError(fanCopy(e, 'Could not load reports.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Dismiss is reversible bookkeeping: optimistic, restore on failure.
  async function handleResolve(report: ReportRow) {
    if (busyId) return;
    setBusyId(report.id);
    const before = rows;
    setRows((prev) => prev.filter((r) => r.id !== report.id));
    successFeedback();
    try {
      await resolveReport(report.id);
    } catch (e) {
      setRows(before);
      errorFeedback();
      setError(fanCopy(e, 'Could not dismiss the report.'));
    } finally {
      setBusyId(null);
    }
  }

  // Destructive moderation stays honest-pending: spinner in the tapped
  // chip, nothing disappears until the server has really done it.
  async function handleDeleteContent(report: ReportRow) {
    if (busyId) return;
    setBusyId(`delete-${report.id}`);
    try {
      if (report.target_type === 'post') {
        await deletePost(report.target_id);
      } else if (report.target_type === 'message') {
        await deleteMessage(report.target_id);
      } else if (report.target_type === 'comment') {
        await deleteComment(report.target_id);
      }
      await resolveReport(report.id);
      successFeedback();
      setRows((prev) => prev.filter((r) => r.id !== report.id));
    } catch (e) {
      errorFeedback();
      setError(fanCopy(e, 'Could not delete the content.'));
    } finally {
      setBusyId(null);
    }
  }

  async function handleBan(report: ReportRow) {
    if (busyId) return;
    const banning = !report.targetBannedAt;
    setConfirmBanId(null);
    setBusyId(`ban-${report.id}`);
    try {
      await banUser(report.target_id, banning);
      successFeedback();
      // Patch the affected rows locally; no need to re-run the serial
      // three-phase load() for one flag.
      const targetBannedAt = banning ? new Date().toISOString() : null;
      setRows((prev) =>
        prev.map((r) =>
          r.target_type === 'user' && r.target_id === report.target_id
            ? { ...r, targetBannedAt }
            : r
        )
      );
    } catch {
      errorFeedback();
      setError(
        banning ? 'Could not ban that user. Try again.' : 'Could not unban that user. Try again.'
      );
    } finally {
      setBusyId(null);
    }
  }

  if (!profile || profile.role !== 'artist') {
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
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          hitSlop={12}
          accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Reports</Text>
        <Pressable onPress={load} hitSlop={12} accessibilityLabel="Refresh">
          <Ionicons name="refresh" size={20} color="#888" />
        </Pressable>
      </View>

      <Text style={styles.slaNote}>
        Apple expects reported content to be acted on within 24 hours. Check this screen daily.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <View style={styles.list}>
          <ReportSkeleton />
          <ReportSkeleton />
          <ReportSkeleton />
        </View>
      ) : (
        <Animated.FlatList
          data={rows}
          keyExtractor={(item: ReportRow) => item.id}
          contentContainerStyle={styles.list}
          itemLayoutAnimation={reduceMotion ? undefined : LinearTransition.duration(250)}
          renderItem={({ item }: { item: ReportRow }) => (
            <Animated.View
              style={styles.card}
              exiting={reduceMotion ? undefined : FadeOut.duration(160)}>
              <View style={styles.cardTop}>
                <Text style={styles.type}>{item.target_type.toUpperCase()}</Text>
                <Text style={styles.when}>{timeAgo(item.created_at)}</Text>
              </View>
              <Text style={styles.reason}>
                {`"${item.reason}" reported by ${displayName(item.reporter)}`}
              </Text>
              <Text style={styles.preview} numberOfLines={3}>
                {item.preview}
              </Text>
              {confirmBanId === item.id ? (
                // Inline confirm (RN Alert doesn't work on web): same pattern as chat leave.
                <View style={styles.actions}>
                  <Text style={styles.confirmText}>
                    {item.targetBannedAt ? 'Unban this user?' : 'Ban this user from the app?'}
                  </Text>
                  <Pressable
                    style={styles.chip}
                    disabled={busyId !== null}
                    onPress={() => handleBan(item)}>
                    <Text style={styles.chipDanger}>{item.targetBannedAt ? 'Unban' : 'Ban'}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.chip}
                    disabled={busyId !== null}
                    onPress={() => setConfirmBanId(null)}>
                    <Text style={styles.chipText}>Cancel</Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.actions}>
                  {item.target_type !== 'user' ? (
                    <Pressable
                      style={styles.chip}
                      disabled={busyId !== null}
                      onPress={() => handleDeleteContent(item)}>
                      {busyId === `delete-${item.id}` ? (
                        <ActivityIndicator size="small" color="#8f99a3" />
                      ) : (
                        <Text style={styles.chipDanger}>Delete content</Text>
                      )}
                    </Pressable>
                  ) : item.targetExists ? (
                    <Pressable
                      style={styles.chip}
                      disabled={busyId !== null}
                      onPress={() => setConfirmBanId(item.id)}>
                      {busyId === `ban-${item.id}` ? (
                        <ActivityIndicator size="small" color="#8f99a3" />
                      ) : (
                        <Text style={styles.chipDanger}>
                          {item.targetBannedAt ? 'Unban user' : 'Ban user'}
                        </Text>
                      )}
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={styles.chip}
                    disabled={busyId !== null}
                    onPress={() => handleResolve(item)}>
                    <Text style={styles.chipText}>Dismiss report</Text>
                  </Pressable>
                </View>
              )}
            </Animated.View>
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.muted}>No open reports.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

/** Ghost of a report card while the three-phase load runs. */
function ReportSkeleton() {
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <Skeleton width={64} height={10} />
        <Skeleton width={40} height={10} />
      </View>
      <Skeleton width="85%" height={13} style={styles.skeletonGap} />
      <Skeleton width="70%" height={11} style={styles.skeletonGap} />
      <View style={styles.skeletonChips}>
        <Skeleton width={100} height={28} radius={14} />
        <Skeleton width={112} height={28} radius={14} />
      </View>
    </View>
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
  slaNote: { color: '#666', fontSize: 12, paddingHorizontal: 16, paddingBottom: 10 },
  error: { color: '#f87171', paddingHorizontal: 16, paddingVertical: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 64 },
  muted: { color: '#555' },
  list: { padding: 16, flexGrow: 1 },
  card: { backgroundColor: '#131519', borderRadius: 12, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  type: { color: '#c3cdd6', fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  when: { color: '#555', fontSize: 12 },
  reason: { color: '#ccc', fontSize: 14 },
  preview: { color: '#777', fontSize: 13, marginTop: 6, fontStyle: 'italic' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  confirmText: { color: '#ccc', flex: 1, fontSize: 13 },
  chip: { backgroundColor: '#222226', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  chipDanger: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  skeletonGap: { marginTop: 8 },
  skeletonChips: { flexDirection: 'row', gap: 8, marginTop: 12 },
});
