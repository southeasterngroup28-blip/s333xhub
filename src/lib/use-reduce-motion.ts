import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// The last value we saw, shared across mounts so a component appearing
// mid-session starts from the known setting instead of flashing motion.
let current = false;

/**
 * The OS Reduce Motion switch, live. Reanimated's useReducedMotion is a
 * launch-time constant — flipping the setting mid-session changes nothing
 * until the app restarts — so this wraps AccessibilityInfo with the change
 * listener and re-renders when the fan flips the switch.
 */
export function useReduceMotion(): boolean {
  const [enabled, setEnabled] = useState(current);

  useEffect(() => {
    let mounted = true;
    const apply = (value: boolean) => {
      current = value;
      if (mounted) setEnabled(value);
    };
    AccessibilityInfo.isReduceMotionEnabled().then(apply).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', apply);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return enabled;
}
