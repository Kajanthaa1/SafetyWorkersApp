import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { COLORS, GLOBAL_STYLES, TYPOGRAPHY } from '../styles/theme';
import { api } from '../services/api';
import Icon from '../components/Icon';

interface LoginScreenProps {
  onLoginSuccess: (user: any) => void;
}

type Mode = 'signin' | 'signup';

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [mode, setMode] = useState<Mode>('signin');

  // Sign In state
  const [siUsername, setSiUsername] = useState('');
  const [siPassword, setSiPassword] = useState('');
  const [siLoading, setSiLoading] = useState(false);
  const [siError, setSiError] = useState<string | null>(null);
  const [siShowPass, setSiShowPass] = useState(false);
  const [siFocusedInput, setSiFocusedInput] = useState<string | null>(null);

  // Sign Up state
  const [suName, setSuName] = useState('');
  const [suUsername, setSuUsername] = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [suConfirm, setSuConfirm] = useState('');
  const [suLoading, setSuLoading] = useState(false);
  const [suError, setSuError] = useState<string | null>(null);
  const [suShowPass, setSuShowPass] = useState(false);
  const [suSuccess, setSuSuccess] = useState(false);
  const [suRole, setSuRole] = useState<'worker' | 'admin'>('worker');
  const [suFocusedInput, setSuFocusedInput] = useState<string | null>(null);

  // ── Sign In ──────────────────────────────────────────────────────────────────
  const handleSignIn = async () => {
    if (!siUsername.trim()) { setSiError('Username is required'); return; }
    if (!siPassword.trim()) { setSiError('Password is required'); return; }

    setSiLoading(true);
    setSiError(null);
    try {
      const user = await api.login(siUsername.trim(), siPassword, 0, 0);
      onLoginSuccess(user);
    } catch (err: any) {
      setSiError(err.message || 'Login failed. Check your credentials.');
    } finally {
      setSiLoading(false);
    }
  };

  // ── Sign Up ──────────────────────────────────────────────────────────────────
  const handleSignUp = async () => {
    setSuError(null);
    if (!suName.trim()) { setSuError('Full name is required'); return; }
    if (!suUsername.trim()) { setSuError('Username is required'); return; }
    if (suPassword.length < 4) { setSuError('Password must be at least 4 characters'); return; }
    if (suPassword !== suConfirm) { setSuError('Passwords do not match'); return; }

    setSuLoading(true);
    try {
      await api.signup(suName.trim(), suUsername.trim(), suPassword, suRole);
      setSuSuccess(true);
      // Auto sign-in after successful signup
      const user = await api.login(suUsername.trim(), suPassword, 0, 0);
      onLoginSuccess(user);
    } catch (err: any) {
      setSuError(err.message || 'Signup failed. Please try again.');
    } finally {
      setSuLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardView}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Background Ambient Blur Orbs */}
        <View style={styles.ambientOrb1} />
        <View style={styles.ambientOrb2} />

        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.logoOuterRing}>
            <View style={styles.logoContainer}>
              <Icon name="shield-check" size={48} color={COLORS.primary} />
            </View>
          </View>
          <Text style={styles.title}>SafetyWorker</Text>
          <View style={styles.subtitleBadge}>
            <Icon name="pulse" size={12} color={COLORS.primary} style={{ marginRight: 5 }} />
            <Text style={styles.subtitle}>Unified Safety & Vitals Monitor</Text>
          </View>
        </View>

        {/* ── Mode Tabs ── */}
        <View style={styles.tabRow}>
          <TouchableOpacity
            id="signin-tab"
            style={[styles.tab, mode === 'signin' && styles.tabActive]}
            onPress={() => { setMode('signin'); setSiError(null); }}
            activeOpacity={0.8}
          >
            <Icon
              name="login"
              size={17}
              color={mode === 'signin' ? '#FFFFFF' : COLORS.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.tabText, mode === 'signin' && styles.tabTextActive]}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity
            id="signup-tab"
            style={[styles.tab, mode === 'signup' && styles.tabActive]}
            onPress={() => { setMode('signup'); setSuError(null); }}
            activeOpacity={0.8}
          >
            <Icon
              name="account-plus"
              size={17}
              color={mode === 'signup' ? '#FFFFFF' : COLORS.textSecondary}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>Sign Up</Text>
          </TouchableOpacity>
        </View>

        {/* ── Sign In Form ── */}
        {mode === 'signin' && (
          <View style={[GLOBAL_STYLES.glassCard, styles.formCard]}>
            <View style={styles.cardHeader}>
              <Text style={styles.formTitle}>Welcome Back</Text>
            </View>

            <View style={[
              styles.inputContainer,
              siFocusedInput === 'username' && styles.inputContainerFocused
            ]}>
              <View style={styles.inputIconWrapper}>
                <Icon
                  name="account"
                  size={19}
                  color={siFocusedInput === 'username' ? COLORS.primary : COLORS.textSecondary}
                />
              </View>
              <TextInput
                id="signin-username"
                style={styles.input}
                placeholder="Username"
                placeholderTextColor={COLORS.textMuted}
                value={siUsername}
                onChangeText={setSiUsername}
                onFocus={() => setSiFocusedInput('username')}
                onBlur={() => setSiFocusedInput(null)}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <View style={[
              styles.inputContainer,
              siFocusedInput === 'password' && styles.inputContainerFocused
            ]}>
              <View style={styles.inputIconWrapper}>
                <Icon
                  name="lock"
                  size={19}
                  color={siFocusedInput === 'password' ? COLORS.primary : COLORS.textSecondary}
                />
              </View>
              <TextInput
                id="signin-password"
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={COLORS.textMuted}
                value={siPassword}
                onChangeText={setSiPassword}
                onFocus={() => setSiFocusedInput('password')}
                onBlur={() => setSiFocusedInput(null)}
                secureTextEntry={!siShowPass}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={handleSignIn}
              />
              <TouchableOpacity onPress={() => setSiShowPass(!siShowPass)} style={styles.eyeIcon}>
                <Icon name={siShowPass ? 'eye-off' : 'eye'} size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            {siError && (
              <View style={styles.errorRow}>
                <Icon name="alert-circle" size={15} color={COLORS.danger} style={{ marginRight: 6 }} />
                <Text style={styles.errorText}>{siError}</Text>
              </View>
            )}

            <TouchableOpacity
              id="signin-btn"
              style={[styles.button, siLoading && styles.buttonDisabled]}
              onPress={handleSignIn}
              disabled={siLoading}
              activeOpacity={0.85}
            >
              {siLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Icon name="login" size={19} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.buttonText}>Sign In</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setMode('signup')} style={styles.switchModeRow} activeOpacity={0.7}>
              <Text style={styles.switchModeText}>New worker? </Text>
              <Text style={styles.switchModeLink}>Create an account →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Sign Up Form ── */}
        {mode === 'signup' && (
          <View style={[GLOBAL_STYLES.glassCard, styles.formCard]}>
            <View style={styles.cardHeader}>
              <Text style={styles.formTitle}>Create Account</Text>
            </View>

            <View style={[
              styles.inputContainer,
              suFocusedInput === 'name' && styles.inputContainerFocused
            ]}>
              <View style={styles.inputIconWrapper}>
                <Icon
                  name="account-circle"
                  size={19}
                  color={suFocusedInput === 'name' ? COLORS.primary : COLORS.textSecondary}
                />
              </View>
              <TextInput
                id="signup-name"
                style={styles.input}
                placeholder="Full Name (e.g. John Doe)"
                placeholderTextColor={COLORS.textMuted}
                value={suName}
                onChangeText={setSuName}
                onFocus={() => setSuFocusedInput('name')}
                onBlur={() => setSuFocusedInput(null)}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <View style={[
              styles.inputContainer,
              suFocusedInput === 'username' && styles.inputContainerFocused
            ]}>
              <View style={styles.inputIconWrapper}>
                <Icon
                  name="account"
                  size={19}
                  color={suFocusedInput === 'username' ? COLORS.primary : COLORS.textSecondary}
                />
              </View>
              <TextInput
                id="signup-username"
                style={styles.input}
                placeholder="Username (e.g. john_doe)"
                placeholderTextColor={COLORS.textMuted}
                value={suUsername}
                onChangeText={setSuUsername}
                onFocus={() => setSuFocusedInput('username')}
                onBlur={() => setSuFocusedInput(null)}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <View style={[
              styles.inputContainer,
              suFocusedInput === 'password' && styles.inputContainerFocused
            ]}>
              <View style={styles.inputIconWrapper}>
                <Icon
                  name="lock"
                  size={19}
                  color={suFocusedInput === 'password' ? COLORS.primary : COLORS.textSecondary}
                />
              </View>
              <TextInput
                id="signup-password"
                style={styles.input}
                placeholder="Password (min. 4 characters)"
                placeholderTextColor={COLORS.textMuted}
                value={suPassword}
                onChangeText={setSuPassword}
                onFocus={() => setSuFocusedInput('password')}
                onBlur={() => setSuFocusedInput(null)}
                secureTextEntry={!suShowPass}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
              <TouchableOpacity onPress={() => setSuShowPass(!suShowPass)} style={styles.eyeIcon}>
                <Icon name={suShowPass ? 'eye-off' : 'eye'} size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={[
              styles.inputContainer,
              suFocusedInput === 'confirm' && styles.inputContainerFocused
            ]}>
              <View style={styles.inputIconWrapper}>
                <Icon
                  name="lock-check"
                  size={19}
                  color={suFocusedInput === 'confirm' ? COLORS.primary : COLORS.textSecondary}
                />
              </View>
              <TextInput
                id="signup-confirm"
                style={styles.input}
                placeholder="Confirm Password"
                placeholderTextColor={COLORS.textMuted}
                value={suConfirm}
                onChangeText={setSuConfirm}
                onFocus={() => setSuFocusedInput('confirm')}
                onBlur={() => setSuFocusedInput(null)}
                secureTextEntry={!suShowPass}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
            </View>

            {/* Role Picker Card */}
            <View style={styles.rolePickerContainer}>
              <Text style={styles.rolePickerLabel}>Select Account Role</Text>
              <View style={styles.roleButtonsRow}>
                <TouchableOpacity
                  style={[styles.roleCard, suRole === 'worker' && styles.roleCardActive]}
                  onPress={() => setSuRole('worker')}
                  activeOpacity={0.8}
                >
                  <View style={[styles.roleIconCircle, suRole === 'worker' && styles.roleIconCircleActive]}>
                    <Icon name="hard-hat" size={20} color={suRole === 'worker' ? '#FFFFFF' : COLORS.textSecondary} />
                  </View>
                  <View style={styles.roleTextContainer}>
                    <Text style={[styles.roleCardTitle, suRole === 'worker' && styles.roleCardTitleActive]}>Worker</Text>
                    <Text style={styles.roleCardSub}>Vitals & Safety Band</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.roleCard, suRole === 'admin' && styles.roleCardActive]}
                  onPress={() => setSuRole('admin')}
                  activeOpacity={0.8}
                >
                  <View style={[styles.roleIconCircle, suRole === 'admin' && styles.roleIconCircleActive]}>
                    <Icon name="shield-account" size={20} color={suRole === 'admin' ? '#FFFFFF' : COLORS.textSecondary} />
                  </View>
                  <View style={styles.roleTextContainer}>
                    <Text style={[styles.roleCardTitle, suRole === 'admin' && styles.roleCardTitleActive]}>Admin</Text>
                    <Text style={styles.roleCardSub}>Supervisor Dashboard</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Password strength indicator */}
            {suPassword.length > 0 && (
              <View style={styles.strengthContainer}>
                <View style={styles.strengthRow}>
                  {[1, 2, 3, 4].map(i => (
                    <View
                      key={i}
                      style={[
                        styles.strengthBar,
                        {
                          backgroundColor:
                            suPassword.length >= i * 3
                              ? i <= 1 ? COLORS.danger
                              : i <= 2 ? COLORS.warning
                              : i <= 3 ? COLORS.info
                              : COLORS.success
                              : COLORS.border,
                        },
                      ]}
                    />
                  ))}
                </View>
                <Text style={styles.strengthLabel}>
                  {suPassword.length < 4 ? 'Weak' : suPassword.length < 8 ? 'Fair' : suPassword.length < 12 ? 'Good' : 'Strong'}
                </Text>
              </View>
            )}

            {suError && (
              <View style={styles.errorRow}>
                <Icon name="alert-circle" size={15} color={COLORS.danger} style={{ marginRight: 6 }} />
                <Text style={styles.errorText}>{suError}</Text>
              </View>
            )}

            <TouchableOpacity
              id="signup-btn"
              style={[styles.button, styles.buttonSignup, suLoading && styles.buttonDisabled]}
              onPress={handleSignUp}
              disabled={suLoading}
              activeOpacity={0.85}
            >
              {suLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <>
                  <Icon name="account-plus" size={19} color="#FFFFFF" style={{ marginRight: 8 }} />
                  <Text style={styles.buttonText}>Create Account & Sign In</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setMode('signin')} style={styles.switchModeRow} activeOpacity={0.7}>
              <Text style={styles.switchModeText}>Already registered? </Text>
              <Text style={styles.switchModeLink}>Sign in here →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Role Info Banner ── */}
        <View style={styles.infoBanner}>
          <View style={styles.infoBannerIcon}>
            <Icon name="shield-lock" size={16} color={COLORS.primary} />
          </View>
          <Text style={styles.infoText}>
            Registered accounts have continuous encrypted telemetry sync enabled. Worker monitoring data is protected and secured.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
    backgroundColor: '#F6F8FD',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    paddingBottom: 40,
    maxWidth: 480,
    width: '100%',
    alignSelf: 'center',
  },
  ambientOrb1: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(108, 92, 231, 0.08)',
  },
  ambientOrb2: {
    position: 'absolute',
    bottom: 20,
    left: -50,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(16, 185, 129, 0.06)',
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  logoOuterRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(108, 92, 231, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(108, 92, 231, 0.18)',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  logoContainer: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  title: {
    color: '#1E1B4B',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
  subtitleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(108, 92, 231, 0.08)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 8,
    borderWidth: 1,
    borderColor: 'rgba(108, 92, 231, 0.15)',
  },
  subtitle: {
    color: '#6C5CE7',
    fontSize: 12,
    fontWeight: '700',
  },
  // Mode Tabs (Frosted Glass Container)
  tabRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(234, 239, 248, 0.65)',
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.85)',
    padding: 5,
    marginBottom: 20,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}),
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 13,
  },
  tabActive: {
    backgroundColor: '#6C5CE7',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },
  tabText: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  // Form card
  formCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 24,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#EAEFF8',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 6,
  },
  cardHeader: {
    alignItems: 'center',
    marginBottom: 18,
  },
  formTitle: {
    color: '#1E1B4B',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  formSubtitle: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  // Inputs
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 247, 252, 0.68)',
    borderWidth: 1.5,
    borderColor: 'rgba(226, 232, 240, 0.85)',
    borderRadius: 14,
    paddingHorizontal: 14,
    marginBottom: 14,
    height: 52,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' } : {}),
  },
  inputContainerFocused: {
    borderColor: '#6C5CE7',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 10,
    elevation: 4,
  },
  inputIconWrapper: {
    width: 28,
    alignItems: 'center',
    marginRight: 6,
  },
  input: {
    flex: 1,
    color: '#1E1B4B',
    fontSize: 15,
    fontWeight: '500',
  },
  eyeIcon: {
    padding: 6,
  },
  // Error
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  // Password strength
  strengthContainer: {
    marginBottom: 14,
  },
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  strengthBar: {
    flex: 1,
    height: 5,
    borderRadius: 3,
  },
  strengthLabel: {
    color: '#64748B',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'right',
  },
  // Buttons
  button: {
    backgroundColor: '#6C5CE7',
    borderRadius: 14,
    height: 52,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
    marginTop: 6,
  },
  buttonSignup: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
  },
  // Switch mode link
  switchModeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 18,
  },
  switchModeText: {
    color: '#64748B',
    fontSize: 14,
  },
  switchModeLink: {
    color: '#6C5CE7',
    fontSize: 14,
    fontWeight: '800',
  },
  // Role Picker Card Style
  rolePickerContainer: {
    marginBottom: 16,
    marginTop: 4,
  },
  rolePickerLabel: {
    color: '#1E1B4B',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 10,
  },
  roleButtonsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  roleCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  roleCardActive: {
    borderColor: '#6C5CE7',
    backgroundColor: 'rgba(108, 92, 231, 0.05)',
  },
  roleIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E2E8F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  roleIconCircleActive: {
    backgroundColor: '#6C5CE7',
  },
  roleTextContainer: {
    flex: 1,
  },
  roleCardTitle: {
    color: '#64748B',
    fontSize: 14,
    fontWeight: '800',
  },
  roleCardTitleActive: {
    color: '#1E1B4B',
  },
  roleCardSub: {
    color: '#94A3B8',
    fontSize: 10,
    fontWeight: '500',
    marginTop: 1,
  },
  // Info banner
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#EAEFF8',
  },
  infoBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(108, 92, 231, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  infoText: {
    color: '#64748B',
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
});

