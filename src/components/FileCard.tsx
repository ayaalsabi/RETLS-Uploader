import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, radius, typography } from '../theme/theme';
import { DesignFile } from '../data/dummyData';

interface Props {
  file: DesignFile;
  onPress?: () => void;
}

export default function FileCard({ file, onPress }: Props) {
  const iconName = file.kind === 'pdf' ? 'file-text' : 'image';

  const badge =
    file.status === 'received' ? (
      <View style={[styles.badge, { backgroundColor: colors.successBg }]}>
        <Text style={[styles.badgeText, { color: colors.successText }]}>
          Received
        </Text>
      </View>
    ) : (
      <View style={[styles.badge, { backgroundColor: colors.warningBg }]}>
        <Text style={[styles.badgeText, { color: colors.warningText }]}>
          {file.commentCount} comments
        </Text>
      </View>
    );

  const Wrapper = onPress ? TouchableOpacity : View;

  return (
    <Wrapper style={styles.card} onPress={onPress} activeOpacity={0.7}>
      <Feather
        name={iconName}
        size={20}
        color={colors.textSecondary}
        style={{ marginTop: 2 }}
      />
      <View style={{ flex: 1 }}>
        <Text style={typography.subtitle}>{file.name}</Text>
        <Text style={[typography.caption, { color: colors.textMuted, marginTop: 2 }]}>
          {file.sentAt}
        </Text>
      </View>
      {onPress ? (
        <Feather name="chevron-right" size={16} color={colors.textMuted} />
      ) : (
        badge
      )}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.bg,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
});
