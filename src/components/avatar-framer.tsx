import { Image } from 'expo-image';
import { useRef, useState } from 'react';

import { DISPLAY_FONT } from '@/constants/type';
import {
  Modal,
  PanResponder,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

/**
 * Circle-crop framing for profile photos — same mechanics as the cover
 * framer: the whole image shows, a bright circle window sits over it,
 * dragging slides it along the photo's longer side. Only cheap dim
 * strips move during the drag, so it stays smooth.
 */
function FramerStage({
  uri,
  onFocusChange,
}: {
  uri: string;
  onFocusChange: (focus: number) => void;
}) {
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [offset, setOffset] = useState<number | null>(null);
  const offsetRef = useRef(0);
  const dragStart = useRef(0);
  const maxRef = useRef(0);
  const verticalRef = useRef(true);

  const displayHeight = layoutWidth && natural ? layoutWidth * (natural.h / natural.w) : 0;
  // The circle's diameter = the photo's shorter displayed side.
  const vertical = displayHeight >= layoutWidth;
  const diameter = vertical ? layoutWidth : displayHeight;
  const maxOffset = Math.max(0, vertical ? displayHeight - diameter : layoutWidth - diameter);
  maxRef.current = maxOffset;
  verticalRef.current = vertical;

  if (offset === null && layoutWidth > 0 && natural) {
    offsetRef.current = maxOffset / 2;
    // eslint-disable-next-line react-hooks/rules-of-hooks -- simple init, not a hook
    setOffset(maxOffset / 2);
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(verticalRef.current ? g.dy : g.dx) > 2,
      onPanResponderGrant: () => {
        dragStart.current = offsetRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const delta = verticalRef.current ? g.dy : g.dx;
        const next = Math.min(maxRef.current, Math.max(0, dragStart.current + delta));
        offsetRef.current = next;
        setOffset(next);
      },
      onPanResponderRelease: () => {
        onFocusChange(maxRef.current > 0 ? offsetRef.current / maxRef.current : 0.5);
      },
      onPanResponderTerminate: () => {
        onFocusChange(maxRef.current > 0 ? offsetRef.current / maxRef.current : 0.5);
      },
    })
  ).current;

  const o = offset ?? 0;
  const circleTop = vertical ? o : 0;
  const circleLeft = vertical ? 0 : o;

  return (
    <View>
      <View
        style={styles.stage}
        onLayout={(e) => setLayoutWidth(e.nativeEvent.layout.width)}
        {...pan.panHandlers}>
        {layoutWidth > 0 ? (
          <Image
            source={{ uri }}
            style={{ width: layoutWidth, height: displayHeight || layoutWidth }}
            contentFit="cover"
            onLoad={(e) => {
              if (!natural && e.source?.width && e.source?.height) {
                setNatural({ w: e.source.width, h: e.source.height });
              }
            }}
          />
        ) : null}
        {displayHeight > 0 && diameter > 0 ? (
          vertical ? (
            <>
              <View style={[styles.dim, { top: 0, left: 0, right: 0, height: circleTop }]} />
              <View
                style={[
                  styles.dim,
                  {
                    top: circleTop + diameter,
                    left: 0,
                    right: 0,
                    height: Math.max(0, displayHeight - circleTop - diameter),
                  },
                ]}
              />
            </>
          ) : (
            <>
              <View style={[styles.dim, { top: 0, bottom: 0, left: 0, width: circleLeft }]} />
              <View
                style={[
                  styles.dim,
                  {
                    top: 0,
                    bottom: 0,
                    left: circleLeft + diameter,
                    width: Math.max(0, layoutWidth - circleLeft - diameter),
                  },
                ]}
              />
            </>
          )
        ) : null}
        {diameter > 0 ? (
          <View
            pointerEvents="none"
            style={[
              styles.circle,
              {
                top: circleTop,
                left: circleLeft,
                width: diameter,
                height: diameter,
                borderRadius: diameter / 2,
              },
            ]}
          />
        ) : null}
      </View>
      <Text style={styles.hint}>
        {maxOffset > 0
          ? 'Drag the circle — what’s inside it is your profile photo'
          : 'This photo fits the circle exactly'}
      </Text>
    </View>
  );
}

type Props = {
  visible: boolean;
  /** Preview URI of the picked photo. */
  uri: string | null;
  onCancel: () => void;
  onSave: (focus: number) => void;
};

export function AvatarFramer({ visible, uri, onCancel, onSave }: Props) {
  const focusRef = useRef(0.5);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Pressable onPress={onCancel} hitSlop={12}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
          <Text style={styles.title}>PROFILE PHOTO</Text>
          <Pressable onPress={() => onSave(focusRef.current)} hitSlop={12}>
            <Text style={styles.save}>Save</Text>
          </Pressable>
        </View>
        <View style={styles.body}>
          {uri ? (
            <FramerStage
              // Remount (and reset focus) whenever a different photo comes in.
              key={uri}
              uri={uri}
              onFocusChange={(f) => {
                focusRef.current = f;
              }}
            />
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0b0c0e' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  title: { color: '#fff', fontSize: 15, fontFamily: DISPLAY_FONT, letterSpacing: 2 },
  cancel: { color: '#8f99a3', fontSize: 15 },
  save: { color: '#fff', fontSize: 15, fontWeight: '700' },
  body: { flex: 1, justifyContent: 'center', paddingHorizontal: 14 },
  stage: { borderRadius: 10, overflow: 'hidden', backgroundColor: '#0f1114' },
  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(6, 7, 9, 0.72)',
  },
  circle: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  hint: { color: '#6d7076', fontSize: 12.5, marginTop: 10, textAlign: 'center' },
});
