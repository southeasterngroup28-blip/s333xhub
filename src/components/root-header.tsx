import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { DISPLAY_FONT } from '@/constants/type';

// Every tab root's title: centered Anton floating over the list, with the
// screen's actions at the right edge. One component so the roots never
// drift apart.

const PAD_TOP = 4;
const LINE = 30;
const PAD_BOTTOM = 10;

/** The block's height below the safe-area inset. */
export const ROOT_HEADER_HEIGHT = PAD_TOP + LINE + PAD_BOTTOM;
/** Where a root's list content starts, just under the letterhead. */
export const ROOT_LIST_TOP = ROOT_HEADER_HEIGHT + 8;
/** The FadeMask's top run for a root list: rows dissolve into the letterhead. */
export const ROOT_FADE_TOP = ROOT_HEADER_HEIGHT + 20;
/** Where a TopNotice sits under the letterhead (add the safe-area inset). */
export const ROOT_NOTICE_TOP = ROOT_HEADER_HEIGHT + 6;

type Props = {
  title: string;
  /** Controls at the title's right end: the add button, the scan pill, settings. */
  actions?: ReactNode;
};

export function RootHeader({ title, actions }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { top: insets.top }]} pointerEvents="box-none">
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
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
    fontSize: 22,
    lineHeight: LINE,
    fontFamily: DISPLAY_FONT,
    letterSpacing: 2,
    textAlign: 'center',
    // Symmetric padding keeps the title centered on the screen, clear of
    // the actions cluster at the right.
    paddingHorizontal: 96,
  },
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
