import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';
import { AppState } from 'react-native';

import { unregisterPushToken } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

export type Profile = {
  id: string;
  display_name: string;
  avatar_path: string | null;
  avatar_focus: number | null;
  role: 'fan' | 'artist';
  status: string | null;
};

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  /** Set when the profile lookup fails — surfaced for debugging. */
  profileError: string | null;
  /** True until we've checked whether a saved login exists. */
  isLoading: boolean;
  /** Re-fetches the cached profile (call after editing it, e.g. new avatar). */
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  profile: null,
  profileError: null,
  isLoading: true,
  refreshProfile: async () => {},
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [retrySeq, setRetrySeq] = useState(0);

  // If the profile fetch gave up (dead network at launch), try again the
  // next time the app comes to the foreground - no restart required.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setRetrySeq((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setIsLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfile(null);
      setProfileError(null);
      return;
    }
    let cancelled = false;

    // On native, a query fired in the same instant as sign-in can hang
    // forever (auth client lock). Race each attempt against a timeout and
    // retry — a later attempt always lands.
    const load = async (attempt: number) => {
      try {
        const result = await Promise.race([
          supabase
            .from('profiles')
            .select('id, display_name, role, status, avatar_path, avatar_focus')
            .eq('id', session.user.id)
            .single(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('profile fetch timed out')), 3000)
          ),
        ]);
        if (cancelled) return;
        if (result.data) {
          setProfile(result.data as Profile);
          setProfileError(null);
          return;
        }
        throw result.error ?? new Error('no profile row');
      } catch (e) {
        if (cancelled) return;
        if (attempt < 4) {
          setTimeout(() => load(attempt + 1), 700);
        } else {
          setProfileError((e as { message?: string })?.message ?? 'profile fetch failed');
        }
      }
    };

    const kickoff = setTimeout(() => load(0), 0);
    return () => {
      cancelled = true;
      clearTimeout(kickoff);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id, retrySeq]);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        profileError,
        isLoading,
        refreshProfile: async () => {
          if (!session) return;
          const { data } = await supabase
            .from('profiles')
            .select('id, display_name, role, status, avatar_path, avatar_focus')
            .eq('id', session.user.id)
            .single();
          if (data) setProfile(data as Profile);
        },
        signOut: async () => {
          // Stop this device buzzing for the account being signed out.
          await unregisterPushToken().catch(() => {});
          await supabase.auth.signOut();
        },
      }}>
      {children}
    </AuthContext.Provider>
  );
}
