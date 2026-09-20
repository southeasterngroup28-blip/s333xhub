import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { memo, useEffect, useEffectEvent, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  cancelAnimation,
  FadeIn,
  FadeInDown,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { AudioCover, AudioPlayerCard, projectLabel } from '@/components/audio-player-card';
import { Avatar } from '@/components/avatar';
import { Skeleton } from '@/components/skeleton';
import { REPORT_FAILED, REPORT_SENT } from '@/constants/copy';
import { fanCopy } from '@/lib/fan-error';
import { errorFeedback, pressFeedback, successFeedback, tapFeedback } from '@/lib/haptics';
import { PurchaseCancelledError, UnlockPendingError, purchasePost } from '@/lib/payments';
import { displayName } from '@/lib/profiles';
import { fetchMyPurchasedPostIds } from '@/lib/purchases';
import { useProfileCard } from '@/components/profile-card';
import { priceLabel } from '@/lib/shop';
import { useReduceMotion } from '@/lib/use-reduce-motion';
import { VideoPlayerCard } from '@/components/video-player-card';
import {
  countPostBuyers,
  deletePost,
  fileReport,
  paidPostBlockedMessage,
  REPORT_REASONS,
} from '@/lib/moderation';
import { timeAgo, type Post } from '@/lib/posts';
import {
  REACTION_EMOJIS,
  toggleReaction,
  votePoll,
  type PollState,
  type ReactionSummary,
} from '@/lib/social';

type Props = {
  post: Post;
  /** storage_path → signed URL, resolved by the feed */
  mediaUrls: Record<string, string>;
  /** The artist always sees their own locked content. */
  viewerIsArtist: boolean;
  /** True when this viewer has purchased this post. */
  unlocked?: boolean;
  /** Reaction counts + my reactions, resolved by the feed. */
  reactions?: ReactionSummary;
  /** How many comments this post has. */
  commentCount?: number;
  /** Poll options + votes when this is a poll post. */
  poll?: PollState;
  /** When the feed last loaded; the "3m ago" label recomputes against it. */
  loadedAt?: number;
  /** Called after the artist deletes this post, so the feed can drop the row. */
  onDeleted?: (postId: string) => void;
  /**
   * Called the moment this viewer's purchase of this post is recorded.
   * The card awaits it before celebrating, so the reveal lands with the
   * media link already resolved.
   */
  onUnlocked?: (post: Post) => void | Promise<void>;
  /** Entrance animations run only on genuine arrivals, never on remounts. */
  animateIn?: boolean;
  /** Row index, for the capped entrance stagger. */
  index?: number;
};

/** One reaction chip that pops when tapped. */
function ReactionChip({
  emoji,
  count,
  mine,
  onPress,
}: {
  emoji: string;
  count: number;
  mine: boolean;
  onPress: () => void;
}) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={animated}>
      <Pressable
        style={[styles.react, mine && styles.reactOn]}
        onPress={() => {
          // Quick snap — springs settle too lazily for a tap this small.
          scale.set(
            withSequence(withTiming(1.28, { duration: 90 }), withTiming(1, { duration: 130 }))
          );
          tapFeedback();
          onPress();
        }}
        hitSlop={4}>
        <Text style={styles.reactEmoji}>{emoji}</Text>
        {count > 0 ? <Text style={styles.reactCount}>{count}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

type UnlockPhase = 'idle' | 'buying' | 'recording' | 'pending';

/**
 * Post ids Apple has charged this session whose webhook row has not landed
 * yet. Module scope on purpose: FlatList virtualization unmounts far-away
 * rows, and a card remounting mid-pending must resume its honest "unlock
 * on the way" state — never offer a second buy of an already-paid post.
 */
const pendingUnlockIds = new Set<string>();
const PENDING_NOTICE = new UnlockPendingError().message;

/**
 * The unlock pill: pressed scale at finger-down, a real 44pt+ target, and
 * honest staged copy while the purchase machine runs. Recording/pending
 * breathe (0.55 → 1) instead of sitting at a static dim — the wait is alive.
 */
function UnlockPill({
  phase,
  priceCents,
  onPress,
}: {
  phase: UnlockPhase;
  priceCents: number;
  onPress: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(1);
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (phase === 'recording' || phase === 'pending') {
      if (reduceMotion) {
        pulse.set(0.7);
        return () => {
          pulse.set(1);
        };
      }
      pulse.set(0.55);
      pulse.set(withRepeat(withTiming(1, { duration: 700 }), -1, true));
      return () => {
        cancelAnimation(pulse);
        pulse.set(1);
      };
    }
    cancelAnimation(pulse);
    pulse.set(1);
  }, [phase, reduceMotion, pulse]);

  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: pulse.value,
  }));

  const busy = phase !== 'idle';
  const label =
    phase === 'buying'
      ? 'Waiting for Apple…'
      : phase === 'recording'
        ? 'Payment received. Unlocking now.'
        : phase === 'pending'
          ? 'Unlock on the way'
          : `Unlock · ${priceLabel(priceCents)}`;

  return (
    <Animated.View style={animated}>
      <Pressable
        style={({ pressed }) => [
          styles.unlockPill,
          phase === 'buying' && styles.unlockPillBusy,
          // Reduce Motion swaps the press scale for a plain opacity dim
          // (house pattern) — the touch still gets acknowledged.
          reduceMotion && pressed && !busy && styles.unlockPillDim,
        ]}
        disabled={busy}
        hitSlop={8}
        onPressIn={() => {
          if (!reduceMotion) scale.set(withTiming(0.96, { duration: 80 }));
        }}
        onPressOut={() => {
          scale.set(withTiming(1, { duration: 140 }));
        }}
        onPress={onPress}>
        {phase === 'buying' || phase === 'recording' ? (
          <View style={styles.unlockPillRow}>
            <ActivityIndicator size="small" color="#14161a" />
            <Text style={styles.unlockPillText}>{label}</Text>
          </View>
        ) : (
          <Text style={styles.unlockPillText}>{label}</Text>
        )}
      </Pressable>
    </Animated.View>
  );
}

/** One poll option whose fill glides to its share instead of snapping. */
function PollBar({
  pct,
  label,
  mine,
  onPress,
}: {
  pct: number;
  label: string;
  mine: boolean;
  onPress: () => void;
}) {
  const reduceMotion = useReduceMotion();
  const w = useSharedValue(pct);
  useEffect(() => {
    // Reduce Motion snaps the fill to its share instead of gliding.
    w.set(reduceMotion ? pct : withTiming(pct, { duration: 350 }));
  }, [pct, w, reduceMotion]);
  const fill = useAnimatedStyle(() => ({ width: `${w.value}%` as `${number}%` }));

  return (
    <Pressable style={styles.pollBar} onPress={onPress}>
      <Animated.View style={[styles.pollFill, fill]} />
      <View style={styles.pollRow}>
        <Text style={[styles.pollLabel, mine && styles.pollLabelMine]}>
          {mine ? '● ' : ''}
          {label}
        </Text>
        <Text style={styles.pollPct}>{pct}%</Text>
      </View>
    </Pressable>
  );
}

/**
 * The blur that covered the tease, held over the just-revealed media for a
 * beat and dissolved — the paywall melts instead of blinking away.
 */
function RevealOverlay({
  coverUrl,
  project,
  bleed,
}: {
  coverUrl?: string;
  project: Post['project'];
  bleed: boolean;
}) {
  const reduceMotion = useReduceMotion();
  const fade = useSharedValue(1);

  useEffect(() => {
    fade.set(reduceMotion ? 0 : withTiming(0, { duration: 480 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animated = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.revealOverlay, bleed && styles.revealBleed, animated]}>
      {coverUrl ? (
        <Image
          source={{ uri: coverUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          blurRadius={22}
        />
      ) : (
        <Image
          source={
            project === 's333xgod'
              ? require('../../assets/images/emblem-s333xgod.png')
              : require('../../assets/images/emblem-mazze.png')
          }
          style={styles.teaseEmblem}
          contentFit="contain"
          blurRadius={3}
        />
      )}
      <View style={styles.teaseScrim} />
    </Animated.View>
  );
}

function formatEndsIn(endsAt: string | null): string {
  if (!endsAt) return '';
  const ms = new Date(endsAt).getTime() - Date.now();
  if (ms <= 0) return 'ended';
  const hours = Math.round(ms / 3600000);
  if (hours < 1) return 'ends soon';
  if (hours < 48) return `ends in ${hours}h`;
  return `ends in ${Math.round(hours / 24)}d`;
}

type MenuState = 'closed' | 'confirm-delete' | 'protected' | 'report' | 'reported';

// Layout-animation builders at module scope: a stable identity lets
// reanimated skip re-registering the config on every card re-render.
// Builders are immutable after construction, but `.delay()` mutates, so
// the staggered entrances are a precomputed array, never a shared
// constant chained further.
const CARD_EXIT = FadeOut.duration(180);
const CARD_LAYOUT = LinearTransition.duration(250);
const CARD_ENTER = [0, 1, 2, 3, 4].map((i) => FadeInDown.duration(280).delay(i * 50));
const ROW_ENTER = FadeInDown.duration(160);
const NOTICE_ENTER = FadeIn.duration(150);
const TAG_ENTER = FadeInDown.duration(220);

export const PostCard = memo(function PostCard({
  post,
  mediaUrls,
  viewerIsArtist,
  unlocked,
  reactions,
  commentCount,
  poll,
  loadedAt,
  onDeleted,
  onUnlocked,
  animateIn,
  index,
}: Props) {
  const { width: windowWidth } = useWindowDimensions();
  const router = useRouter();
  const { showProfile } = useProfileCard();
  const reduceMotion = useReduceMotion();
  const [menu, setMenu] = useState<MenuState>('closed');
  const [buyerCount, setBuyerCount] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  // Apple already charged for this post earlier in the session and the
  // webhook row is still in flight: resume the honest pending state
  // instead of remounting back to a tappable "Unlock · $X" pill.
  const resumePending =
    post.is_locked && !viewerIsArtist && !unlocked && pendingUnlockIds.has(post.id);
  const [unlockNotice, setUnlockNotice] = useState<string | null>(
    resumePending ? PENDING_NOTICE : null
  );
  const [phase, setPhase] = useState<UnlockPhase>(resumePending ? 'pending' : 'idle');
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /** True from the in-session reveal on — gates the tag's entrance. */
  const [revealed, setRevealed] = useState(false);

  const dim = useSharedValue(1);
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (pendingPoll.current) clearInterval(pendingPoll.current);
      if (revealTimer.current) clearTimeout(revealTimer.current);
    },
    []
  );

  /** A failure notice that clears itself after ~4s. */
  function flashNotice(text: string) {
    setUnlockNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setUnlockNotice(null), 4000);
  }

  /** The purchase is recorded: resolve media, then celebrate and reveal. */
  async function finishUnlock() {
    setRevealed(true);
    pendingUnlockIds.delete(post.id);
    try {
      // A plain if, not ?.(): optional calls inside a try body are value
      // blocks the React Compiler refuses.
      if (onUnlocked) await onUnlocked(post);
    } catch {
      // A signing blip degrades to a late pop — never a failure message.
    }
    setJustUnlocked(true);
    successFeedback();
    setPhase('idle');
    setUnlockNotice(null);
    if (revealTimer.current) clearTimeout(revealTimer.current);
    revealTimer.current = setTimeout(() => setJustUnlocked(false), 650);
  }

  /** Every 5s, ask whether the webhook row landed; the first sighting wins. */
  function startPendingPoll() {
    if (pendingPoll.current) clearInterval(pendingPoll.current);
    pendingPoll.current = setInterval(() => {
      fetchMyPurchasedPostIds()
        .then((owned) => {
          if (!owned.has(post.id)) return;
          // A slow fetch can overlap the next tick: only the response
          // that finds the interval still armed finishes the unlock, so
          // the success buzz and the reveal can never run twice.
          if (!pendingPoll.current) return;
          clearInterval(pendingPoll.current);
          pendingPoll.current = null;
          finishUnlock();
        })
        .catch(() => {});
    }, 5000);
  }

  // A card remounting mid-pending (virtualization) resumes the webhook
  // watch; if the unlock landed by other means while it was gone (a feed
  // refresh refetched purchasedIds), just retire the session note. An
  // effect event (not a dep-suppressed effect, which would turn the React
  // Compiler off for the whole card) reads the mount-time props once.
  const resumePendingWatch = useEffectEvent(() => {
    if (!pendingUnlockIds.has(post.id)) return;
    if (post.is_locked && !viewerIsArtist && !unlocked) startPendingPoll();
    else pendingUnlockIds.delete(post.id);
  });
  useEffect(() => {
    resumePendingWatch();
  }, []);

  async function handleUnlock() {
    if (phase !== 'idle') return;
    pressFeedback();
    setPhase('buying');
    setUnlockNotice(null);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    try {
      await purchasePost(post, () => setPhase('recording'));
      await finishUnlock();
    } catch (e) {
      if (e instanceof PurchaseCancelledError) {
        // Backing out of Apple's sheet is not an error — no buzz, no notice.
        setUnlockNotice(null);
        setPhase('idle');
        return;
      }
      if (e instanceof UnlockPendingError) {
        // Paid, webhook lagging: hold an honest pending state and keep
        // checking in the background until the record lands. The id is
        // remembered at module scope so a virtualization remount resumes
        // this state instead of offering a second buy.
        pendingUnlockIds.add(post.id);
        setPhase('pending');
        setUnlockNotice(e.message);
        startPendingPoll();
        return;
      }
      errorFeedback();
      flashNotice(fanCopy(e, 'The purchase did not go through.'));
      setPhase('idle');
    }
  }

  // Local optimistic copies of reaction and poll state (synced from props).
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({});
  const [pollState, setPollState] = useState<PollState | undefined>(undefined);

  // Ref mirror so rapid double-taps read fresh state, not a stale closure.
  // Written from an effect (a tap's passive effects flush synchronously
  // with its commit), never during render, which the compiler refuses.
  const myReactionsRef = useRef(myReactions);
  useEffect(() => {
    myReactionsRef.current = myReactions;
  }, [myReactions]);

  useEffect(() => {
    setMyReactions(new Set(reactions?.mine ?? []));
    setReactionCounts({ ...(reactions?.counts ?? {}) });
  }, [post.id, reactions]);

  useEffect(() => {
    setPollState(poll ? { ...poll, options: poll.options.map((o) => ({ ...o })) } : undefined);
  }, [post.id, poll]);

  async function handleReaction(emoji: (typeof REACTION_EMOJIS)[number]) {
    const isOn = myReactionsRef.current.has(emoji);
    // Optimistic flip; revert on failure.
    setMyReactions((prev) => {
      const next = new Set(prev);
      if (isOn) next.delete(emoji);
      else next.add(emoji);
      return next;
    });
    setReactionCounts((prev) => ({ ...prev, [emoji]: Math.max(0, (prev[emoji] ?? 0) + (isOn ? -1 : 1)) }));
    try {
      await toggleReaction(post.id, emoji, isOn);
    } catch {
      setMyReactions((prev) => {
        const next = new Set(prev);
        if (isOn) next.add(emoji);
        else next.delete(emoji);
        return next;
      });
      setReactionCounts((prev) => ({ ...prev, [emoji]: Math.max(0, (prev[emoji] ?? 0) + (isOn ? 1 : -1)) }));
    }
  }

  async function handleVote(optionId: string) {
    if (!pollState) return;
    const open = !pollState.ends_at || new Date(pollState.ends_at).getTime() > Date.now();
    if (!open || pollState.myOptionId === optionId) return;
    const previous = pollState;
    setPollState({
      ...pollState,
      totalVotes: pollState.myOptionId ? pollState.totalVotes : pollState.totalVotes + 1,
      myOptionId: optionId,
      options: pollState.options.map((o) => ({
        ...o,
        votes:
          o.id === optionId
            ? o.votes + 1
            : o.id === pollState.myOptionId
              ? Math.max(0, o.votes - 1)
              : o.votes,
      })),
    });
    try {
      await votePoll(post.id, optionId);
    } catch (e) {
      setPollState(previous);
      setActionError(fanCopy(e, 'Could not send your vote.'));
    }
  }

  /** Locked from THIS viewer's perspective. */
  const locked = post.is_locked && !viewerIsArtist && !unlocked;

  // Card width minus the card's horizontal padding.
  const imageWidth = Math.min(windowWidth, 800) - 60;

  const media = [...post.post_media].sort((a, b) => a.position - b.position);
  const authorName = displayName(post.author);

  /** Opens the delete confirm — a paid post with buyers can't be deleted at all. */
  async function openDeleteConfirm() {
    if (!post.is_locked) {
      setMenu('confirm-delete');
      return;
    }
    try {
      const buyers = await countPostBuyers(post.id);
      if (buyers > 0) {
        setBuyerCount(buyers);
        setMenu('protected');
        return;
      }
    } catch {
      // Couldn't check. Show the confirm anyway; the DB still refuses a protected delete.
    }
    setMenu('confirm-delete');
  }

  async function handleDelete() {
    if (deleting) return;
    pressFeedback();
    setDeleting(true);
    // The card dims immediately — the tap landed; the server is catching up.
    dim.set(withTiming(0.5, { duration: 120 }));
    try {
      await deletePost(post.id);
      if (onDeleted) onDeleted(post.id);
    } catch (e) {
      dim.set(withTiming(1, { duration: 120 }));
      setDeleting(false);
      setMenu('closed');
      setActionError(fanCopy(e, 'Could not delete the post.'));
    }
  }

  async function handleReport(reason: string) {
    setMenu('reported');
    try {
      await fileReport('post', post.id, reason);
    } catch (e) {
      console.warn('[post-card] report failed', e);
      setMenu('closed');
      setActionError(REPORT_FAILED);
    }
  }

  // One pill, two homes (audio cover + non-audio tease): the phase machine lives here.
  const unlockPill = (
    <UnlockPill phase={phase} priceCents={post.price_cents ?? 0} onPress={handleUnlock} />
  );

  const rowEnter = reduceMotion ? undefined : ROW_ENTER;
  const noticeEnter = reduceMotion ? undefined : NOTICE_ENTER;

  return (
    // Two views on purpose: the one carrying entering/exiting has no
    // opacity in its style, so reanimated's layout animation and the
    // delete dim never fight over the same property (the '[Reanimated]
    // Property opacity' warning, and a bright flash before a delete fade).
    // Exiting is registered only for a delete — `deleting` flips before
    // deletePost runs — so rows the list recycles off-screen unmount
    // instantly instead of being held 180 ms.
    <Animated.View
      entering={animateIn && !reduceMotion ? CARD_ENTER[Math.min(index ?? 0, 4)] : undefined}
      exiting={deleting && !reduceMotion ? CARD_EXIT : undefined}
      style={styles.cardSlot}>
      <Animated.View
        layout={reduceMotion ? undefined : CARD_LAYOUT}
        style={[
          styles.card,
          post.project === 's333xgod' ? styles.cardGod : styles.cardMazze,
          dimStyle,
        ]}>
        <View style={styles.header}>
          <Pressable onPress={() => showProfile(post.author_id)} hitSlop={6}>
            {/* The raw name seeds the initial; a gone author gets the '?' placeholder, never a 'D'. */}
            <Avatar
              path={post.author?.avatar_path}
              focus={post.author?.avatar_focus}
              name={post.author?.display_name}
              size={34}
            />
          </Pressable>
          <View style={styles.who}>
            <View style={styles.nameRow}>
              <Text style={styles.author}>{authorName}</Text>
              {/* Project emblems: S333XGOD = blue star, Mazze = green skull. */}
              <Image
                source={
                  post.project === 's333xgod'
                    ? require('../../assets/images/emblem-s333xgod.png')
                    : require('../../assets/images/emblem-mazze.png')
                }
                style={styles.emblem}
                contentFit="contain"
              />
            </View>
            <Text style={styles.sub}>{timeAgo(post.created_at, loadedAt)}</Text>
          </View>
          <Pressable
            hitSlop={10}
            onPress={() => {
              if (menu !== 'closed') setMenu('closed');
              else if (viewerIsArtist) openDeleteConfirm();
              else setMenu('report');
            }}>
            <Ionicons
              name={viewerIsArtist ? 'trash-outline' : 'flag-outline'}
              size={15}
              color="#4a4d53"
            />
          </Pressable>
        </View>

        {menu === 'confirm-delete' ? (
          <Animated.View entering={rowEnter} style={styles.menuRow}>
            <Text style={styles.menuLabel}>
              {deleting ? 'Deleting…' : 'Delete this post for everyone?'}
            </Text>
            {deleting ? null : (
              <>
                <Pressable style={styles.menuChip} onPress={handleDelete}>
                  <Text style={styles.menuDanger}>Delete</Text>
                </Pressable>
                <Pressable style={styles.menuChip} onPress={() => setMenu('closed')}>
                  <Text style={styles.menuText}>Cancel</Text>
                </Pressable>
              </>
            )}
          </Animated.View>
        ) : null}

        {menu === 'protected' ? (
          <Animated.View entering={rowEnter} style={styles.menuRow}>
            <Text style={styles.menuLabel}>{paidPostBlockedMessage(buyerCount)}</Text>
            <Pressable style={styles.menuChip} onPress={() => setMenu('closed')}>
              <Text style={styles.menuText}>OK</Text>
            </Pressable>
          </Animated.View>
        ) : null}

        {menu === 'report' ? (
          <Animated.View entering={rowEnter} style={styles.menuRow}>
            {REPORT_REASONS.map((reason) => (
              <Pressable key={reason} style={styles.menuChip} onPress={() => handleReport(reason)}>
                <Text style={styles.menuText}>{reason}</Text>
              </Pressable>
            ))}
          </Animated.View>
        ) : null}

        {menu === 'reported' ? (
          <Animated.View entering={rowEnter}>
            <Text style={styles.reportedNote}>{REPORT_SENT}</Text>
          </Animated.View>
        ) : null}

        {actionError ? <Text style={styles.actionError}>{actionError}</Text> : null}

        {post.is_locked && (viewerIsArtist || unlocked) ? (
          <Animated.Text
            // The slide-fade belongs to the in-session reveal moment (and to
            // genuine feed arrivals) — a virtualization remount on scroll-back
            // renders the tag still, like the rest of the card.
            entering={!reduceMotion && (revealed || animateIn) ? TAG_ENTER : undefined}
            style={styles.unlockedTag}>
            {viewerIsArtist ? `Locked post · ${priceLabel(post.price_cents ?? 0)}` : 'Unlocked'}
          </Animated.Text>
        ) : null}

        {post.body && !locked ? <Text style={styles.body}>{post.body}</Text> : null}

        {post.kind === 'poll' && pollState && !locked ? (
          <View style={styles.poll}>
            {pollState.options.map((option) => {
              const pct =
                pollState.totalVotes > 0 ? Math.round((option.votes / pollState.totalVotes) * 100) : 0;
              const isMine = pollState.myOptionId === option.id;
              return (
                <PollBar
                  key={option.id}
                  pct={pct}
                  label={option.label}
                  mine={isMine}
                  onPress={() => handleVote(option.id)}
                />
              );
            })}
            <Text style={styles.pollMeta}>
              {pollState.totalVotes} vote{pollState.totalVotes === 1 ? '' : 's'}
              {pollState.ends_at ? ` · ${formatEndsIn(pollState.ends_at)}` : ''}
            </Text>
          </View>
        ) : null}

        {locked && post.kind === 'audio' ? (
          // A locked track keeps the player's shape: the same cover block,
          // blurred, with the unlock pill sitting where play would be.
          <>
            <AudioCover
              project={post.project}
              eyebrow={`LOCKED · ${projectLabel(post.project)}`}
              title={post.title ?? ''}
              coverUrl={post.cover_path ? mediaUrls[post.cover_path] : undefined}
              coverFocus={post.cover_focus ?? 0.5}
              locked>
              <View style={styles.lockRow}>
                <View style={styles.lockSeat}>
                  <Ionicons name="lock-closed" size={18} color="#e8e9eb" />
                </View>
                {unlockPill}
              </View>
            </AudioCover>
            {/* Reserved slot: the notice appears without re-laying-out the card. */}
            <View style={[styles.noticeSlot, styles.noticeSlotAudio]}>
              {unlockNotice ? (
                <Animated.Text entering={noticeEnter} style={styles.unlockNotice}>
                  {unlockNotice}
                </Animated.Text>
              ) : null}
            </View>
          </>
        ) : locked ? (
          <View style={styles.teaseWrap}>
            {post.cover_path && mediaUrls[post.cover_path] ? (
              // The real cover art, heavily blurred — a tease of what's inside.
              <Image
                source={{ uri: mediaUrls[post.cover_path] }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={22}
                transition={200}
              />
            ) : (
              <Image
                source={
                  post.project === 's333xgod'
                    ? require('../../assets/images/emblem-s333xgod.png')
                    : require('../../assets/images/emblem-mazze.png')
                }
                style={styles.teaseEmblem}
                contentFit="contain"
                blurRadius={3}
              />
            )}
            <View style={styles.teaseScrim} />
            <View style={styles.teaseContent}>
              <Ionicons name="lock-closed" size={20} color="#e8e9eb" />
              <Text style={styles.teaseTitle} numberOfLines={1}>
                {post.title ?? `LOCKED · ${projectLabel(post.project)}`}
              </Text>
              {unlockPill}
              {/* Reserved slot: the notice appears without shoving the tease. */}
              <View style={styles.noticeSlot}>
                {unlockNotice ? (
                  <Animated.Text entering={noticeEnter} style={styles.teaseSub}>
                    {unlockNotice}
                  </Animated.Text>
                ) : null}
              </View>
            </View>
          </View>
        ) : null}

        <View>
          {locked
            ? null
            : post.kind === 'audio'
              ? media.map((item) => {
                  const url = mediaUrls[item.storage_path];
                  if (!url) {
                    // Reserve the player's final shape while the link signs.
                    return (
                      <AudioCover
                        key={item.id}
                        project={post.project}
                        eyebrow={projectLabel(post.project)}
                        title={post.title ?? projectLabel(post.project)}
                        coverUrl={post.cover_path ? mediaUrls[post.cover_path] : undefined}
                        coverFocus={post.cover_focus ?? 0.5}>
                        <View style={styles.pendingControls}>
                          <View style={styles.pendingDisc}>
                            <ActivityIndicator size="small" color="#0b0c0e" />
                          </View>
                        </View>
                      </AudioCover>
                    );
                  }
                  return (
                    <AudioPlayerCard
                      key={item.id}
                      postId={post.id}
                      title={post.title ?? projectLabel(post.project)}
                      url={url}
                      project={post.project}
                      coverUrl={post.cover_path ? mediaUrls[post.cover_path] : undefined}
                      coverFocus={post.cover_focus ?? 0.5}
                    />
                  );
                })
              : null}

          {post.kind === 'video' && !locked
            ? media.map((item) => {
                const url = mediaUrls[item.storage_path];
                const aspect = item.width && item.height ? item.width / item.height : 16 / 9;
                if (!url) {
                  // Poster-sized ghost so the row never reflows when the link lands.
                  return (
                    <View
                      key={item.id}
                      style={[
                        styles.pendingPoster,
                        { width: imageWidth, height: imageWidth / aspect },
                      ]}>
                      <View style={styles.pendingBadge}>
                        <Ionicons name="play" size={22} color="#0b0c0e" style={styles.pendingNudge} />
                      </View>
                    </View>
                  );
                }
                return (
                  <VideoPlayerCard
                    key={item.id}
                    url={url}
                    width={imageWidth}
                    sourceWidth={item.width}
                    sourceHeight={item.height}
                  />
                );
              })
            : null}

          {locked || post.kind === 'audio' || post.kind === 'video'
            ? null
            : media.map((item) => {
                const url = mediaUrls[item.storage_path];
                const aspect = item.width && item.height ? item.width / item.height : 1;
                if (!url) {
                  // Final-size shimmer — the photo fades in exactly where it will live.
                  return (
                    <Skeleton
                      key={item.id}
                      height={imageWidth / aspect}
                      radius={12}
                      style={styles.mediaGap}
                    />
                  );
                }
                return (
                  <Image
                    key={item.id}
                    source={{ uri: url }}
                    style={[styles.image, { width: imageWidth, height: imageWidth / aspect }]}
                    contentFit="cover"
                    transition={150}
                  />
                );
              })}

          {justUnlocked && !locked ? (
            <RevealOverlay
              coverUrl={post.cover_path ? mediaUrls[post.cover_path] : undefined}
              project={post.project}
              bleed={post.kind === 'audio'}
            />
          ) : null}
        </View>

        {viewerIsArtist && post.kind !== 'text' && post.kind !== 'poll' && media.length === 0 ? (
          // Only the artist sees this: the post row exists but its file never
          // landed (an upload that died mid-way), so fans get a bare text card.
          <Text style={styles.missingMedia}>
            {post.kind === 'audio'
              ? 'No audio attached'
              : post.kind === 'video'
                ? 'No video attached'
                : 'No photos attached'}
            {post.is_locked
              ? ". The upload didn't finish. Fans see a paywall with nothing behind it; delete this post before anyone buys it and post it again."
              : ". The upload didn't finish. Fans only see the text; delete this post and post it again."}
          </Text>
        ) : null}

        <View style={styles.socialRow}>
          {REACTION_EMOJIS.map((emoji) => (
            <ReactionChip
              key={emoji}
              emoji={emoji}
              count={reactionCounts[emoji] ?? 0}
              mine={myReactions.has(emoji)}
              onPress={() => handleReaction(emoji)}
            />
          ))}
          <Pressable
            style={styles.commentsChip}
            onPress={() => router.push(`/post/${post.id}` as never)}
            hitSlop={4}>
            <Ionicons name="chatbubble-outline" size={13} color="#9a9ba3" />
            <Text style={styles.commentsText}>
              {commentCount && commentCount > 0 ? commentCount : 'Comment'}
            </Text>
          </Pressable>
        </View>
      </Animated.View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  // The slot owns the geometry (margins), the card owns the surface:
  // same layout as one view carrying both, split so the entrance/exit
  // view has no opacity of its own.
  cardSlot: { marginHorizontal: 14, marginBottom: 14 },
  card: {
    backgroundColor: '#101216',
    borderRadius: 16,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  cardGod: { borderWidth: 1, borderColor: 'rgba(88, 178, 235, 0.22)' },
  cardMazze: { borderWidth: 1, borderColor: 'rgba(126, 211, 84, 0.18)' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  who: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { color: '#fff', fontWeight: '600', fontSize: 14 },
  sub: { color: '#6d7076', fontSize: 11.5, marginTop: 1 },
  emblem: { width: 20, height: 20 },
  body: { color: '#cbcdd1', fontSize: 14, lineHeight: 22 },
  image: { borderRadius: 12, marginTop: 12, backgroundColor: '#1a1d22' },
  mediaGap: { marginTop: 12 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  menuLabel: { color: '#9a9ba3', fontSize: 13, flexShrink: 1 },
  menuChip: {
    backgroundColor: '#1e2126',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  menuText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  menuDanger: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  reportedNote: { color: '#4fc07a', fontSize: 13, marginBottom: 8 },
  actionError: { color: '#f87171', fontSize: 13, marginBottom: 8 },
  missingMedia: { color: '#e6b45c', fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  unlockedTag: {
    color: '#c3cdd6',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  teaseWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#14171b',
    aspectRatio: 16 / 9,
    marginTop: 10,
    justifyContent: 'center',
  },
  teaseEmblem: {
    position: 'absolute',
    alignSelf: 'center',
    width: '55%',
    height: '75%',
    opacity: 0.16,
  },
  teaseScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(5, 7, 9, 0.45)',
  },
  teaseContent: { alignItems: 'center', gap: 8, paddingHorizontal: 20 },
  teaseTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.3,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 8,
  },
  teaseSub: { color: '#aab2ba', fontSize: 11.5, textAlign: 'center' },
  noticeSlot: { minHeight: 18, justifyContent: 'center' },
  noticeSlotAudio: { marginTop: 6 },
  unlockPill: {
    backgroundColor: '#c3cdd6',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  unlockPillRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  unlockPillText: { color: '#14161a', fontWeight: '700', fontSize: 13 },
  unlockPillBusy: { opacity: 0.6 },
  unlockPillDim: { opacity: 0.7 },
  // Locked audio: the lock sits in the play button's seat, pill beside it.
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  lockSeat: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(4,6,8,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  unlockNotice: { color: '#aab2ba', fontSize: 11.5 },
  // Unresolved media placeholders: the final shape, waiting for its link.
  pendingControls: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  pendingDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingPoster: {
    borderRadius: 12,
    marginTop: 12,
    backgroundColor: '#14151a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ffffff',
    opacity: 0.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingNudge: { marginLeft: 3 },
  // The just-unlocked blur, dissolving over the real media.
  revealOverlay: {
    position: 'absolute',
    top: 12,
    bottom: 0,
    left: 0,
    right: 0,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#14171b',
    justifyContent: 'center',
  },
  revealBleed: { left: -16, right: -16, borderRadius: 0 },
  socialRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 12, flexWrap: 'wrap' },
  react: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#1a1d22',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  reactOn: {
    backgroundColor: '#2a2f36',
    borderWidth: 1,
    borderColor: '#c3cdd6',
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  reactEmoji: { fontSize: 13, color: '#e8e9eb' },
  reactCount: { fontSize: 11, color: '#8f99a3', fontWeight: '600' },
  commentsChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  commentsText: { fontSize: 12, color: '#9a9ba3', fontWeight: '600' },
  poll: { marginTop: 10 },
  pollBar: {
    backgroundColor: '#1a1d22',
    borderRadius: 10,
    marginBottom: 7,
    overflow: 'hidden',
  },
  pollFill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: '#2a2f36' },
  pollRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  pollLabel: { color: '#cbcdd1', fontSize: 13 },
  pollLabelMine: { color: '#e8f0f4', fontWeight: '700' },
  pollPct: { color: '#8f99a3', fontSize: 12, fontWeight: '600' },
  pollMeta: { color: '#6d7076', fontSize: 11.5, marginTop: 2 },
});
