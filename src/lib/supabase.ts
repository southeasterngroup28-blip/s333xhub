import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase config. Copy .env.example to .env, fill in your project URL and anon key from the Supabase dashboard, then restart with `npx expo start -c`.'
  );
}

// True when this code runs outside a real app/browser (e.g. during web
// pre-rendering in Node), where there is no storage to persist a session in.
const hasWindow = typeof window !== 'undefined';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: hasWindow ? AsyncStorage : undefined,
    autoRefreshToken: hasWindow,
    persistSession: hasWindow,
    detectSessionInUrl: false,
  },
});

// Keep the login session fresh while the app is open; pause when backgrounded.
if (hasWindow) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
}

/** The signed-in user's id — or a human-readable error, never a TypeError. */
export async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const id = data.user?.id;
  if (!id) throw new Error('Your session expired - please sign in again.');
  return id;
}
