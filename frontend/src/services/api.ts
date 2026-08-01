import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Dynamically determine backend URL
// On Expo Web, we can query window.location.hostname
// On Expo Go, we can parse the hostUri from expo-constants to find the server's local IP address.
// On React Native Emulators, localhost works differently (e.g., 10.0.2.2 on Android)
const getBackendUrl = () => {
  if (Platform.OS === 'web') {
    // If in web browser, use the current host running the server, or default to 5000
    if (typeof window !== 'undefined' && window.location) {
      return `http://${window.location.hostname}:5000`;
    }
  }

  // Extract IP from Expo Constants for physical devices (Expo Go)
  try {
    const hostUri = Constants.expoConfig?.hostUri || Constants.experienceUrl;
    if (hostUri) {
      // Find IPv4 address in the string
      const ipMatch = hostUri.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (ipMatch && ipMatch[1]) {
        console.log(`[API] Determined backend IP: ${ipMatch[1]}`);
        return `http://${ipMatch[1]}:5000`;
      }
    }
  } catch (err) {
    console.warn('Failed to get IP from Constants, using default:', err);
  }

  // Hardcode fallback to your machine's exact local IP for Expo Go compatibility
  return 'http://10.34.14.241:5000';
};

export const API_BASE = getBackendUrl();

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

export const api = {
  // Auth
  login: (username: string, password: string, latitude?: number, longitude?: number) =>
    request<any>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password, latitude: latitude ?? 0, longitude: longitude ?? 0 }),
    }),

  signup: (name: string, username: string, password: string, role: string = 'worker') =>
    request<any>('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({ name, username, password, role }),
    }),

  logout: (userId: string, latitude?: number, longitude?: number) =>
    request<any>('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ userId, latitude: latitude ?? 0, longitude: longitude ?? 0 }),
    }),

  // Workers listing (for supervisor)
  fetchWorkers: () =>
    request<any[]>('/api/users/workers'),

  // Vitals
  fetchVitals: (userId: string, minutes: number = 30) =>
    request<any[]>(`/api/vitals/${userId}?minutes=${minutes}`),

  submitVitals: (userId: string, bpm: number, spo2: number, source: 'ble' | 'gsm' = 'ble') =>
    request<any>('/api/vitals', {
      method: 'POST',
      body: JSON.stringify({ userId, bpm, spo2, source }),
    }),

  // Attendance
  fetchAttendance: (userId?: string) =>
    request<any[]>(userId ? `/api/attendance/${userId}` : '/api/attendance'),

  submitAttendance: (userId: string, action: 'clock_in' | 'clock_out', latitude: number, longitude: number) =>
    request<any>('/api/attendance', {
      method: 'POST',
      body: JSON.stringify({ userId, action, latitude, longitude }),
    }),

  // Tasks
  fetchTasks: (userId?: string) =>
    request<any[]>(userId ? `/api/tasks?userId=${userId}` : '/api/tasks'),

  createTask: (userId: string, title: string, assignedBy: string) =>
    request<any>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ userId, title, assignedBy }),
    }),

  updateTaskStatus: (taskId: string, status: 'pending' | 'in_progress' | 'done') =>
    request<any>(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // Alerts
  fetchAlerts: (userId?: string) =>
    request<any[]>(userId ? `/api/alerts?userId=${userId}` : '/api/alerts'),

  triggerAlert: (userId: string, type: 'manual' | 'fall') =>
    request<any>('/api/alerts', {
      method: 'POST',
      body: JSON.stringify({ userId, type }),
    }),

  resolveAlert: (alertId: string) =>
    request<any>(`/api/alerts/${alertId}/resolve`, {
      method: 'PATCH',
    }),

  // Real-time weather (uses device GPS coordinates)
  fetchWeather: (lat: number, lon: number) =>
    request<any>(`/api/weather?lat=${lat}&lon=${lon}`),
};
