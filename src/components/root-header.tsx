import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DISPLAY_FONT } from '@/constants/type';

// The letterhead: every tab root's title, left-aligned in 28px Anton and
// ruled off beneath, floating over the list. Chat drew it first; the
// others inherit it here so the five roots stop drifting apart.

const PAD_TOP = 4;
const LINE = 34;
const RULE_GAP = 8;
const RULE = 1;
const PAD_BOTTOM = 10;

/** The block's height below the safe-area inset. */
export const ROOT_HEADER_HEIGHT = PAD_TOP + LINE + RULE_GAP + RULE + PAD_BOTTOM;
/** Where a root's list content starts, so the first row clears the rule. */
export const ROOT_LIST_TOP = ROOT_HEADER_HEIGHT + 8;
/** The FadeMask's top run for a root list: rows dissolve into the letterhead. */
export const ROOT_FADE_TOP = ROOT_HEADER_HEIGHT + 20;
/** Where a TopNotice sits under the letterhead (add the safe-area inset). */
export const ROOT_NOTICE_TOP = ROOT_HEADER_HEIGHT + 6;

type Props = {
  title: string;
  /** Controls at the rule's right end: the add button, the scan pill, settings. */
  actions?: ReactNode;
};

export function RootHeader({ title, actions }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { top: insets.top }]} pointerEvents="box-none">
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.rule} />
      {actions ? (
        <View style={styles.actions} pointerEvents="box-none">
          {actions}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 20,
    paddingHorizontal: 16,
    paddingTop: PAD_TOP,
    paddingBottom: PAD_BOTTOM,
  },
  title: {
    color: '#f4f5f6',
    fontSize: 28,
    lineHeight: LINE,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 2,
    // Leave the title's own line clear of the actions cluster.
    paddingRight: 120,
  },
  rule: { height: RULE, backgroundColor: 'rgba(255,255,255,0.14)', marginTop: RULE_GAP },
  actions: {
    position: 'absolute',
    right: 16,
    top: PAD_TOP,
    height: LINE,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
});
