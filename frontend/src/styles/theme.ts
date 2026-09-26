import { StyleSheet, Platform } from 'react-native';

export const COLORS = {

  background: '#F6F8FD',
  backgroundDark: '#0F0C20',
  surface: '#FFFFFF',
  surfaceDark: '#1A162B',
  surfaceLight: '#F0F2FA',
  border: '#EAEFF8',
  borderDark: 'rgba(255, 255, 255, 0.1)',

  purpleHeroStart: '#6C5CE7',
  purpleHeroMid: '#8B5CF6',
  purpleHeroEnd: '#9333EA',
  purpleGradient: ['#6C5CE7', '#8B5CF6', '#9333EA'] as const,
  purpleSubtle: '#F0EDFF',

  text: '#1E1B4B',
  textLight: '#FFFFFF',
  textSecondary: '#64748B',
  textMuted: '#94A3B8',

  cardPeach: 'rgba(255, 243, 238, 0.78)',
  cardPeachBorder: 'rgba(255, 255, 255, 0.9)',
  cardPeachAccent: '#FF6B4A',
  cardPeachText: '#C0392B',

  cardLilac: 'rgba(246, 240, 255, 0.78)',
  cardLilacBorder: 'rgba(255, 255, 255, 0.9)',
  cardLilacAccent: '#8B5CF6',
  cardLilacText: '#6D28D9',

  cardMint: 'rgba(235, 251, 250, 0.78)',
  cardMintBorder: 'rgba(255, 255, 255, 0.9)',
  cardMintAccent: '#14B8A6',
  cardMintText: '#0F766E',

  cardAmber: 'rgba(255, 251, 235, 0.78)',
  cardAmberBorder: 'rgba(255, 255, 255, 0.9)',
  cardAmberAccent: '#F59E0B',
  cardAmberText: '#B45309',

  success: '#10B981',
  warning: '#F59E0B',
  danger: '#EF4444',
  info: '#3B82F6',

  primary: '#6C5CE7',
  primaryLight: '#A78BFA',
  primaryBg: 'rgba(108, 92, 231, 0.1)',

  successBg: 'rgba(16, 185, 129, 0.12)',
  warningBg: 'rgba(245, 158, 11, 0.12)',
  dangerBg: 'rgba(239, 68, 68, 0.12)',
  infoBg: 'rgba(59, 130, 246, 0.12)',
};

export const TYPOGRAPHY = {
  fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif-medium',
  sizes: {
    xs: 11,
    sm: 13,
    base: 15,
    lg: 17,
    xl: 20,
    xxl: 24,
    giant: 36,
    hero: 42,
  },
  weights: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
    heavy: '800' as const,
    black: '900' as const,
  }
};

export const GLOBAL_STYLES = StyleSheet.create({
  heroCard: {
    borderRadius: 32,
    padding: 24,
    overflow: 'hidden',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    padding: 18,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 4,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}),
  },
  glassCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.76)',
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.9)',
    padding: 18,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 6,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)' } : {}),
  },
  glassCardLight: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 16,
    padding: 14,
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
    paddingHorizontal: 12,
    paddingVertical: 5,
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
