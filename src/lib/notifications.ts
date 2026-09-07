import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

export type NotificationPrefs = {
  new_posts: boolean;
  group_chat: boolean;
  dms: boolean;
  shows: boolean;
};

export const DEFAULT_PREFS: NotificationPrefs = {
  new_posts: true,
  group_chat: true,
  dms: true,
  shows: true,
};

/** This user's opt-outs; no row yet means everything on. */
export async function fetchNotificationPrefs(): Promise<NotificationPrefs> {
  const { data, error } = await supabase
    .from('notification_prefs')
    .select('new_posts, group_chat, dms, shows')
    .maybeSingle();
  if (error) throw error;
  // Merge over defaults so a row written before a newer column existed still reads as "on".
  return { ...DEFAULT_PREFS, ...((data as Partial<NotificationPrefs> | null) ?? {}) };
}

export async function setNotificationPref(
  key: keyof NotificationPrefs,
  value: boolean,
  current: NotificationPrefs
): Promise<void> {
  const me = (await supabase.auth.getUser()).data.user!.id;
  const { error } = await supabase
    .from('notification_prefs')
    .upsert({ user_id: me, ...current, [key]: value, updated_at: new Date().toISOString() });
  if (error) throw error;
}

/**
 * Asks the phone for push permission and files this device's delivery
 * address. Does nothing in a web browser or in Expo Go — it needs the
 * real (development or App Store) build. The app must keep working
 * fully when permission is denied — never gate anything on this.
 */
export async function registerPushToken(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Device = await import('expo-device');
    if (!Device.isDevice) return;

    const Notifications = await import('expo-notifications');
    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== 'granted') {
      const request = await Notifications.requestPermissionsAsync();
      status = request.status;
    }
    if (status !== 'granted') return; // Denied is fine — the app works without it.

    const token = (await Notifications.getExpoPushTokenAsync()).data;
    const me = (await supabase.auth.getUser()).data.user?.id;
    if (!me || !token) return;

    // The RPC evicts this token from any OTHER account first — a phone
    // only ever receives pushes for whoever is currently signed in.
    await supabase.rpc('register_push_token', {
      p_token: token,
      p_platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
  } catch {
    // Push registration must never break the app.
  }
}

/**
 * Forget this device on sign-out — a phone that signed out should stop
 * buzzing for that account. Best-effort; never blocks the sign-out.
 */
export async function unregisterPushToken(): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    const Device = await import('expo-device');
    if (!Device.isDevice) return;
    const Notifications = await import('expo-notifications');
    const token = (await Notifications.getExpoPushTokenAsync()).data;
    const me = (await supabase.auth.getUser()).data.user?.id;
    if (!me || !token) return;
    await supabase.from('push_tokens').delete().eq('user_id', me).eq('token', token);
  } catch {
    // Never block sign-out.
  }
}
