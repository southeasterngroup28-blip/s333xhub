// Tiny wrappers so call sites stay one-liners and web never crashes.
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const canBuzz = Platform.OS !== 'web';

/** Soft tick — reactions, toggles, small selections. */
export function tapFeedback() {
  if (canBuzz) Haptics.selectionAsync().catch(() => {});
}

/** Medium thump — play/pause, sending things. */
export function pressFeedback() {
  if (canBuzz) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** Success buzz — unlocks, purchases, completed actions. */
export function successFeedback() {
  if (canBuzz) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
