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
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Icon name="shield-check" size={54} color={COLORS.success} />
          </View>
          <Text style={styles.title}>SafetyWorker</Text>
          <Text style={styles.subtitle}>Unified Safety & Vitals Monitor</Text>
        </View>

        {/* ── Mode Tabs ── */}
        <View style={styles.tabRow}>
          <TouchableOpacity
            id="signin-tab"
            style={[styles.tab, mode === 'signin' && styles.tabActive]}
            onPress={() => { setMode('signin'); setSiError(null); }}
          >
            <Icon
              name="login"
              size={16}
              color={mode === 'signin' ? COLORS.primary : COLORS.textMuted}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.tabText, mode === 'signin' && styles.tabTextActive]}>Sign In</Text>
          </TouchableOpacity>
          <TouchableOpacity
            id="signup-tab"
            style={[styles.tab, mode === 'signup' && styles.tabActive]}
            onPress={() => { setMode('signup'); setSuError(null); }}
          >
            <Icon
              name="account-plus"
              size={16}
              color={mode === 'signup' ? COLORS.primary : COLORS.textMuted}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.tabText, mode === 'signup' && styles.tabTextActive]}>Sign Up</Text>
          </TouchableOpacity>
        </View>

        {/* ── Sign In Form ── */}
        {mode === 'signin' && (
          <View style={[GLOBAL_STYLES.glassCard, styles.formCard]}>
            <Text style={styles.formTitle}>Welcome Back</Text>
            <Text style={styles.formSubtitle}>Sign in with your credentials</Text>

            <View style={styles.inputContainer}>
              <Icon name="account" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
              <TextInput
                id="signin-username"
                style={styles.input}
                placeholder="Username"
                placeholderTextColor={COLORS.textMuted}
                value={siUsername}
                onChangeText={setSiUsername}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputContainer}>
              <Icon name="lock" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
              <TextInput
                id="signin-password"
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={COLORS.textMuted}
                value={siPassword}
                onChangeText={setSiPassword}
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
                <Icon name="alert-circle" size={14} color={COLORS.danger} style={{ marginRight: 4 }} />
                <Text style={styles.errorText}>{siError}</Text>
              </View>
            )}

            <TouchableOpacity
              id="signin-btn"
              style={[styles.button, siLoading && styles.buttonDisabled]}
              onPress={handleSignIn}
              disabled={siLoading}
            >
              {siLoading ? (
                <ActivityIndicator color={COLORS.text} />
              ) : (
                <>
                  <Icon name="login" size={18} color={COLORS.text} style={{ marginRight: 8 }} />
                  <Text style={styles.buttonText}>Sign In</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setMode('signup')} style={styles.switchModeRow}>
              <Text style={styles.switchModeText}>New worker? </Text>
              <Text style={styles.switchModeLink}>Create an account →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Sign Up Form ── */}
        {mode === 'signup' && (
          <View style={[GLOBAL_STYLES.glassCard, styles.formCard]}>
            <Text style={styles.formTitle}>Create Account</Text>
            <Text style={styles.formSubtitle}>Register as a new safety worker</Text>

            <View style={styles.inputContainer}>
              <Icon name="account-circle" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
              <TextInput
                id="signup-name"
                style={styles.input}
                placeholder="Full Name (e.g. John Doe)"
                placeholderTextColor={COLORS.textMuted}
                value={suName}
                onChangeText={setSuName}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputContainer}>
              <Icon name="account" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
              <TextInput
                id="signup-username"
                style={styles.input}
                placeholder="Username (e.g. john_doe)"
                placeholderTextColor={COLORS.textMuted}
                value={suUsername}
                onChangeText={setSuUsername}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
            </View>

            <View style={styles.inputContainer}>
              <Icon name="lock" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
              <TextInput
                id="signup-password"
                style={styles.input}
                placeholder="Password (min. 4 characters)"
                placeholderTextColor={COLORS.textMuted}
                value={suPassword}
                onChangeText={setSuPassword}
                secureTextEntry={!suShowPass}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
              />
              <TouchableOpacity onPress={() => setSuShowPass(!suShowPass)} style={styles.eyeIcon}>
                <Icon name={suShowPass ? 'eye-off' : 'eye'} size={18} color={COLORS.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.inputContainer}>
              <Icon name="lock-check" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
              <TextInput
                id="signup-confirm"
                style={styles.input}
                placeholder="Confirm Password"
                placeholderTextColor={COLORS.textMuted}
                value={suConfirm}
                onChangeText={setSuConfirm}
                secureTextEntry={!suShowPass}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
              />
            </View>

            <View style={styles.rolePickerContainer}>
              <Text style={styles.rolePickerLabel}>Select Role:</Text>
              <View style={styles.roleButtonsRow}>
                <TouchableOpacity
                  style={[styles.roleButton, suRole === 'worker' && styles.roleButtonActive]}
                  onPress={() => setSuRole('worker')}
                >
                  <Icon name="hard-hat" size={18} color={suRole === 'worker' ? '#FFF' : COLORS.textSecondary} />
                  <Text style={[styles.roleButtonText, suRole === 'worker' && { color: '#FFF' }]}>Worker</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.roleButton, suRole === 'admin' && styles.roleButtonActive]}
                  onPress={() => setSuRole('admin')}
                >
                  <Icon name="shield-account" size={18} color={suRole === 'admin' ? '#FFF' : COLORS.textSecondary} />
                  <Text style={[styles.roleButtonText, suRole === 'admin' && { color: '#FFF' }]}>Admin</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Password strength indicator */}
            {suPassword.length > 0 && (
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
                            : COLORS.surfaceLight,
                      },
                    ]}
                  />
                ))}
                <Text style={styles.strengthLabel}>
                  {suPassword.length < 4 ? 'Weak' : suPassword.length < 8 ? 'Fair' : suPassword.length < 12 ? 'Good' : 'Strong'}
                </Text>
              </View>
            )}

            {suError && (
              <View style={styles.errorRow}>
                <Icon name="alert-circle" size={14} color={COLORS.danger} style={{ marginRight: 4 }} />
                <Text style={styles.errorText}>{suError}</Text>
              </View>
            )}

            <TouchableOpacity
              id="signup-btn"
              style={[styles.button, styles.buttonSignup, suLoading && styles.buttonDisabled]}
              onPress={handleSignUp}
              disabled={suLoading}
            >
              {suLoading ? (
                <ActivityIndicator color={COLORS.text} />
              ) : (
                <>
                  <Icon name="account-plus" size={18} color={COLORS.text} style={{ marginRight: 8 }} />
                  <Text style={styles.buttonText}>Create Account & Sign In</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setMode('signin')} style={styles.switchModeRow}>
              <Text style={styles.switchModeText}>Already registered? </Text>
              <Text style={styles.switchModeLink}>Sign in here →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Role Info Banner ── */}
        <View style={styles.infoBanner}>
          <Icon name="information" size={14} color={COLORS.textMuted} style={{ marginRight: 6 }} />
          <Text style={styles.infoText}>
            New accounts are created as <Text style={{ color: COLORS.success }}>Workers</Text>.
            {' '}Supervisor access requires admin credentials.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardView: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    paddingBottom: 40,
  },
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logoContainer: {
    width: 90,
    height: 90,
    borderRadius: 45,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  title: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.xxl,
    fontWeight: TYPOGRAPHY.weights.black,
    letterSpacing: 0.5,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.regular,
    marginTop: 4,
  },
  // Mode Tabs
  tabRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 4,
    marginBottom: 20,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
  },
  tabActive: {
    backgroundColor: 'rgba(79, 70, 229, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(79, 70, 229, 0.3)',
  },
  tabText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.semibold,
  },
  tabTextActive: {
    color: COLORS.primaryLight,
  },
  // Form card
  formCard: {
    marginBottom: 16,
  },
  formTitle: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: TYPOGRAPHY.weights.bold,
    marginBottom: 4,
  },
  formSubtitle: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginBottom: 20,
  },
  // Inputs
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
    height: 50,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
  },
  eyeIcon: {
    padding: 4,
  },
  // Error
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  errorText: {
    color: COLORS.danger,
    fontSize: TYPOGRAPHY.sizes.sm,
    flex: 1,
  },
  // Password strength
  strengthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 12,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  strengthLabel: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginLeft: 4,
    width: 40,
  },
  // Buttons
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    height: 50,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
    marginTop: 4,
  },
  buttonSignup: {
    backgroundColor: COLORS.success,
    shadowColor: COLORS.success,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  // Switch mode link
  switchModeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 16,
  },
  switchModeText: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.sm,
  },
  switchModeLink: {
    color: COLORS.primary,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  rolePickerContainer: {
    marginVertical: 10,
  },
  rolePickerLabel: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.semibold,
    marginBottom: 8,
  },
  roleButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  roleButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceLight,
  },
  roleButtonActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  roleButtonText: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  // Info banner
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    flex: 1,
    lineHeight: 18,
  },
});
