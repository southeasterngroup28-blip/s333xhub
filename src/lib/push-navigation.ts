// Tapping a push should land you ON the thing — the post, the chat,
// the drop — not just open the app.
import { Platform } from 'react-native';

type Router = { push: (url: never) => void };

/** Screens a push is allowed to deep-open. */
const ALLOWED = [/^\/post\/[\w-]+$/, /^\/channel\/[\w-]+$/, /^\/drop\/[\w-]+$/];

function openFromData(router: Router, data: unknown): void {
  const url = (data as { url?: string } | null)?.url;
  if (typeof url !== 'string') return;
  if (!ALLOWED.some((pattern) => pattern.test(url))) return;
  // Small delay so navigation containers are mounted on cold start.
  setTimeout(() => {
    try {
      router.push(url as never);
    } catch {}
  }, 350);
}

/**
 * Wire up notification taps. Returns an unsubscribe. Also handles the
 * cold-start case (app launched BY the tap).
 */
export async function installPushNavigation(router: Router): Promise<() => void> {
  if (Platform.OS === 'web') return () => {};
  try {
    const Notifications = await import('expo-notifications');

    // Foreground pushes still show as banners instead of vanishing.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });

    const cold = await Notifications.getLastNotificationResponseAsync();
    if (cold) openFromData(router, cold.notification.request.content.data);

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      openFromData(router, response.notification.request.content.data);
    });
    return () => sub.remove();
  } catch {
    return () => {};
  }
}
