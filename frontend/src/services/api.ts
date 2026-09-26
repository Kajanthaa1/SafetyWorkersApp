import { Platform } from 'react-native';
import Constants from 'expo-constants';

const getBackendUrl = () => {
  if (Platform.OS === 'web') {

    if (typeof window !== 'undefined' && window.location) {
      return `http://${window.location.hostname}:5000`;
    }
  }

  try {
    const hostUri = Constants.expoConfig?.hostUri || Constants.experienceUrl;
    if (hostUri) {

      const ipMatch = hostUri.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (ipMatch && ipMatch[1]) {
        console.log(`[API] Determined backend IP: ${ipMatch[1]}`);
        return `http://${ipMatch[1]}:5000`;
      }
    }
  } catch (err) {
    console.warn('Failed to get IP from Constants, using default:', err);
  }

  return 'http://10.34.13.10:5000';
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

  fetchWorkers: () =>
    request<any[]>('/api/users/workers'),

  fetchVitals: (userId: string, minutes: number = 30) =>
    request<any[]>(`/api/vitals/${userId}?minutes=${minutes}`),

  submitVitals: (userId: string, bpm: number, spo2: number, source: 'ble' | 'gsm' = 'ble') =>
    request<any>('/api/vitals', {
      method: 'POST',
      body: JSON.stringify({ userId, bpm, spo2, source }),
    }),

  fetchAttendance: (userId?: string) =>
    request<any[]>(userId ? `/api/attendance/${userId}` : '/api/attendance'),

  submitAttendance: (userId: string, action: 'clock_in' | 'clock_out', latitude: number, longitude: number) =>
    request<any>('/api/attendance', {
      method: 'POST',
      body: JSON.stringify({ userId, action, latitude, longitude }),
    }),

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

  fetchWeather: (lat?: number, lon?: number, city?: string) => {
    const params = new URLSearchParams();
    if (lat !== undefined && lon !== undefined && (lat !== 0 || lon !== 0)) {
      params.append('lat', String(lat));
      params.append('lon', String(lon));
    }
    if (city && city.trim()) {
      params.append('city', city.trim());
    }
    const query = params.toString();
    return request<any>(`/api/weather${query ? `?${query}` : ''}`);
  },
};
