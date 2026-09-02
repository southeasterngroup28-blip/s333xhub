// In-house crash reporting: fatal JS errors are filed to our own
// client_errors table — no third-party account, fully owned, readable
// in the Supabase dashboard. Never interferes with the app.
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

let installed = false;

async function report(error: unknown, fatal: boolean): Promise<void> {
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const { data } = await supabase.auth.getUser();
    await supabase.from('client_errors').insert({
      user_id: data.user?.id ?? null,
      message: err.message.slice(0, 1000),
      stack: (err.stack ?? '').slice(0, 8000),
      fatal,
      platform: Platform.OS,
      app_version: '1.0.0',
    });
  } catch {
    // Reporting must never cause its own crash.
  }
}

/** Call once at app start. */
export function installCrashReporting(): void {
  if (installed || Platform.OS === 'web') return;
  installed = true;

  const utils = (globalThis as { ErrorUtils?: {
    getGlobalHandler: () => (error: unknown, isFatal?: boolean) => void;
    setGlobalHandler: (handler: (error: unknown, isFatal?: boolean) => void) => void;
  } }).ErrorUtils;
  if (!utils) return;

  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    report(error, !!isFatal);
    previous(error, isFatal);
  });
}

/** For catch blocks that want the error on record without crashing. */
export function logError(error: unknown): void {
  report(error, false);
}
