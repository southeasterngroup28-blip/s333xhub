import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';

import { supabase } from '@/lib/supabase';

export type Profile = {
  id: string;
  display_name: string;
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
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  profile: null,
  profileError: null,
  isLoading: true,
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
    supabase
      .from('profiles')
      .select('id, display_name, role, status')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (cancelled) return;
        setProfile(data);
        setProfileError(error ? error.message : null);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user.id]);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        profileError,
        isLoading,
        signOut: async () => {
          await supabase.auth.signOut();
        },
      }}>
      {children}
    </AuthContext.Provider>
  );
}
