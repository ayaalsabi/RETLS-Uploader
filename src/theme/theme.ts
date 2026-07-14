/**
 * theme.ts
 * --------
 * Single source of truth for colors/spacing so every screen looks
 * consistent. This is a DESIGN-ONLY project: no state management,
 * no network calls, no persistence. All data shown is hardcoded in
 * src/data/dummyData.ts purely so the screens have something to render.
 */
export const colors = {
  bg: '#FFFFFF',
  surface: '#F7F7F5',
  border: '#E5E4DF',
  borderStrong: '#C9C7BE',

  textPrimary: '#1C1C1A',
  textSecondary: '#6B6A64',
  textMuted: '#9B9A93',

  accentBg: '#E6F1FB',
  accentText: '#185FA5',

  successBg: '#EAF3DE',
  successText: '#3B6D11',

  warningBg: '#FAEEDA',
  warningText: '#854F0B',

  primaryFill: '#1C1C1A',
  onPrimary: '#FFFFFF',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 8,
  md: 10,
  lg: 12,
  pill: 20,
};

export const typography = {
  title: { fontSize: 20, fontWeight: '600' as const },
  subtitle: { fontSize: 15, fontWeight: '500' as const },
  body: { fontSize: 14, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
  label: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.4,
    textTransform: 'uppercase' as const,
  },
};
