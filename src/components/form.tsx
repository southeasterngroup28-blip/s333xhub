import { forwardRef, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { capLabel, pillText } from '@/constants/type';

// The artist's forms (new show, new drop, edit draft) share these parts,
// so a field label or a chip can never drift between them.

/** Uppercase caption over a field: VENUE, PRICE ($), COUNTDOWN ENDS. */
export function FieldLabel({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.label, style]}>{children}</Text>;
}

/** The sunken text field. Placeholder colour is set here, once. */
export const Field = forwardRef<TextInput, TextInputProps>(function Field(
  { style, ...rest },
  ref
) {
  return (
    <TextInput
      ref={ref}
      style={[styles.input, style]}
      placeholderTextColor="#55585f"
      {...rest}
    />
  );
});

type ChipProps = {
  label: string;
  on: boolean;
  onPress: () => void;
  /** A segmented control's cell: fills its share of the row, white when on. */
  segmented?: boolean;
  disabled?: boolean;
};

/** One option chip. Options light ghost silver; segmented cells light white. */
export function Chip({ label, on, onPress, segmented = false, disabled }: ChipProps) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.chip,
        segmented && styles.chipSegmented,
        on && (segmented ? styles.chipOnSegmented : styles.chipOn),
        pressed && styles.pressed,
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

/** A wrapping row of option chips, or one straight row of segmented cells. */
export function ChipRow({
  children,
  segmented = false,
  style,
}: {
  children: ReactNode;
  segmented?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[segmented ? styles.rowSegmented : styles.rowOptions, style]}>{children}</View>
  );
}

type ButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  /** Replaces the label with a spinner while the server works. */
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** The form's one white pill. */
export function PrimaryButton({ label, onPress, disabled, busy, style }: ButtonProps) {
  return (
    <Pressable
      style={[styles.primary, (disabled || busy) && styles.primaryDisabled, style]}
      disabled={disabled || busy}
      onPress={onPress}
      accessibilityRole="button">
      {busy ? <ActivityIndicator color="#0b0c0e" /> : <Text style={styles.primaryText}>{label}</Text>}
    </Pressable>
  );
}

/** A quiet line under a field or a button. */
export function FormNote({
  children,
  center = false,
  style,
}: {
  children: ReactNode;
  center?: boolean;
  style?: StyleProp<TextStyle>;
}) {
  return <Text style={[styles.note, center && styles.noteCenter, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  label: { ...capLabel, marginBottom: 7, marginTop: 6 },
  input: {
    backgroundColor: '#131519',
    color: '#fff',
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    marginBottom: 12,
  },
  rowOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 12 },
  rowSegmented: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#1a1d22',
  },
  chipSegmented: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  chipOn: { backgroundColor: '#c3cdd6' },
  chipOnSegmented: { backgroundColor: '#ffffff' },
  chipText: { color: '#8f99a3', fontWeight: '700', fontSize: 10.5, letterSpacing: 1 },
  chipTextOn: { color: '#0b0c0e' },
  pressed: { opacity: 0.6 },
  primary: {
    backgroundColor: '#ffffff',
    borderRadius: 999,
    padding: 15,
    alignItems: 'center',
    marginTop: 18,
  },
  primaryDisabled: { opacity: 0.4 },
  primaryText: pillText,
  note: { color: '#55585f', fontSize: 12, lineHeight: 16, marginBottom: 8 },
  noteCenter: { textAlign: 'center', marginTop: 10, marginBottom: 0 },
});
