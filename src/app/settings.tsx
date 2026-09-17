import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { AvatarFramer } from '@/components/avatar-framer';
import { PickPhotosButton, type PickedImageDraft } from '@/components/media-pickers';
import { invalidateBackgroundCache } from '@/components/app-background';
import { PushedHeader } from '@/components/pushed-header';
import { capLabel, chip, confirmDanger, confirmQuestion, confirmWord, eyebrow } from '@/constants/type';
import { removeMyAvatar, setMyAvatar } from '@/lib/avatars';
import { fanCopy } from '@/lib/fan-error';
import { errorFeedback, pressFeedback, selectFeedback, successFeedback, tapFeedback } from '@/lib/haptics';
import { restorePurchases } from '@/lib/payments';
import { markFeedStale } from '@/lib/posts';
import { fetchMyPieces, type MyPiece } from '@/lib/shop';
import { clearMyBackground, setDefaultBackground, setMyBackground } from '@/lib/backgrounds';
import { SUPPORT_EMAIL } from '@/lib/legal-content';
import { deleteMyAccount, fetchBlockedUsers, unblockUser } from '@/lib/moderation';
import {
  DEFAULT_PREFS,
  fetchNotificationPrefs,
  setNotificationPref,
  type NotificationPrefs,
} from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth-provider';

/** Which of the mount fetches failed, so each section can say so and retry. */
type FailedSections = { blocked: boolean; prefs: boolean; pieces: boolean };

/** The one line a section shows instead of pretending it loaded empty. */
function RetryLine({ onRetry }: { onRetry: () => void }) {
  return (
    <Pressable
      hitSlop={8}
      onPress={() => {
        tapFeedback();
        onRetry();
      }}
      style={({ pressed }) => [styles.retryLine, pressed && styles.retryLinePressed]}
      accessibilityRole="button">
      <Text style={styles.retryLineText}>Could not load. Tap to retry.</Text>
    </Pressable>
  );
}

const PREF_LABELS: { key: keyof NotificationPrefs; label: string }[] = [
  { key: 'new_posts', label: 'New posts' },
  { key: 'group_chat', label: 'Community' },
  { key: 'dms', label: 'Direct messages' },
  { key: 'shows', label: 'Show announcements' },
];

/** A sentence-case group word over a run of hairline rows. */
function Group({ children }: { children: string }) {
  return <Text style={styles.group}>{children}</Text>;
}

export default function SettingsScreen() {
  const { session, profile, signOut, refreshProfile } = useAuth();
  const router = useRouter();
  const [blocked, setBlocked] = useState<{ id: string; name: string }[]>([]);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  /** Once the user touches a switch, the late-arriving fetch must not undo it. */
  const prefsDirty = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(0); // 0 = idle, 1 = first confirm shown
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bgBusy, setBgBusy] = useState(false);
  const [bgNotice, setBgNotice] = useState<string | null>(null);
  const [avatarPath, setAvatarPath] = useState<string | null | undefined>(undefined);
  const [avatarFocus, setAvatarFocus] = useState<number | null>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  /** Freshly picked photo awaiting circle-framing in the editor. */
  const [avatarDraft, setAvatarDraft] = useState<PickedImageDraft | null>(null);
  const [pieces, setPieces] = useState<MyPiece[]>([]);
  /** This fan's Top 3 slot, read the way the profile card reads it. */
  const [topFanPosition, setTopFanPosition] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreNotice, setRestoreNotice] = useState<string | null>(null);
  const restoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [failed, setFailed] = useState<FailedSections>({ blocked: false, prefs: false, pieces: false });
  const [signingOut, setSigningOut] = useState(false);

  // Local override so the preview updates instantly after a change.
  const shownAvatar = avatarPath === undefined ? profile?.avatar_path : avatarPath;
  const shownFocus = avatarFocus ?? profile?.avatar_focus ?? 0.5;

  function flashBg(text: string) {
    setBgNotice(text);
    setTimeout(() => setBgNotice(null), 3000);
  }

  /** The restore notice: 3s on screen, a re-press restarts the clock. */
  function flashRestore(text: string) {
    if (restoreTimer.current) clearTimeout(restoreTimer.current);
    setRestoreNotice(text);
    restoreTimer.current = setTimeout(() => setRestoreNotice(null), 3000);
  }

  useEffect(
    () => () => {
      if (restoreTimer.current) clearTimeout(restoreTimer.current);
    },
    []
  );

  const isArtist = profile?.role === 'artist';
  const userId = session?.user.id;

  // Each section fetches on its own and remembers its own failure, so a
  // dead connection reads as "could not load" - never as "nothing here".
  const loadBlocked = useCallback(async () => {
    setFailed((f) => ({ ...f, blocked: false }));
    try {
      setBlocked(await fetchBlockedUsers());
    } catch {
      setFailed((f) => ({ ...f, blocked: true }));
    }
  }, []);

  const loadPrefs = useCallback(async () => {
    setFailed((f) => ({ ...f, prefs: false }));
    try {
      const fetched = await fetchNotificationPrefs();
      // A switch the fan already flipped must not be undone by a late fetch.
      if (!prefsDirty.current) setPrefs(fetched);
    } catch {
      // Once the fan has touched a switch, the row is theirs to keep.
      if (!prefsDirty.current) setFailed((f) => ({ ...f, prefs: true }));
    }
  }, []);

  const loadPieces = useCallback(async () => {
    setFailed((f) => ({ ...f, pieces: false }));
    try {
      setPieces(await fetchMyPieces());
    } catch {
      setFailed((f) => ({ ...f, pieces: true }));
    }
  }, []);

  // The tag under the name. A miss here just leaves the plain FAN tag, the
  // way the profile card does; nothing else depends on it.
  const loadTopFan = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase
      .from('top_fans')
      .select('position')
      .eq('user_id', userId)
      .maybeSingle();
    setTopFanPosition(data?.position ?? null);
  }, [userId]);

  const load = useCallback(() => {
    loadBlocked();
    loadPrefs();
    loadPieces();
    loadTopFan();
  }, [loadBlocked, loadPrefs, loadPieces, loadTopFan]);

  // On focus, not just on mount: coming back from a legal page (or a drop)
  // re-runs the fetches, so a failure self-heals on return.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function togglePref(key: keyof NotificationPrefs, value: boolean) {
    prefsDirty.current = true;
    const previous = prefs;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      await setNotificationPref(key, value, previous);
    } catch (e) {
      setPrefs(previous); // revert on failure
      setError(fanCopy(e, 'Could not save that setting.'));
    }
  }

  async function handleUnblock(id: string) {
    // Optimistic: the row goes at once; a failure puts THAT row back where
    // it was. Only the one row, never a whole snapshot: two overlapping
    // unblocks where the first fails after the second succeeded must not
    // resurrect the second.
    const index = blocked.findIndex((b) => b.id === id);
    const row = blocked[index];
    if (!row) return;
    selectFeedback();
    setBlocked((prev) => prev.filter((b) => b.id !== id));
    try {
      await unblockUser(id);
    } catch (e) {
      setBlocked((prev) => {
        if (prev.some((b) => b.id === id)) return prev;
        const next = [...prev];
        next.splice(Math.min(index, next.length), 0, row);
        return next;
      });
      errorFeedback();
      setError(fanCopy(e, 'Could not unblock.'));
    }
  }

  async function handleDeleteAccount() {
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount();
      // The account is gone; clear the local session too.
      await signOut();
    } catch (e) {
      errorFeedback();
      setError(fanCopy(e, 'Could not delete the account.'));
      setBusy(false);
      setConfirmDelete(0);
    }
  }

  async function handleSignOut() {
    if (signingOut) return;
    pressFeedback();
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // Offline, signOut can reject - hand the button back instead of
      // trading a dead wait for an endless spinner.
      errorFeedback();
      setSigningOut(false);
    }
  }

  async function handleRestore() {
    if (restoring) return;
    // No press haptic: the buzz here is the result (found something, or
    // failed), and a zero-count restore stays silent.
    setRestoring(true);
    setError(null);
    try {
      const count = await restorePurchases();
      // Whatever the count, the feed re-reads its unlocks on the next
      // focus - the result line must never sit over a still-locked feed.
      markFeedStale();
      if (count > 0) successFeedback();
      flashRestore(
        count > 0
          ? `${count} unlock${count === 1 ? '' : 's'} on this account.`
          : 'No unlocks on this account.'
      );
    } catch (e) {
      errorFeedback();
      setError(fanCopy(e, 'Could not restore.'));
    } finally {
      setRestoring(false);
    }
  }

  const showBlocked = failed.blocked || blocked.length > 0;
  const showPieces = failed.pieces || pieces.length > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <PushedHeader title="SETTINGS" fallback="/(tabs)" />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Who this is: the profile card's block, no card around it. */}
        <View style={styles.identity}>
          <Avatar path={shownAvatar} focus={shownFocus} name={profile?.display_name} size={56} />
          <View style={styles.identityMeta}>
            <Text style={styles.name}>{profile?.display_name ?? '…'}</Text>
            <Text style={styles.email}>{session?.user.email}</Text>
            {isArtist ? (
              <Text style={styles.tagArtist}>THE ARTIST</Text>
            ) : topFanPosition ? (
              <Text style={styles.tagTop}>TOP {topFanPosition} FAN</Text>
            ) : (
              <Text style={styles.tagFan}>FAN</Text>
            )}
          </View>
        </View>
        <View style={styles.avatarActions}>
          <PickPhotosButton
            label={shownAvatar ? 'Change photo' : 'Add profile photo'}
            maxCount={1}
            disabled={avatarBusy}
            onPicked={(picked) => {
              // Framing first; the upload happens on Save in the editor.
              if (picked[0]) setAvatarDraft(picked[0]);
            }}
            onError={setError}
          />
          {shownAvatar ? (
            <Pressable
              disabled={avatarBusy}
              onPress={async () => {
                setAvatarBusy(true);
                try {
                  await removeMyAvatar();
                  setAvatarPath(null);
                  setAvatarFocus(null);
                  refreshProfile().catch(() => {});
                } catch (e) {
                  setError(fanCopy(e, 'Could not remove it.'));
                } finally {
                  setAvatarBusy(false);
                }
              }}>
              <Text style={styles.avatarRemove}>Remove</Text>
            </Pressable>
          ) : null}
          {avatarBusy ? <ActivityIndicator color="#8f99a3" size="small" /> : null}
        </View>

        <Group>Background</Group>
        <View style={styles.block}>
          <Text style={styles.muted}>
            {isArtist
              ? 'Set the background every fan sees, or one just for you.'
              : 'Your background only shows on your account.'}
          </Text>
          {bgNotice ? <Text style={styles.okNote}>{bgNotice}</Text> : null}
          <View style={styles.bgActions}>
            <PickPhotosButton
              label="My background"
              maxCount={1}
              disabled={bgBusy}
              onPicked={async (picked) => {
                if (!picked[0]) return;
                setBgBusy(true);
                try {
                  await setMyBackground(picked[0]);
                  invalidateBackgroundCache();
                  flashBg('Saved.');
                } catch (e) {
                  setError(fanCopy(e, 'Could not save background.'));
                } finally {
                  setBgBusy(false);
                }
              }}
              onError={setError}
            />
            {isArtist ? (
              <PickPhotosButton
                label="Default for everyone"
                maxCount={1}
                disabled={bgBusy}
                onPicked={async (picked) => {
                  if (!picked[0]) return;
                  setBgBusy(true);
                  try {
                    await setDefaultBackground(picked[0]);
                    invalidateBackgroundCache();
                    flashBg('App default updated for all fans.');
                  } catch (e) {
                    setError(fanCopy(e, 'Could not set the default.'));
                  } finally {
                    setBgBusy(false);
                  }
                }}
                onError={setError}
              />
            ) : null}
          </View>
          <Pressable
            style={styles.bgReset}
            disabled={bgBusy}
            onPress={async () => {
              setBgBusy(true);
              try {
                await clearMyBackground();
                invalidateBackgroundCache();
                flashBg(isArtist ? 'Personal override removed.' : "Back to the artist's background.");
              } catch (e) {
                setError(fanCopy(e, 'Could not reset.'));
              } finally {
                setBgBusy(false);
              }
            }}>
            <Text style={styles.bgResetText}>Remove my background</Text>
          </Pressable>
        </View>

        <Group>Notifications</Group>
        {failed.prefs ? (
          // The defaults must not be tappable here: saving one switch
          // upserts the whole row and would overwrite real opt-outs.
          <View style={styles.block}>
            <RetryLine onRetry={loadPrefs} />
          </View>
        ) : (
          PREF_LABELS.map((row) => (
            <View key={row.key} style={styles.prefRow}>
              <Text style={styles.prefLabel}>{row.label}</Text>
              <Switch
                value={prefs[row.key]}
                onValueChange={(value) => togglePref(row.key, value)}
                trackColor={{ false: '#333', true: '#c3cdd6' }}
                thumbColor="#fff"
              />
            </View>
          ))
        )}

        {/* Nothing blocked, nothing to say: the group only appears with rows in it. */}
        {showBlocked ? (
          <>
            <Group>Blocked</Group>
            {failed.blocked ? (
              <View style={styles.block}>
                <RetryLine onRetry={loadBlocked} />
              </View>
            ) : (
              blocked.map((user) => (
                <View key={user.id} style={styles.blockedRow}>
                  <Text style={styles.blockedName}>{user.name}</Text>
                  <Pressable
                    onPress={() => handleUnblock(user.id)}
                    hitSlop={8}
                    style={({ pressed }) => (pressed ? styles.textPressed : undefined)}>
                    <Text style={styles.unblock}>Unblock</Text>
                  </Pressable>
                </View>
              ))
            )}
          </>
        ) : null}

        {showPieces ? (
          <>
            <Group>My pieces</Group>
            {failed.pieces ? (
              <View style={styles.block}>
                <RetryLine onRetry={loadPieces} />
              </View>
            ) : (
              pieces.map((piece) => {
                const catalogue = `DROP ${String(piece.drop?.drop_number ?? 0).padStart(3, '0')}`;
                return (
                  <Pressable
                    key={piece.id}
                    style={({ pressed }) => [styles.pieceRow, pressed && styles.textPressed]}
                    onPress={() => piece.drop && router.push(`/drop/${piece.drop.id}` as never)}>
                    <Text style={styles.pieceNum}>#{piece.edition_number}</Text>
                    <View style={styles.pieceMeta}>
                      <Text style={styles.pieceTitle} numberOfLines={1}>
                        {piece.drop?.title ?? catalogue}
                      </Text>
                      {piece.drop?.title ? <Text style={styles.pieceSub}>{catalogue}</Text> : null}
                    </View>
                    <Text
                      style={[
                        styles.pieceStatus,
                        piece.status === 'shipped' && styles.pieceStatusShipped,
                      ]}>
                      {piece.status === 'shipped'
                        ? 'SHIPPED'
                        : piece.status === 'in_works'
                          ? 'IN THE WORKS'
                          : 'CLAIMED'}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </>
        ) : null}

        <Group>About</Group>
        <View style={styles.aboutRow}>
          <Pressable
            style={({ pressed }) => [styles.aboutPress, pressed && styles.textPressed]}
            disabled={restoring}
            onPress={handleRestore}>
            <Text style={styles.aboutLink}>{restoring ? 'Restoring…' : 'Restore purchases'}</Text>
            {restoring ? (
              <ActivityIndicator size="small" color="#8f99a3" />
            ) : (
              <Ionicons name="refresh" size={16} color="#444" />
            )}
          </Pressable>
          {restoreNotice ? <Text style={styles.okNote}>{restoreNotice}</Text> : null}
        </View>
        <Pressable
          style={({ pressed }) => [styles.aboutRow, styles.aboutPress, pressed && styles.textPressed]}
          onPress={() => router.push('/legal/terms')}>
          <Text style={styles.aboutLink}>Terms of Service</Text>
          <Ionicons name="chevron-forward" size={16} color="#444" />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.aboutRow, styles.aboutPress, pressed && styles.textPressed]}
          onPress={() => router.push('/legal/privacy')}>
          <Text style={styles.aboutLink}>Privacy Policy</Text>
          <Ionicons name="chevron-forward" size={16} color="#444" />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.aboutRow, styles.aboutPress, pressed && styles.textPressed]}
          onPress={() => router.push('/legal/shop-terms' as never)}>
          <Text style={styles.aboutLink}>Shop Terms</Text>
          <Ionicons name="chevron-forward" size={16} color="#444" />
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.aboutRow, styles.aboutPress, pressed && styles.textPressed]}
          onPress={() => {
            Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {});
          }}>
          <Text style={styles.aboutLink}>Email support</Text>
          <Ionicons name="mail-outline" size={16} color="#444" />
        </Pressable>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={({ pressed }) => [
            styles.signOut,
            (pressed || signingOut) && styles.textPressed,
          ]}
          onPress={handleSignOut}
          disabled={signingOut}>
          {signingOut ? (
            <ActivityIndicator size="small" color="#8f99a3" />
          ) : (
            <Text style={styles.signOutText}>Sign out</Text>
          )}
        </Pressable>

        {!isArtist ? (
          <View style={styles.deleteSection}>
            {confirmDelete === 0 ? (
              <Pressable
                style={({ pressed }) => [styles.deleteButton, pressed && styles.textPressed]}
                onPress={() => setConfirmDelete(1)}>
                <Text style={styles.deleteText}>Delete account</Text>
              </Pressable>
            ) : (
              // The two-step confirm, inline: the warning, then the chip row
              // every other confirm uses (tokens in constants/type).
              <View style={styles.deleteConfirm}>
                <Text style={styles.deleteWarning}>
                  This permanently deletes your account, your messages, and your purchases record.
                  It cannot be undone.
                </Text>
                <View style={styles.confirmRow}>
                  <Pressable style={styles.confirmChip} onPress={handleDeleteAccount} disabled={busy}>
                    {busy ? (
                      <ActivityIndicator color="#f87171" size="small" />
                    ) : (
                      <Text style={styles.confirmDanger}>Delete account</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={styles.confirmChip}
                    onPress={() => setConfirmDelete(0)}
                    disabled={busy}>
                    <Text style={styles.confirmWord}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        ) : (
          <Text style={styles.artistNote}>
            The artist account can&apos;t be deleted from inside the app.
          </Text>
        )}
      </ScrollView>

      <AvatarFramer
        visible={!!avatarDraft}
        uri={avatarDraft?.previewUri ?? null}
        onCancel={() => setAvatarDraft(null)}
        onSave={async (focus) => {
          const draft = avatarDraft;
          setAvatarDraft(null);
          if (!draft) return;
          setAvatarBusy(true);
          setError(null);
          try {
            setAvatarPath(await setMyAvatar(draft, focus));
            setAvatarFocus(focus);
            refreshProfile().catch(() => {});
          } catch (e) {
            setError(fanCopy(e, 'Could not save the photo.'));
          } finally {
            setAvatarBusy(false);
          }
        }}
      />
    </SafeAreaView>
  );
}

/** The hairline every row in the flat list sits on. */
const hairline = {
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: '#1c2025',
} as const;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  content: { padding: 16, paddingTop: 8, paddingBottom: 64 },
  // Sentence case, no tracking: a word over a run of rows, not a caption.
  group: { color: '#6d7076', fontSize: 13, marginTop: 26, marginBottom: 4 },
  /** A row that holds prose or controls rather than a label + action. */
  block: { paddingVertical: 12, ...hairline },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  identityMeta: { flex: 1 },
  name: { color: '#fff', fontSize: 17, fontWeight: '700' },
  email: { color: '#8f99a3', fontSize: 14, marginTop: 2 },
  // The profile card's tag set, on the one eyebrow token.
  tagArtist: { ...eyebrow, marginTop: 6 },
  tagTop: { ...eyebrow, color: '#e8d27b', marginTop: 6 },
  tagFan: { ...eyebrow, color: '#6d7076', marginTop: 6 },
  avatarActions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  avatarRemove: { color: '#f87171', fontSize: 13, fontWeight: '600' },
  pieceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 11,
    ...hairline,
  },
  pieceNum: { color: '#c3cdd6', fontWeight: '800', fontSize: 14, width: 38 },
  pieceMeta: { flex: 1 },
  pieceTitle: { color: '#fff', fontSize: 13.5, fontWeight: '600' },
  pieceSub: { ...capLabel, marginTop: 2 },
  pieceStatus: { ...capLabel, color: '#8f99a3' },
  pieceStatusShipped: { color: '#7ed354' },
  muted: { color: '#55585f', fontSize: 13, lineHeight: 18 },
  okNote: { color: '#4fc07a', fontSize: 13, marginTop: 8 },
  bgActions: { flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  bgReset: { marginTop: 12, alignSelf: 'flex-start' },
  bgResetText: { color: '#8f99a3', fontSize: 13, fontWeight: '600' },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    ...hairline,
  },
  prefLabel: { color: '#fff', fontSize: 15, fontWeight: '600', flex: 1, paddingRight: 12 },
  aboutRow: { paddingVertical: 12, ...hairline },
  aboutPress: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  aboutLink: { color: '#fff', fontSize: 15 },
  blockedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 11,
    ...hairline,
  },
  blockedName: { color: '#fff', fontSize: 15 },
  unblock: { color: '#c3cdd6', fontWeight: '600' },
  textPressed: { opacity: 0.6 },
  retryLine: { paddingVertical: 4, alignSelf: 'flex-start' },
  retryLinePressed: { opacity: 0.6 },
  retryLineText: { color: '#8f99a3', fontSize: 14, fontWeight: '600' },
  error: { color: '#f87171', marginTop: 16 },
  signOut: { marginTop: 28, alignItems: 'center', padding: 12 },
  signOutText: { color: '#8f99a3', fontSize: 15 },
  deleteSection: { marginTop: 4 },
  deleteButton: { alignItems: 'center', padding: 12 },
  deleteText: { color: '#f87171', fontSize: 15, fontWeight: '600' },
  // Inline, no card: the warning, then the shared chip row.
  deleteConfirm: { paddingHorizontal: 4, paddingTop: 8 },
  deleteWarning: { ...confirmQuestion, lineHeight: 19 },
  confirmRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12 },
  confirmChip: chip,
  confirmWord: confirmWord,
  confirmDanger: confirmDanger,
  artistNote: { color: '#55585f', fontSize: 13, textAlign: 'center', marginTop: 24 },
});
