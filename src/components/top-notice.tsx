import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CHAT_COMPOSER } from '@/constants/chat-surfaces';

type Props = {
  tone: 'error' | 'ok';
  text: string;
  /** Present: an X dismisses it. Absent: it stays until the screen clears it. */
  onDismiss?: () => void;
  /**
   * Floating over a list: the absolute top (add the safe-area inset and
   * ROOT_NOTICE_TOP). Omitted: the pill sits in normal flow under a
   * PushedHeader.
   */
  absoluteTop?: number;
};

/**
 * The one line a screen says under its header: a bordered pill on the
 * translucent chat surface, red-edged when something failed. Same shape
 * for a calm notice, so "ok" reads the same on every root.
 */
export function TopNotice({ tone, text, onDismiss, absoluteTop }: Props) {
  return (
    <View
      style={[
        styles.pill,
        tone === 'error' && styles.pillError,
        absoluteTop === undefined ? styles.inFlow : [styles.floating, { top: absoluteTop }],
      ]}>
      <Text style={[styles.text, tone === 'error' && styles.textError]} numberOfLines={3}>
        {text}
      </Text>
      {onDismiss ? (
        <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel="Dismiss">
          <Ionicons name="close" size={16} color="#8a8a92" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: CHAT_COMPOSER,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  pillError: { borderColor: 'rgba(248,113,113,0.45)' },
  inFlow: { marginHorizontal: 16, marginBottom: 8 },
  floating: { position: 'absolute', left: 16, right: 16, zIndex: 26 },
  text: { color: '#e6e8ea', flex: 1, fontSize: 13, lineHeight: 18 },
  textError: { color: '#f87171' },
});
