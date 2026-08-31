import Ionicons from '@expo/vector-icons/Ionicons';
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type PropsWithChildren,
} from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { supabase } from '@/lib/supabase';

type CardProfile = {
  id: string;
  display_name: string;
  avatar_path: string | null;
  avatar_focus: number | null;
  role: string;
  created_at: string;
  topFanPosition: number | null;
};

type ProfileCardContextValue = {
  /** Opens the little profile card for any user id. */
  showProfile: (userId: string) => void;
};

const ProfileCardContext = createContext<ProfileCardContextValue>({ showProfile: () => {} });

export function useProfileCard() {
  return useContext(ProfileCardContext);
}

function memberSince(createdAt: string): string {
  const date = new Date(createdAt);
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function ProfileCardProvider({ children }: PropsWithChildren) {
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState<CardProfile | null>(null);

  const showProfile = useCallback((userId: string) => {
    setProfile(null);
    setOpen(true);
    (async () => {
      const [{ data: p }, { data: top }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, display_name, avatar_path, avatar_focus, role, created_at')
          .eq('id', userId)
          .maybeSingle(),
        supabase.from('top_fans').select('position').eq('user_id', userId).maybeSingle(),
      ]);
      if (!p) {
        setOpen(false);
        return;
      }
      setProfile({ ...(p as Omit<CardProfile, 'topFanPosition'>), topFanPosition: top?.position ?? null });
    })();
  }, []);

  return (
    <ProfileCardContext.Provider value={{ showProfile }}>
      {children}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.card} onPress={() => {}}>
            {profile ? (
              <>
                <Avatar
                  path={profile.avatar_path}
                  focus={profile.avatar_focus}
                  name={profile.display_name}
                  size={84}
                />
                <View style={styles.nameRow}>
                  <Text style={styles.name}>{profile.display_name}</Text>
                  {profile.role === 'artist' ? <Text style={styles.cross}>†</Text> : null}
                </View>
                {profile.role === 'artist' ? (
                  <Text style={styles.tagArtist}>THE ARTIST</Text>
                ) : profile.topFanPosition ? (
                  <Text style={styles.tagTop}>★ TOP {profile.topFanPosition} FAN</Text>
                ) : (
                  <Text style={styles.tagFan}>FAN</Text>
                )}
                <View style={styles.metaRow}>
                  <Ionicons name="calendar-outline" size={13} color="#6d7076" />
                  <Text style={styles.meta}>Here since {memberSince(profile.created_at)}</Text>
                </View>
              </>
            ) : (
              <ActivityIndicator color="#8f99a3" style={styles.loading} />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </ProfileCardContext.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(4, 5, 7, 0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  card: {
    width: '100%',
    maxWidth: 300,
    backgroundColor: '#14171b',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#262a30',
    alignItems: 'center',
    padding: 26,
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  loading: { paddingVertical: 40 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14 },
  name: { color: '#fff', fontSize: 19, fontWeight: '700' },
  cross: { color: '#dce3ea', fontSize: 17, fontWeight: '700' },
  tagArtist: {
    color: '#c3cdd6',
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 2,
    marginTop: 6,
  },
  tagTop: { color: '#e8d27b', fontSize: 10.5, fontWeight: '700', letterSpacing: 2, marginTop: 6 },
  tagFan: { color: '#6d7076', fontSize: 10.5, fontWeight: '700', letterSpacing: 2, marginTop: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  meta: { color: '#6d7076', fontSize: 12.5 },
});
