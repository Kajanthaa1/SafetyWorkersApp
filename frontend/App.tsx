import React, { useState, Component, ErrorInfo, ReactNode } from 'react';
import { StyleSheet, View, SafeAreaView, Platform, Text, TouchableOpacity } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { COLORS } from './src/styles/theme';
import LoginScreen from './src/screens/LoginScreen';
import WorkerHomeScreen from './src/screens/WorkerHomeScreen';
import AdminDashboardScreen from './src/screens/AdminDashboardScreen';
import { api } from './src/services/api';

// Error Boundary catches any render-time errors so the app never shows a blank page
interface ErrorBoundaryState { hasError: boolean; error: string | null; }
class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error: error?.message || String(error) };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App Error:', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <View style={{ flex: 1, backgroundColor: '#0B0F19', justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ color: '#EF4444', fontSize: 18, fontWeight: 'bold', marginBottom: 12 }}>⚠️ App Error</Text>
          <Text style={{ color: '#94A3B8', fontSize: 12, textAlign: 'center', marginBottom: 24 }}>{this.state.error}</Text>
          <TouchableOpacity
            style={{ backgroundColor: '#4F46E5', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 }}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={{ color: 'white', fontWeight: 'bold' }}>Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [user, setUser] = useState<any | null>(null);

  const handleLogout = async (coords?: { latitude: number; longitude: number }) => {
    // Auto clock-out when worker logs out
    if (user && user.role === 'worker') {
      try {
        await api.logout(user.id, coords?.latitude, coords?.longitude);
      } catch (err) {
        console.warn('[App] Logout API call failed (offline?):', err);
      }
    }
    setUser(null);
  };

  return (
    <ErrorBoundary>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="light" backgroundColor={COLORS.surface} />
        <View style={styles.appContainer}>
          {!user ? (
            <LoginScreen onLoginSuccess={setUser} />
          ) : user.role === 'worker' ? (
            <WorkerHomeScreen user={user} onLogout={handleLogout} />
          ) : (
            <AdminDashboardScreen user={user} onLogout={() => handleLogout()} />
          )}
        </View>
      </SafeAreaView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  appContainer: {
    flex: 1,
    width: '100%',
    maxWidth: Platform.OS === 'web' ? 768 : undefined, // Center on large web viewports for an app-like feel
    alignSelf: 'center',
    backgroundColor: COLORS.background,
  },
});
