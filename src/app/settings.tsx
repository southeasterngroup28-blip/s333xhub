import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SUPPORT_EMAIL } from '@/lib/legal-content';
import { deleteMyAccount, fetchBlockedUsers, unblockUser } from '@/lib/moderation';
import {
  DEFAULT_PREFS,
  fetchNotificationPrefs,
  setNotificationPref,
  type NotificationPrefs,
} from '@/lib/notifications';
import { useAuth } from '@/providers/auth-provider';

const PREF_LABELS: { key: keyof NotificationPrefs; label: string; hint: string }[] = [
  { key: 'new_posts', label: 'New posts', hint: 'When the artist drops something new' },
  { key: 'group_chat', label: 'Community chat', hint: 'Messages in the group chat' },
  { key: 'dms', label: 'Direct messages', hint: 'When you get a DM' },
];

export default function SettingsScreen() {
  const { session, profile, signOut } = useAuth();
  const router = useRouter();
  const [blocked, setBlocked] = useState<{ id: string; name: string }[]>([]);
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [confirmDelete, setConfirmDelete] = useState(0); // 0 = idle, 1 = first confirm shown
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isArtist = profile?.role === 'artist';

  useEffect(() => {
    fetchBlockedUsers()
      .then(setBlocked)
      .catch(() => {});
    fetchNotificationPrefs()
      .then(setPrefs)
      .catch(() => {});
  }, []);

  async function togglePref(key: keyof NotificationPrefs, value: boolean) {
    const previous = prefs;
    const next = { ...prefs, [key]: value };
    setPrefs(next);
    try {
      await setNotificationPref(key, value, previous);
    } catch (e) {
      setPrefs(previous); // revert on failure
      setError((e as { message?: string })?.message ?? 'Could not save that setting.');
    }
  }

  async function handleUnblock(id: string) {
    try {
      await unblockUser(id);
      setBlocked((prev) => prev.filter((b) => b.id !== id));
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not unblock.');
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
      setError((e as { message?: string })?.message ?? 'Could not delete the account.');
      setBusy(false);
      setConfirmDelete(0);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))}
          hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <View style={styles.card}>
          <Text style={styles.name}>{profile?.display_name ?? '…'}</Text>
          <Text style={styles.email}>{session?.user.email}</Text>
          {isArtist ? <Text style={styles.artistTag}>Artist account</Text> : null}
        </View>

        <Text style={styles.sectionLabel}>NOTIFICATIONS</Text>
        <View style={styles.card}>
          {PREF_LABELS.map((row) => (
            <View key={row.key} style={styles.prefRow}>
              <View style={styles.prefText}>
                <Text style={styles.prefLabel}>{row.label}</Text>
                <Text style={styles.prefHint}>{row.hint}</Text>
              </View>
              <Switch
                value={prefs[row.key]}
                onValueChange={(value) => togglePref(row.key, value)}
                trackColor={{ false: '#333', true: '#fbbf24' }}
                thumbColor="#fff"
              />
            </View>
          ))}
          <Text style={styles.prefNote}>
            Notifications start arriving with the App Store version of the app.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>BLOCKED USERS</Text>
        <View style={styles.card}>
          {blocked.length === 0 ? (
            <Text style={styles.muted}>You haven't blocked anyone.</Text>
          ) : (
            blocked.map((user) => (
              <View key={user.id} style={styles.blockedRow}>
                <Text style={styles.blockedName}>{user.name}</Text>
                <Pressable onPress={() => handleUnblock(user.id)} hitSlop={8}>
                  <Text style={styles.unblock}>Unblock</Text>
                </Pressable>
              </View>
            ))
          )}
        </View>

        <Text style={styles.sectionLabel}>ABOUT</Text>
        <View style={styles.card}>
          <Pressable style={styles.aboutRow} onPress={() => router.push('/legal/terms')}>
            <Text style={styles.aboutLink}>Terms of Service</Text>
            <Ionicons name="chevron-forward" size={16} color="#444" />
          </Pressable>
          <Pressable style={styles.aboutRow} onPress={() => router.push('/legal/privacy')}>
            <Text style={styles.aboutLink}>Privacy Policy</Text>
            <Ionicons name="chevron-forward" size={16} color="#444" />
          </Pressable>
          <Text style={styles.supportNote}>Support: {SUPPORT_EMAIL}</Text>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable style={styles.signOut} onPress={signOut}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>

        {!isArtist ? (
          <View style={styles.dangerZone}>
            <Text style={styles.sectionLabel}>DANGER ZONE</Text>
            {confirmDelete === 0 ? (
              <Pressable style={styles.deleteButton} onPress={() => setConfirmDelete(1)}>
                <Text style={styles.deleteText}>Delete my account</Text>
              </Pressable>
            ) : (
              <View style={styles.card}>
                <Text style={styles.deleteWarning}>
                  This permanently deletes your account, your messages, and your purchases record.
                  It cannot be undone.
                </Text>
                <View style={styles.deleteRow}>
                  <Pressable
                    style={styles.deleteConfirm}
                    onPress={handleDeleteAccount}
                    disabled={busy}>
                    {busy ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.deleteConfirmText}>Yes, delete everything</Text>
                    )}
                  </Pressable>
                  <Pressable onPress={() => setConfirmDelete(0)} disabled={busy}>
                    <Text style={styles.cancel}>Cancel</Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
        ) : (
          <Text style={styles.artistNote}>
            The artist account can't be deleted from inside the app.
          </Text>
        )}
      </ScrollView>
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
  content: { padding: 16, paddingBottom: 64 },
  sectionLabel: {
    color: '#666',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
    marginBottom: 8,
    marginTop: 20,
  },
  card: { backgroundColor: '#131315', borderRadius: 12, padding: 16 },
  name: { color: '#fff', fontSize: 17, fontWeight: '700' },
  email: { color: '#888', fontSize: 14, marginTop: 2 },
  artistTag: { color: '#fbbf24', fontSize: 12, fontWeight: '700', marginTop: 6 },
  muted: { color: '#555' },
  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  prefText: { flex: 1, paddingRight: 12 },
  prefLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
  prefHint: { color: '#777', fontSize: 12, marginTop: 1 },
  prefNote: { color: '#555', fontSize: 12, marginTop: 10 },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  aboutLink: { color: '#fff', fontSize: 15 },
  supportNote: { color: '#555', fontSize: 12, marginTop: 8 },
  blockedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  blockedName: { color: '#fff', fontSize: 15 },
  unblock: { color: '#5b9cf6', fontWeight: '600' },
  error: { color: '#f87171', marginTop: 16 },
  signOut: { marginTop: 28, alignItems: 'center', padding: 12 },
  signOutText: { color: '#888', fontSize: 15 },
  dangerZone: { marginTop: 12 },
  deleteButton: { alignItems: 'center', padding: 12 },
  deleteText: { color: '#f87171', fontSize: 15, fontWeight: '600' },
  deleteWarning: { color: '#ccc', fontSize: 14, lineHeight: 20 },
  deleteRow: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 14 },
  deleteConfirm: { backgroundColor: '#7f1d1d', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  deleteConfirmText: { color: '#fff', fontWeight: '700' },
  cancel: { color: '#888' },
  artistNote: { color: '#555', fontSize: 13, textAlign: 'center', marginTop: 24 },
});
