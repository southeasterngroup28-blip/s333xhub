import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBackground } from '@/components/app-background';
import { Avatar } from '@/components/avatar';
import { EdgeGlass, FadeMask } from '@/components/edge-fade';
import { EmptyState } from '@/components/empty-state';
import { useProfileCard } from '@/components/profile-card';
import { CommentSkeleton, Skeleton } from '@/components/skeleton';
import { DISPLAY_FONT } from '@/constants/type';
import { fileReport, REPORT_REASONS } from '@/lib/moderation';
import { fetchPostById, timeAgo, type Post, type Project } from '@/lib/posts';
import { cleanMessage } from '@/lib/profanity';
import {
  addComment,
  deleteComment,
  fetchComments,
  setPinned,
  type Comment,
} from '@/lib/social';
import { useAuth } from '@/providers/auth-provider';

// Project emblems: S333XGOD = blue star, Mazze = green skull.
const EMBLEMS = {
  mazze: require('../../../assets/images/emblem-mazze.png'),
  s333xgod: require('../../../assets/images/emblem-s333xgod.png'),
} as const;

// The artist's comments sit on a "stage" panel tinted with the post's
// project accent — the same green / blue the feed cards wear as borders.
const STAGE_TINT: Record<Project, { fill: string; line: string }> = {
  // Solid fills on purpose: fans set photo backgrounds, and anything translucent
  // turns unreadable over them (same lesson as the chat rows).
  mazze: { fill: '#121a14', line: 'rgba(126, 211, 84, 0.3)' },
  s333xgod: { fill: '#101720', line: 'rgba(88, 178, 235, 0.3)' },
};

const SILVER = '#c3cdd6';
/** The floating header's height below the status bar. */
const HEADER_HEIGHT = 52;

/**
 * The comments thread for one post. The post itself lives in the feed —
 * this screen is the conversation alone: a floating header, the thread,
 * and a pill composer riding over a bottom fade.
 */
export default function CommentsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session, profile } = useAuth();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showProfile } = useProfileCard();
  const isArtist = profile?.role === 'artist';
  const myUserId = session?.user.id;

  // The post is fetched only for its title (header) and project (tint +
  // emblem) — and to notice when it has been deleted out from under us.
  const [post, setPost] = useState<Post | null>(null);
  /** True when the post was deleted (or a bad deep link) — not a fetch error. */
  const [postGone, setPostGone] = useState(false);
  const [postLoading, setPostLoading] = useState(true);

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [actionTarget, setActionTarget] = useState<Comment | null>(null);
  const [reporting, setReporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** The composer hugs the keyboard when it is up, the home indicator when not. */
  const [keyboardUp, setKeyboardUp] = useState(false);

  const loadPost = useCallback(async () => {
    if (!id) return;
    try {
      const fresh = await fetchPostById(id);
      if (!fresh) {
        // Deleted post — nothing to comment on any more.
        setPostGone(true);
        return;
      }
      setPost(fresh);
    } catch (e) {
      // A mangled deep link (non-uuid id) is Postgres 22P02 — treat it like a
      // missing post rather than surfacing the raw database text.
      const err = e as { code?: string; message?: string };
      if (err?.code === '22P02' || /invalid input syntax for type uuid/i.test(err?.message ?? '')) {
        setPostGone(true);
      } else {
        setError('Could not load this post.');
      }
    } finally {
      setPostLoading(false);
    }
  }, [id]);

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
    loadPost();
  }, [loadPost]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, () => setKeyboardUp(true));
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardUp(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    []
  );
  function flash(text: string) {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), 2500);
  }

  function goBack() {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }

  function closeActions() {
    setActionTarget(null);
    setReporting(false);
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
    closeActions();
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
    closeActions();
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
    closeActions();
    try {
      await fileReport('comment', target.id, reason);
      flash('Reported. Reviewed within 24 hours.');
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not report.');
    }
  }

  const project: Project = post?.project ?? 'mazze';
  const tint = STAGE_TINT[project];
  const emblem = EMBLEMS[project];
  const listTop = insets.top + HEADER_HEIGHT + 12;
  const bottomInset = keyboardUp ? 0 : insets.bottom;
  const canSend = !!draft.trim() && !sending;

  /** The small floating toolbar raised over the held comment. */
  function renderToolbar(target: Comment) {
    const canReport = target.user_id !== myUserId;
    return (
      <View style={[styles.toolbar, reporting && styles.toolbarMenu]}>
        {reporting ? (
          REPORT_REASONS.map((reason, index) => (
            <Pressable
              key={reason}
              style={[styles.toolItem, index > 0 && styles.toolItemRuleTop]}
              onPress={() => handleReport(reason)}>
              <Text style={styles.toolText}>{reason}</Text>
            </Pressable>
          ))
        ) : (
          <>
            {isArtist ? (
              <>
                <Pressable style={styles.toolItem} onPress={handlePin}>
                  <Text style={styles.toolText}>{target.pinned ? 'Unpin' : 'Pin'}</Text>
                </Pressable>
                <Pressable style={[styles.toolItem, styles.toolItemRule]} onPress={handleDelete}>
                  <Text style={[styles.toolText, styles.toolDanger]}>Delete</Text>
                </Pressable>
              </>
            ) : null}
            {canReport ? (
              <Pressable
                style={[styles.toolItem, isArtist && styles.toolItemRule]}
                onPress={() => setReporting(true)}>
                <Text style={styles.toolText}>Report</Text>
              </Pressable>
            ) : null}
          </>
        )}
        <View style={styles.toolbarArrow} />
      </View>
    );
  }

  function renderComment({ item }: { item: Comment }) {
    const mine = item.user_id === myUserId;
    const isArtistComment = item.author?.role === 'artist';
    const held = actionTarget?.id === item.id;
    const name = item.author?.display_name ?? 'Deleted user';
    const when = timeAgo(item.created_at);

    return (
      <View style={held ? styles.heldWrap : undefined}>
        {held ? <View style={styles.toolbarStrip}>{renderToolbar(item)}</View> : null}
        <Pressable
          style={held ? (isArtistComment ? styles.heldBandStage : styles.heldBandFan) : undefined}
          onPress={() => {
            if (actionTarget) closeActions();
          }}
          onLongPress={() => {
            if (!mine || isArtist) setActionTarget(item);
          }}
          delayLongPress={300}>
          {isArtistComment ? (
            <View style={[styles.stage, { backgroundColor: tint.fill, borderColor: tint.line }]}>
              <View style={styles.stageTop}>
                <Pressable onPress={() => showProfile(item.user_id)} hitSlop={6}>
                  <Image source={emblem} style={styles.stageEmblem} contentFit="contain" />
                </Pressable>
                <Text style={styles.stageName} numberOfLines={1}>
                  {name}
                </Text>
                {item.pinned ? <Text style={styles.pinned}>PINNED</Text> : null}
                <Text style={styles.stageTime}>{when}</Text>
              </View>
              <Text style={styles.stageBody}>{item.body}</Text>
            </View>
          ) : (
            <View style={styles.fan}>
              <Pressable
                onPress={() => showProfile(item.user_id)}
                hitSlop={6}
                style={styles.fanAvatar}>
                <Avatar
                  path={item.author?.avatar_path}
                  focus={item.author?.avatar_focus}
                  name={item.author?.display_name}
                  size={26}
                />
              </Pressable>
              <View style={styles.fanBody}>
                <View style={styles.fanMeta}>
                  <Text style={styles.fanName} numberOfLines={1}>
                    {name}
                  </Text>
                  {item.pinned ? <Text style={styles.pinned}>PINNED</Text> : null}
                  <Text style={styles.fanTime}>{when}</Text>
                </View>
                <Text style={styles.fanText}>{item.body}</Text>
              </View>
            </View>
          )}
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.safe}>
      <AppBackground />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Absolute children anchor to this view (not the avoiding view's
            padding), so the composer and fades ride up with the keyboard. */}
        <View style={styles.flex}>
          {postLoading || loading ? (
            <View style={[styles.skeletons, { paddingTop: listTop }]}>
              <Skeleton width={96} height={12} radius={4} style={styles.skeletonLabel} />
              {[0, 1, 2, 3].map((n) => (
                <View key={n} style={styles.skeletonRow}>
                  <CommentSkeleton />
                </View>
              ))}
            </View>
          ) : postGone ? (
            <View style={styles.goneWrap}>
              <EmptyState
                icon="eye-off-outline"
                title="This post is gone"
                sub="It may have been taken down. The feed has the latest."
              />
            </View>
          ) : !post ? (
            <View style={styles.goneWrap}>
              <EmptyState
                icon="cloud-offline-outline"
                title="Couldn't load this post"
                sub="Check your connection and try again."
              />
            </View>
          ) : (
            <FadeMask top={insets.top + HEADER_HEIGHT + 8} bottom={bottomInset + 120}>
              <FlatList
                data={comments}
                keyExtractor={(item) => item.id}
                renderItem={renderComment}
                extraData={[actionTarget, reporting, project]}
                contentContainerStyle={[
                  styles.list,
                  { paddingTop: listTop, paddingBottom: bottomInset + 130 },
                ]}
                keyboardShouldPersistTaps="handled"
                onScrollBeginDrag={() => {
                  if (actionTarget) closeActions();
                }}
                ListHeaderComponent={
                  comments.length > 0 ? (
                    <View style={styles.threadLabel}>
                      <Text style={styles.threadLabelText}>COMMENTS</Text>
                      <Text style={styles.threadCount}>{comments.length}</Text>
                    </View>
                  ) : null
                }
                ListEmptyComponent={
                  <View style={styles.empty}>
                    <Image source={emblem} style={styles.emptyEmblem} contentFit="contain" />
                    <View style={styles.emptyText}>
                      <Text style={styles.emptyTitle}>NO COMMENTS YET</Text>
                      <Text style={styles.emptySub}>Be the first to say something.</Text>
                    </View>
                  </View>
                }
              />
            </FadeMask>
          )}

          <EdgeGlass />

          {/* The header floats OVER the thread; comments slide beneath it
              and dissolve in its zone. */}
          <View style={[styles.topBar, { top: insets.top }]} pointerEvents="box-none">
            <Pressable onPress={goBack} hitSlop={12} style={styles.backButton}>
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </Pressable>
            <View style={styles.titleBlock} pointerEvents="none">
              <Text style={styles.title}>COMMENTS</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {postLoading ? '' : (post?.title ?? 'Post')}
              </Text>
            </View>
            <View style={styles.backButton} />
          </View>

          {error || notice ? (
            <Pressable
              style={[styles.flash, { top: insets.top + HEADER_HEIGHT + 6 }]}
              onPress={() => setError(null)}
              disabled={!error}>
              <Text style={[styles.flashText, error ? styles.flashError : styles.flashOk]}>
                {error ?? notice}
              </Text>
            </Pressable>
          ) : null}

          {post && !postGone ? (
            <View style={[styles.composerWrap, { bottom: bottomInset + (keyboardUp ? 10 : 14) }]}>
              <View style={styles.pill}>
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
                  style={[styles.send, !canSend && styles.sendDisabled]}
                  onPress={handleSend}
                  disabled={!canSend}>
                  {sending ? (
                    <ActivityIndicator color="#0b0c0e" size="small" />
                  ) : (
                    <Ionicons name="arrow-up" size={18} color="#0b0c0e" />
                  )}
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  flex: { flex: 1 },

  // ---- floating header ----
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    height: HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  backButton: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  titleBlock: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  title: {
    color: '#fff',
    fontFamily: DISPLAY_FONT,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: 1.5,
  },
  subtitle: {
    color: '#55585f',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    maxWidth: '90%',
  },
  flash: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 21,
    backgroundColor: 'rgba(21, 24, 29, 0.97)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#2a2e34',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
    maxWidth: '86%',
  },
  flashText: { fontSize: 12.5, fontWeight: '600' },
  flashOk: { color: '#4fc07a' },
  flashError: { color: '#f87171' },

  // ---- loading + gone ----
  skeletons: { paddingHorizontal: 14 },
  skeletonLabel: { marginBottom: 14 },
  skeletonRow: { marginBottom: 10 },
  goneWrap: { flex: 1, justifyContent: 'center' },

  // ---- thread ----
  list: { paddingHorizontal: 14, flexGrow: 1 },
  threadLabel: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    paddingHorizontal: 2,
    paddingTop: 2,
    paddingBottom: 10,
  },
  threadLabelText: {
    color: '#fff',
    fontFamily: DISPLAY_FONT,
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 2,
  },
  threadCount: {
    color: '#55585f',
    fontSize: 11.5,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },

  // Artist comments: the stage panel.
  stage: {
    borderRadius: 14,
    borderWidth: 1,
    paddingTop: 11,
    paddingHorizontal: 13,
    paddingBottom: 12,
    marginBottom: 12,
  },
  stageTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  stageEmblem: { width: 22, height: 22 },
  stageName: {
    color: '#fff',
    fontFamily: DISPLAY_FONT,
    fontSize: 15,
    lineHeight: 19,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    flexShrink: 1,
  },
  pinned: {
    color: SILVER,
    fontFamily: DISPLAY_FONT,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 2,
    paddingLeft: 8,
    borderLeftWidth: 1,
    borderLeftColor: 'rgba(195, 205, 214, 0.35)',
  },
  stageTime: {
    marginLeft: 'auto',
    color: SILVER,
    opacity: 0.8,
    fontSize: 11,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  stageBody: { color: '#f0f2ef', fontSize: 14.5, lineHeight: 21 },

  // Fan comments: minimal rows.
  fan: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#131519',
    borderRadius: 14,
    paddingTop: 11,
    paddingHorizontal: 13,
    paddingBottom: 12,
    marginBottom: 12,
  },
  fanAvatar: { marginTop: 1 },
  fanBody: { flex: 1, minWidth: 0 },
  fanMeta: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 2 },
  fanName: { color: '#a9adb4', fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  fanTime: {
    color: '#55585f',
    fontSize: 11,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  fanText: { color: '#cbcdd1', fontSize: 13.5, lineHeight: 19 },

  // Held (long-pressed): a full-bleed tint under the comment, the toolbar
  // raised in a strip above it. The strip is in normal flow so its buttons
  // stay inside the row's bounds (Android drops touches that fall outside).
  heldWrap: { marginHorizontal: -14 },
  toolbarStrip: {
    alignItems: 'flex-end',
    paddingRight: 16,
    paddingTop: 4,
    paddingBottom: 7,
  },
  heldBandFan: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 14,
    paddingTop: 8,
  },
  heldBandStage: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    paddingHorizontal: 14,
    paddingTop: 6,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e2126',
    borderWidth: 1,
    borderColor: '#2a2e34',
    borderRadius: 999,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  // Report reasons are too long for one pill — they stack as a small menu.
  toolbarMenu: {
    flexDirection: 'column',
    alignItems: 'stretch',
    borderRadius: 16,
    paddingHorizontal: 0,
    paddingVertical: 4,
  },
  toolItem: { paddingVertical: 7, paddingHorizontal: 12 },
  toolItemRule: { borderLeftWidth: 1, borderLeftColor: '#2a2e34' },
  toolItemRuleTop: { borderTopWidth: 1, borderTopColor: '#2a2e34' },
  toolText: { color: '#fff', fontSize: 12.5, lineHeight: 16, fontWeight: '600' },
  toolDanger: { color: '#f87171' },
  toolbarArrow: {
    position: 'absolute',
    right: 26,
    bottom: -5,
    width: 9,
    height: 9,
    backgroundColor: '#1e2126',
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#2a2e34',
    transform: [{ rotate: '45deg' }],
  },

  // ---- empty ----
  empty: {
    backgroundColor: '#131519',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  emptyEmblem: { width: 26, height: 26, opacity: 0.45 },
  emptyText: { flex: 1 },
  emptyTitle: {
    color: '#e8e9eb',
    fontFamily: DISPLAY_FONT,
    fontSize: 13,
    lineHeight: 16,
    letterSpacing: 1.6,
  },
  emptySub: { color: '#6d7076', fontSize: 12.5, marginTop: 2 },

  // ---- composer: a pill floating over the bottom fade ----
  composerWrap: { position: 'absolute', left: 16, right: 16, zIndex: 20 },
  pill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    minHeight: 50,
    backgroundColor: 'rgba(21, 24, 29, 0.97)',
    borderWidth: 1,
    borderColor: '#2a2e34',
    borderRadius: 999,
    paddingVertical: 5,
    paddingLeft: 16,
    paddingRight: 5,
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  input: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    lineHeight: 18,
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 0,
    maxHeight: 110,
  },
  send: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.4 },
});
