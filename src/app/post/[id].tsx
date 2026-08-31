import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/app-background';
import { Avatar } from '@/components/avatar';
import { CommentSkeleton } from '@/components/skeleton';
import { fileReport, REPORT_REASONS } from '@/lib/moderation';
import { timeAgo } from '@/lib/posts';
import { cleanMessage } from '@/lib/profanity';
import {
  addComment,
  deleteComment,
  fetchComments,
  setPinned,
  type Comment,
} from '@/lib/social';
import { useAuth } from '@/providers/auth-provider';

export default function CommentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const router = useRouter();
  const isArtist = profile?.role === 'artist';
  const myUserId = session?.user.id;

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionTarget, setActionTarget] = useState<Comment | null>(null);
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setComments(await fetchComments(id));
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not load comments.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(null), 2500);
  }

  async function handleSend() {
    const body = cleanMessage(draft.trim());
    if (!body || sending || !id) return;
    setSending(true);
    try {
      const comment = await addComment(id, body);
      setComments((prev) => [...prev, comment]);
      setDraft('');
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Comment failed to post.');
    } finally {
      setSending(false);
    }
  }

  async function handlePin() {
    if (!actionTarget) return;
    const target = actionTarget;
    setActionTarget(null);
    try {
      await setPinned(target, !target.pinned);
      await load();
      flash(target.pinned ? 'Unpinned.' : 'Pinned to the top.');
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not pin.');
    }
  }

  async function handleDelete() {
    if (!actionTarget) return;
    const target = actionTarget;
    setActionTarget(null);
    try {
      await deleteComment(target.id);
      setComments((prev) => prev.filter((c) => c.id !== target.id));
      flash('Comment deleted.');
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not delete.');
    }
  }

  async function handleReport(reason: string) {
    if (!actionTarget) return;
    const target = actionTarget;
    setReporting(false);
    setActionTarget(null);
    try {
      await fileReport('comment', target.id, reason);
      flash('Reported. Reviewed within 24 hours.');
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not report.');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <AppBackground />
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Comments</Text>
        <View style={{ width: 24 }} />
      </View>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {loading ? (
          <View style={styles.list}>
            <CommentSkeleton />
            <CommentSkeleton />
            <CommentSkeleton />
          </View>
        ) : (
          <FlatList
            data={comments}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => {
              const mine = item.user_id === myUserId;
              const isArtistComment = item.author?.role === 'artist';
              return (
                <Pressable
                  style={styles.comment}
                  onLongPress={() => {
                    if (!mine || isArtist) setActionTarget(item);
                  }}
                  delayLongPress={300}>
                  <Avatar
                    path={item.author?.avatar_path}
                    name={item.author?.display_name}
                    size={30}
                  />
                  <View style={styles.bubble}>
                    <View style={styles.whoRow}>
                      <Text style={styles.who}>{item.author?.display_name ?? 'Deleted user'}</Text>
                      {isArtistComment ? (
                        <Text style={styles.artistCross}>†</Text>
                      ) : null}
                      {item.pinned ? <Text style={styles.pin}>PINNED</Text> : null}
                    </View>
                    <Text style={styles.body}>{item.body}</Text>
                    <Text style={styles.time}>{timeAgo(item.created_at)}</Text>
                  </View>
                </Pressable>
              );
            }}
            ListEmptyComponent={
              <View style={styles.center}>
                <Text style={styles.empty}>No comments yet. Say something.</Text>
              </View>
            }
          />
        )}

        {actionTarget ? (
          <View style={styles.actionBar}>
            <Text style={styles.actionTitle} numberOfLines={1}>
              {actionTarget.author?.display_name}: “{actionTarget.body}”
            </Text>
            {reporting ? (
              <View style={styles.actionRow}>
                {REPORT_REASONS.map((reason) => (
                  <Pressable key={reason} style={styles.chip} onPress={() => handleReport(reason)}>
                    <Text style={styles.chipText}>{reason}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <View style={styles.actionRow}>
                {actionTarget.user_id !== myUserId ? (
                  <Pressable style={styles.chip} onPress={() => setReporting(true)}>
                    <Text style={styles.chipText}>Report</Text>
                  </Pressable>
                ) : null}
                {isArtist ? (
                  <>
                    <Pressable style={styles.chip} onPress={handlePin}>
                      <Text style={styles.chipText}>{actionTarget.pinned ? 'Unpin' : 'Pin'}</Text>
                    </Pressable>
                    <Pressable style={styles.chip} onPress={handleDelete}>
                      <Text style={styles.chipDanger}>Delete</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            )}
            <Pressable
              onPress={() => {
                setActionTarget(null);
                setReporting(false);
              }}
              hitSlop={8}
              style={styles.actionClose}>
              <Ionicons name="close" size={18} color="#888" />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Add a comment…"
            placeholderTextColor="#55585f"
            value={draft}
            onChangeText={setDraft}
            maxLength={500}
            multiline
          />
          <Pressable
            style={[styles.send, (!draft.trim() || sending) && styles.sendDisabled]}
            onPress={handleSend}
            disabled={!draft.trim() || sending}>
            {sending ? (
              <ActivityIndicator color="#0b0c0e" size="small" />
            ) : (
              <Ionicons name="arrow-up" size={18} color="#0b0c0e" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  headerTitle: { color: '#fff', fontSize: 17, fontFamily: 'Anton_400Regular', letterSpacing: 1.5 },
  notice: { color: '#4fc07a', paddingHorizontal: 16, paddingVertical: 4, fontSize: 13 },
  error: { color: '#f87171', paddingHorizontal: 16, paddingVertical: 4, fontSize: 13 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  empty: { color: '#55585f' },
  list: { padding: 14, flexGrow: 1 },
  comment: { flexDirection: 'row', gap: 9, marginBottom: 12 },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#1e2126',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: { color: '#8f99a3', fontWeight: '700', fontSize: 12 },
  bubble: {
    flex: 1,
    backgroundColor: '#131519',
    borderRadius: 4,
    borderTopRightRadius: 14,
    borderBottomLeftRadius: 14,
    borderBottomRightRadius: 14,
    padding: 11,
  },
  whoRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 3 },
  who: { color: '#fff', fontWeight: '600', fontSize: 12.5 },
  artistCross: { color: '#dce3ea', fontSize: 12, fontWeight: '700' },
  mood: { color: '#8f99a3', fontSize: 11, fontStyle: 'italic', flexShrink: 1 },
  pin: {
    color: '#c3cdd6',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
    backgroundColor: 'rgba(195, 205, 214, 0.1)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginLeft: 'auto',
  },
  body: { color: '#cbcdd1', fontSize: 13.5, lineHeight: 19 },
  time: { color: '#55585f', fontSize: 10.5, marginTop: 4 },
  actionBar: {
    backgroundColor: '#131519',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#23262b',
  },
  actionTitle: { color: '#8f99a3', fontSize: 12, marginBottom: 8, paddingRight: 24 },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { backgroundColor: '#1e2126', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  chipDanger: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  actionClose: { position: 'absolute', top: 10, right: 12 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#23262b',
  },
  input: {
    flex: 1,
    color: '#fff',
    backgroundColor: '#131519',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    fontSize: 14,
    maxHeight: 110,
  },
  send: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
});
