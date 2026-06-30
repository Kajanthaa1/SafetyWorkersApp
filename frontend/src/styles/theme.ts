import { StyleSheet } from 'react-native';

export const COLORS = {
  background: '#0B0F19',
  surface: '#151E33',
  surfaceLight: '#1F2C4C',
  border: 'rgba(255, 255, 255, 0.08)',
  text: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  
  // Status Colors
  success: '#10B981',       // Green for OK
  warning: '#F59E0B',       // Amber for low battery, warnings, idle
  danger: '#EF4444',        // Red for falls, manual SOS
  info: '#3B82F6',          // Blue for general info
  
  // Accents
  primary: '#4F46E5',       // Indigo primary accent
  primaryLight: '#818CF8',
  
  // Shorthands for transparent variants
  successBg: 'rgba(16, 185, 129, 0.12)',
  warningBg: 'rgba(245, 158, 11, 0.12)',
  dangerBg: 'rgba(239, 68, 68, 0.12)',
  infoBg: 'rgba(59, 130, 246, 0.12)',
  primaryBg: 'rgba(79, 70, 229, 0.12)',
};

export const TYPOGRAPHY = {
  fontFamily: 'System',
  sizes: {
    xs: 11,
    sm: 13,
    base: 15,
    lg: 17,
    xl: 20,
    xxl: 24,
    giant: 36,
  },
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    black: '900' as const,
  }
};

export const GLOBAL_STYLES = StyleSheet.create({
  glassCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  glassCardLight: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 12,
    padding: 12,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  headerText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  bodyText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.regular,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 99,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
  },
  badgeText: {
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: TYPOGRAPHY.weights.semibold,
    marginLeft: 4,
  }
});
