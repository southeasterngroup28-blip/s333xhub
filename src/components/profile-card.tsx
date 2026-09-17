import Ionicons from '@expo/vector-icons/Ionicons';
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Skeleton } from '@/components/skeleton';
import { eyebrow } from '@/constants/type';
import { tapFeedback } from '@/lib/haptics';
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

/**
 * What the card is showing. Tracked outright rather than inferred from a
 * null profile: a network blip and a deleted account are different
 * stories, and neither may quietly close the card.
 */
type CardStatus = 'loading' | 'error' | 'gone' | 'ready';

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

/** The card's own ghost: avatar, name, tag, member-since, in place. */
function CardSkeleton() {
  return (
    <>
      <Skeleton width={84} height={84} radius={42} />
      <Skeleton width={150} height={16} style={styles.skelName} />
      <Skeleton width={90} height={10} style={styles.skelTag} />
      <Skeleton width={130} height={10} style={styles.skelMeta} />
    </>
  );
}

export function ProfileCardProvider({ children }: PropsWithChildren) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<CardStatus>('loading');
  const [profile, setProfile] = useState<CardProfile | null>(null);
  const requestSeq = useRef(0);
  /** Who the card is for right now, so Try again re-asks for the same person. */
  const lastUserId = useRef<string | null>(null);

  const showProfile = useCallback((userId: string) => {
    const seq = ++requestSeq.current;
    lastUserId.current = userId;
    setProfile(null);
    setStatus('loading');
    setOpen(true);
    (async () => {
      const [{ data: p, error }, { data: top }] = await Promise.all([
        supabase
          .from('profiles')
          .select('id, display_name, avatar_path, avatar_focus, role, created_at')
          .eq('id', userId)
          .maybeSingle(),
        supabase.from('top_fans').select('position').eq('user_id', userId).maybeSingle(),
      ]);
      if (seq !== requestSeq.current) return; // a newer tap superseded this one
      if (error) {
        // The card stays open and says so - it never closes itself.
        setStatus('error');
        return;
      }
      if (!p) {
        setStatus('gone');
        return;
      }
      setProfile({ ...(p as Omit<CardProfile, 'topFanPosition'>), topFanPosition: top?.position ?? null });
      setStatus('ready');
    })();
  }, []);

  function retry() {
    tapFeedback();
    if (lastUserId.current) showProfile(lastUserId.current);
  }

  return (
    <ProfileCardContext.Provider value={{ showProfile }}>
      {children}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.card} onPress={() => {}}>
            {status === 'ready' && profile ? (
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
                  <Text style={styles.tagTop}>TOP {profile.topFanPosition} FAN</Text>
                ) : (
                  <Text style={styles.tagFan}>FAN</Text>
                )}
                <View style={styles.metaRow}>
                  <Ionicons name="calendar-outline" size={13} color="#6d7076" />
                  <Text style={styles.meta}>Here since {memberSince(profile.created_at)}</Text>
                </View>
              </>
            ) : status === 'error' ? (
              <>
                <Text style={styles.stateTitle}>Couldn&apos;t load this profile.</Text>
                <Text style={styles.stateSub}>Check your connection.</Text>
                <Pressable
                  hitSlop={12}
                  onPress={retry}
                  style={({ pressed }) => [styles.retry, pressed && styles.retryPressed]}
                  accessibilityRole="button">
                  <Text style={styles.retryText}>Try again</Text>
                </Pressable>
              </>
            ) : status === 'gone' ? (
              <Text style={styles.stateTitle}>This profile is gone.</Text>
            ) : (
              <CardSkeleton />
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
  skelName: { marginTop: 16 },
  skelTag: { marginTop: 8 },
  skelMeta: { marginTop: 14 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 14 },
  name: { color: '#fff', fontSize: 19, fontWeight: '700' },
  cross: { color: '#dce3ea', fontSize: 17, fontWeight: '700' },
  // The one artist tag (chat, channel, settings share the token and the string).
  tagArtist: { ...eyebrow, marginTop: 6 },
  tagTop: { ...eyebrow, color: '#e8d27b', marginTop: 6 },
  tagFan: { ...eyebrow, color: '#6d7076', marginTop: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  meta: { color: '#6d7076', fontSize: 12.5 },
  stateTitle: { color: '#e8e9eb', fontSize: 15, fontWeight: '600', textAlign: 'center', paddingTop: 8 },
  stateSub: { color: '#6d7076', fontSize: 13, marginTop: 6, textAlign: 'center' },
  retry: { marginTop: 16, paddingVertical: 6, paddingHorizontal: 8 },
  retryPressed: { opacity: 0.6 },
  retryText: { color: '#c3cdd6', fontSize: 13, fontWeight: '600' },
});
