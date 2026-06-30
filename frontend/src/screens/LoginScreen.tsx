import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { COLORS, GLOBAL_STYLES, TYPOGRAPHY } from '../styles/theme';
import { api } from '../services/api';
import Icon from '../components/Icon';

interface LoginScreenProps {
  onLoginSuccess: (user: any) => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogin = async (usrName: string) => {
    setLoading(true);
    setError(null);
    try {
      const user = await api.login(usrName);
      onLoginSuccess(user);
    } catch (err: any) {
      setError(err.message || 'Failed to login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <Icon name="shield-check" size={54} color={COLORS.success} />
          </View>
          <Text style={styles.title}>SafetyWorker</Text>
          <Text style={styles.subtitle}>Unified Safety & Vitals Monitor</Text>
        </View>

        <View style={[GLOBAL_STYLES.glassCard, styles.formCard]}>
          <Text style={styles.formTitle}>Sign In</Text>

          <View style={styles.inputContainer}>
            <Icon name="account" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="Username (e.g. worker1)"
              placeholderTextColor={COLORS.textMuted}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {error && <Text style={styles.errorText}>{error}</Text>}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={() => handleLogin(username)}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={COLORS.text} />
            ) : (
              <Text style={styles.buttonText}>Authenticate</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Quick Logins Section */}
        <View style={styles.quickLoginSection}>
          <Text style={styles.quickLoginTitle}>Quick Demo Logins</Text>
          <View style={styles.quickLoginButtons}>
            <TouchableOpacity 
              style={[styles.quickButton, styles.quickButtonWorker]}
              onPress={() => handleLogin('worker1')}
            >
              <Icon name="hard-hat" size={20} color={COLORS.success} />
              <View style={styles.quickButtonTextContainer}>
                <Text style={styles.quickButtonText}>Worker 1</Text>
                <Text style={styles.quickButtonSub}>John Doe</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickButton, styles.quickButtonWorker]}
              onPress={() => handleLogin('worker2')}
            >
              <Icon name="hard-hat" size={20} color={COLORS.success} />
              <View style={styles.quickButtonTextContainer}>
                <Text style={styles.quickButtonText}>Worker 2</Text>
                <Text style={styles.quickButtonSub}>Alice Smith</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickButton, styles.quickButtonSupervisor]}
              onPress={() => handleLogin('supervisor1')}
            >
              <Icon name="shield-crown" size={20} color={COLORS.primaryLight} />
              <View style={styles.quickButtonTextContainer}>
                <Text style={styles.quickButtonText}>Supervisor</Text>
                <Text style={styles.quickButtonSub}>Bob Jones</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'stretch',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
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
  formCard: {
    marginBottom: 30,
  },
  formTitle: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: TYPOGRAPHY.weights.bold,
    marginBottom: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 16,
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
  errorText: {
    color: COLORS.danger,
    fontSize: TYPOGRAPHY.sizes.sm,
    marginBottom: 16,
  },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  quickLoginSection: {
    alignItems: 'center',
  },
  quickLoginTitle: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: TYPOGRAPHY.weights.semibold,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 16,
  },
  quickLoginButtons: {
    width: '100%',
    gap: 12,
  },
  quickButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  quickButtonWorker: {
    borderColor: 'rgba(16, 185, 129, 0.2)',
  },
  quickButtonSupervisor: {
    borderColor: 'rgba(79, 70, 229, 0.2)',
  },
  quickButtonTextContainer: {
    marginLeft: 12,
  },
  quickButtonText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  quickButtonSub: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
  },
});
