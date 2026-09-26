import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Animated,
  Platform,
  Dimensions,
  TextInput,
  Modal,
} from 'react-native';
import { COLORS, GLOBAL_STYLES, TYPOGRAPHY } from '../styles/theme';
import { api } from '../services/api';
import { initSocket, emitVitalsPush, emitFallTrigger, emitFallCancel, disconnectSocket } from '../services/socket';
import Icon from '../components/Icon';
import {
  connectToWearable,
  disconnectWearable,
  destroyBle,
  triggerBuzzer,
  BleStatus,
} from '../services/bleService';
import { useNetworkStatus } from '../services/networkStatus';
import { offlineQueue } from '../services/offlineQueue';
import * as Location from 'expo-location';
import { LinearGradient } from 'expo-linear-gradient';
import ArcProgressGauge from '../components/ArcProgressGauge';
import EcgWaveform from '../components/EcgWaveform';
import MiniBarChart from '../components/MiniBarChart';

interface WorkerHomeScreenProps {
  user: any;
  onLogout: (coords?: { latitude: number; longitude: number }) => void;
}

type TabType = 'dashboard' | 'health' | 'fall' | 'emergency' | 'weather';

export default function WorkerHomeScreen({ user, onLogout }: WorkerHomeScreenProps) {

  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  const isOnline = useNetworkStatus();
  const [offlineQueueSize, setOfflineQueueSize] = useState(0);

  const [bpm, setBpm] = useState(76);
  const [spo2, setSpo2] = useState(98);
  const [bodyTemp, setBodyTemp] = useState<number>(36.6);
  const [vitalsHistory, setVitalsHistory] = useState<any[]>([]);
  const [loadingVitals, setLoadingVitals] = useState(false);
  const [consecutiveAbnormal, setConsecutiveAbnormal] = useState(0);
  const [healthStatus, setHealthStatus] = useState<'Normal' | 'Health Risk Alert'>('Normal');

  const [gyro, setGyro] = useState<{ gx: number; gy: number; gz: number }>({ gx: 0, gy: 0, gz: 9.81 });
  const [estimatedHeight, setEstimatedHeight] = useState<number>(1.5);
  const [movementActivity, setMovementActivity] = useState<string>('Stationary');
  const [isHardwareActive, setIsHardwareActive] = useState<boolean>(false);
  const isHardwareActiveRef = useRef<boolean>(false);

  const [manDownActive, setManDownActive] = useState<boolean>(false);
  const [manDownSeconds, setManDownSeconds] = useState<number>(20);
  const manDownCountdownRef = useRef<NodeJS.Timeout | null>(null);
  const [fallModalVisible, setFallModalVisible] = useState<boolean>(false);
  const [logoutModalVisible, setLogoutModalVisible] = useState<boolean>(false);
  const [isLoggingOut, setIsLoggingOut] = useState<boolean>(false);

  const [bleStatus, setBleStatus] = useState<BleStatus>('idle');
  const bleConnected = bleStatus === 'connected';

  const localSampleCadence = 5;
  const cloudPushCadence = 10;
  const [lastPushTime, setLastPushTime] = useState<number>(Date.now());
  const [localBuffers, setLocalBuffers] = useState<{ bpm: number; spo2: number }[]>([]);

  const lastPushTimeRef2 = useRef<number>(Date.now());
  const localBuffersRef2 = useRef<{ bpm: number; spo2: number }[]>([]);

  const [ppgPoints, setPpgPoints] = useState<number[]>(new Array(30).fill(20));
  const ppgIndex = useRef(0);

  const [movementState, setMovementState] = useState<'Active' | 'Idle' | 'Fall Detected'>('Active');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [lastFall, setLastFall] = useState<{ timestamp: number; severity: string } | null>(null);
  const [activeFallId, setActiveFallId] = useState<string | null>(null);

  const [clockedIn, setClockedIn] = useState(false);
  const [attendanceLogs, setAttendanceLogs] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [gpsCoords, setGpsCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const [connectionHealth, setConnectionHealth] = useState<'connected' | 'weak' | 'disconnected'>('connected');
  const [alertHistory, setAlertHistory] = useState<any[]>([]);
  const [submittingAlert, setSubmittingAlert] = useState(false);

  const [weather, setWeather] = useState<any>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [anomalyMode, setAnomalyMode] = useState<'none' | 'spike' | 'sustained'>('none');
  const anomalyCountRef = useRef(0);

  const countdownInterval = useRef<NodeJS.Timeout | null>(null);
  const esp32SampleInterval = useRef<NodeJS.Timeout | null>(null);
  const ppgAnimationInterval = useRef<NodeJS.Timeout | null>(null);

  const simulationStarted = useRef(false);

  const ppgBufferRef = useRef<number[]>(new Array(30).fill(20));
  const ppgFlushInterval = useRef<NodeJS.Timeout | null>(null);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  const lastPushTimeRef = useRef<number>(Date.now());
  const localBuffersRef = useRef<{ bpm: number; spo2: number }[]>([]);

  const isOnlineRef = useRef<boolean>(isOnline);

  useEffect(() => {

    isOnlineRef.current = isOnline;
    if (isOnline) {
      console.log('[WorkerHomeScreen] Network went ONLINE. Flushing offline queue...');
      offlineQueue.flush((flushedItem) => {
        setVitalsHistory(prev => [...prev.slice(-30), {
          bpm: flushedItem.bpm,
          spo2: flushedItem.spo2,
          timestamp: flushedItem.timestamp
        }]);
        offlineQueue.getQueueSize().then(setOfflineQueueSize);
      }).then(() => {
        offlineQueue.getQueueSize().then(setOfflineQueueSize);
      });
    }
  }, [isOnline]);

  useEffect(() => {

    const socket = initSocket(user.id, user.role);

    socket.on('task_update', (data: any) => {
      if (data.userId === user.id) {
        loadTasks();
      }
    });

    socket.on('new_fall', (data: any) => {
      if (data.userId === user.id || user.role === 'worker') {
        setMovementState('Fall Detected');
        setFallModalVisible(true);
        setLastFall({ timestamp: data.fall?.timestamp || Date.now(), severity: data.fall?.severity || 'confirmed' });
      }
    });

    socket.on('new_alert', (data: any) => {
      if ((data.userId === user.id || user.role === 'worker') && data.alert?.type === 'fall') {
        setMovementState('Fall Detected');
        setFallModalVisible(true);
        setLastFall({ timestamp: data.alert?.timestamp || Date.now(), severity: 'confirmed' });
      }
    });

    socket.on('vitals_update', (data: any) => {
      if (data.userId === user.id || user.role === 'worker') {
        setIsHardwareActive(true);
        isHardwareActiveRef.current = true;
        if (data.reading) {
          const rawBpm = Number(data.reading.bpm || 0);
          const rawSpo2 = Number(data.reading.spo2 || 0);
          let rawGx = Number(data.reading.gx || 0);
          let rawGy = Number(data.reading.gy || 0);
          let rawGz = Number(data.reading.gz || 0);

          if (Math.abs(rawGx) < 0.35) rawGx = 0;
          if (Math.abs(rawGy) < 0.35) rawGy = 0;
          if (Math.abs(rawGz) < 0.35) rawGz = 0;
          setGyro({ gx: rawGx, gy: rawGy, gz: rawGz });

          if (rawBpm >= 30 && rawBpm <= 220) {
            setBpm(rawBpm);
            setPpgPoints(prev => {
              const next = [...prev.slice(1)];
              const normalized = Math.min(40, Math.max(2, (rawBpm - 50) * 0.5));
              next.push(normalized);
              return next;
            });
          }

          if (rawSpo2 >= 50 && rawSpo2 <= 100) {
            setSpo2(rawSpo2);
          }

          const mag = Math.sqrt(rawGx * rawGx + rawGy * rawGy + rawGz * rawGz);
          let activity = 'Stationary';
          if (mag > 10.0) {
            setMovementState('Active');
            activity = 'Dynamic Wrist Motion';
          } else if (mag > 1.5) {
            setMovementState('Active');
            activity = 'Active Movement';
          } else {
            setMovementState('Idle');
            activity = 'Stationary';
          }
          setMovementActivity(activity);

          const targetHeight = 1.5;
          setEstimatedHeight(prev => parseFloat((prev * 0.95 + targetHeight * 0.05).toFixed(1)));

          setVitalsHistory(prev => [
            ...prev.slice(-30),
            {
              bpm: (rawBpm >= 30 && rawBpm <= 220) ? rawBpm : (prev.length > 0 ? prev[prev.length - 1].bpm : 75),
              spo2: (rawSpo2 >= 50 && rawSpo2 <= 100) ? rawSpo2 : (prev.length > 0 ? prev[prev.length - 1].spo2 : 98),
              timestamp: data.reading.timestamp || Date.now(),
            },
          ]);
        }
        setConsecutiveAbnormal(data.consecutiveAbnormalCount || 0);
        if (data.consecutiveAbnormalCount >= 3) {
          setHealthStatus('Health Risk Alert');
        } else {
          setHealthStatus('Normal');
        }
      }
    });

    return () => {
      disconnectSocket();
    };
  }, []);

  useEffect(() => {
    offlineQueue.getQueueSize().then(setOfflineQueueSize);
    loadInitialData();
    startEsp32Simulation();
    startPpgWaveformAnimation();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 800, useNativeDriver: true }),
      ])
    ).start();

    return () => {
      destroyBle();
      if (countdownInterval.current) clearInterval(countdownInterval.current);
      if (esp32SampleInterval.current) { clearInterval(esp32SampleInterval.current); esp32SampleInterval.current = null; }
      if (ppgAnimationInterval.current) { clearInterval(ppgAnimationInterval.current); ppgAnimationInterval.current = null; }
      if (ppgFlushInterval.current) { clearInterval(ppgFlushInterval.current); ppgFlushInterval.current = null; }
    };
  }, []);

  const loadInitialData = async () => {

    await Promise.all([loadTasks(), loadAttendanceHistory()]);

    setTimeout(() => loadVitalsHistory(), 200);
    setTimeout(() => loadAlertHistory(), 400);
    setTimeout(() => requestLocationAndLoad(), 600);
  };

  const loadVitalsHistory = async () => {
    setLoadingVitals(true);
    try {
      const data = await api.fetchVitals(user.id, 30);
      setVitalsHistory(data);
      if (data.length > 0) {
        const latest = data[data.length - 1];
        setBpm(latest.bpm);
        setSpo2(latest.spo2);
      }
    } catch (err: any) {
      console.log('[Info] Error fetching vitals:', err?.message);
    } finally {
      setLoadingVitals(false);
    }
  };

  const loadTasks = async () => {
    try {
      const data = await api.fetchTasks(user.id);
      setTasks(data);
    } catch (err: any) {
      console.log('[Info] Failed to fetch tasks:', err?.message);
    }
  };

  const loadAttendanceHistory = async () => {
    try {
      const data = await api.fetchAttendance(user.id);
      setAttendanceLogs(data);
      if (data.length > 0) {
        const lastAction = data[data.length - 1].action;
        setClockedIn(lastAction === 'clock_in');
      }
    } catch (err: any) {
      console.log('[Info] Failed to fetch attendance:', err?.message);
    }
  };

  const loadAlertHistory = async () => {
    try {
      const data = await api.fetchAlerts(user.id);
      setAlertHistory(data);
    } catch (err: any) {
      console.log('[Info] Failed to fetch alerts:', err?.message);
    }
  };

  const loadWeather = async (coords?: { latitude: number; longitude: number }, city?: string) => {
    setLoadingWeather(true);
    try {
      const data = await api.fetchWeather(coords?.latitude, coords?.longitude, city);
      setWeather(data);
      if (data?.coordinates && (!coords || (coords.latitude === 0 && coords.longitude === 0))) {
        setGpsCoords({ latitude: data.coordinates.lat, longitude: data.coordinates.lon });
      }
    } catch (err: any) {
      console.warn('[Weather] Failed to fetch:', err?.message || err);
    } finally {
      setLoadingWeather(false);
    }
  };

  const fallbackToIpWeather = async () => {
    try {
      const ipRes = await fetch('http://ip-api.com/json').then(r => r.json()).catch(() => null);
      if (ipRes && ipRes.lat && ipRes.lon) {
        const ipCoords = { latitude: ipRes.lat, longitude: ipRes.lon };
        setGpsCoords(ipCoords);
        await loadWeather(ipCoords);
        return;
      }
    } catch (e) {
      console.warn('[Location] IP geolocation fetch failed:', e);
    }

    await loadWeather();
  };

  const requestLocationAndLoad = async (cityQuery?: string) => {
    setGpsLoading(true);
    setGpsError(null);

    if (cityQuery && cityQuery.trim()) {
      await loadWeather(undefined, cityQuery.trim());
      setGpsLoading(false);
      return;
    }

    try {

      const { status: currentStatus } = await Location.getForegroundPermissionsAsync();
      let status = currentStatus;
      if (status !== 'granted') {
        const req = await Location.requestForegroundPermissionsAsync();
        status = req.status;
      }

      if (status !== 'granted') {
        setGpsError('GPS permission not granted. Showing network weather.');
        await fallbackToIpWeather();
        return;
      }

      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled && Platform.OS === 'android') {
        try {
          await Location.enableNetworkProviderAsync();
        } catch (enableErr) {
          console.warn('[Location] Enable location services prompt dismissed:', enableErr);
        }
      }

      let resolved = false;
      try {
        const lastKnown = await Location.getLastKnownPositionAsync({ maxAge: 600000 });
        if (lastKnown && lastKnown.coords) {
          const coords = { latitude: lastKnown.coords.latitude, longitude: lastKnown.coords.longitude };
          setGpsCoords(coords);
          loadWeather(coords);
          resolved = true;
        }
      } catch (lastErr) {
        console.warn('[Location] Last known position unavailable:', lastErr);
      }

      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 5000,
        });
        if (loc && loc.coords) {
          const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setGpsCoords(coords);
          loadWeather(coords);
          resolved = true;
        }
      } catch (currErr: any) {
        console.warn('[Location] getCurrentPositionAsync:', currErr?.message || currErr);
        if (!resolved) {
          setGpsError('GPS unavailable indoors. Using network location.');
          await fallbackToIpWeather();
        }
      }
    } catch (err: any) {
      console.warn('[Location] Location error handled:', err?.message || err);
      await fallbackToIpWeather();
    } finally {
      setGpsLoading(false);
    }
  };

  const startPpgWaveformAnimation = () => {
    const wavePattern = [15, 12, 10, 8, 12, 28, 35, 12, 14, 16, 18, 17, 16, 15, 15, 14, 15, 14, 15, 16, 15, 14, 15, 16, 15, 14, 13, 14, 15, 16];

    ppgAnimationInterval.current = setInterval(() => {
      const buf = ppgBufferRef.current;
      const point = wavePattern[ppgIndex.current % wavePattern.length];
      const noise = Math.random() * 4 - 2;
      const filteredPoint = Math.max(2, point + noise);
      ppgBufferRef.current = [...buf.slice(1), filteredPoint];
      ppgIndex.current += 1;
    }, 150);

    ppgFlushInterval.current = setInterval(() => {
      setPpgPoints([...ppgBufferRef.current]);
    }, 600);
  };

  const handleBleVitalReading = useCallback(async (nextBpm: number, nextSpo2: number) => {
    setBpm(nextBpm);
    setSpo2(nextSpo2);

    localBuffersRef.current = [...localBuffersRef.current, { bpm: nextBpm, spo2: nextSpo2 }];

    const now = Date.now();
    const timeSinceLastPush = now - lastPushTimeRef.current;
    const shouldPushImmediately = nextBpm < 60 || nextBpm > 140 || nextSpo2 < 92;

    if (timeSinceLastPush >= cloudPushCadence * 1000 || shouldPushImmediately) {
      const buf = localBuffersRef.current;
      const avgBpm  = Math.round(buf.reduce((a, c) => a + c.bpm,  0) / buf.length);
      const avgSpo2 = Math.round(buf.reduce((a, c) => a + c.spo2, 0) / buf.length);

      lastPushTimeRef.current = now;
      localBuffersRef.current = [];
      setLastPushTime(now);

      if (!isOnline) {
        const queueSize = await offlineQueue.enqueue(user.id, avgBpm, avgSpo2);
        setOfflineQueueSize(queueSize);
        setVitalsHistory(prev => [...prev.slice(-30), { bpm: avgBpm, spo2: avgSpo2, timestamp: now }]);
        return;
      }

      try {
        const response = await api.submitVitals(user.id, avgBpm, avgSpo2, 'ble');
        setVitalsHistory(prev => [...prev.slice(-30), { bpm: avgBpm, spo2: avgSpo2, timestamp: now }]);
        if (response.triggeredAlert) {
          setHealthStatus('Health Risk Alert');
          loadAlertHistory();

          triggerBuzzer(true);
          setTimeout(() => triggerBuzzer(false), 3000);
          Alert.alert('HEALTH WARNING', 'Sustained abnormal vital readings detected. Alert escalated to Supervisor.');
        } else {
          setHealthStatus(response.consecutiveAbnormalCount >= 3 ? 'Health Risk Alert' : 'Normal');
        }
      } catch (err) {
        console.error('Failed to sync to database:', err);
      }
    }
  }, [cloudPushCadence, user.id, isOnline]);

  const handleConnectWearable = () => {
    if (bleStatus === 'scanning' || bleStatus === 'connecting') return;

    if (esp32SampleInterval.current) {
      clearInterval(esp32SampleInterval.current);
      esp32SampleInterval.current = null;
    }

    connectToWearable({
      onStatusChange: (status) => {
        setBleStatus(status);
        if (status === 'disconnected' || status === 'error') {

          if (!esp32SampleInterval.current) startEsp32Simulation();
        }
      },
      onHeartRate: (newBpm) => {
        setBpm(newBpm);

        setPpgPoints(prev => {
          const next = [...prev.slice(1)];
          const normalized = Math.min(40, Math.max(2, (newBpm - 50) * 0.5));
          next.push(normalized);
          return next;
        });
        if (newBpm > 0 && spo2 > 0) {
          handleBleVitalReading(newBpm, spo2);
        }
      },
      onSpO2: (newSpo2) => {
        setSpo2(newSpo2);
        if (bpm > 0 && newSpo2 > 0) {
          handleBleVitalReading(bpm, newSpo2);
        }
      },
      onFall: (detected) => {
        if (detected) {
          handleSimulateFall('confirmed');
        }
      },
    });
  };

  const handleDisconnectWearable = () => {
    disconnectWearable();
    setBleStatus('idle');

    if (!esp32SampleInterval.current) startEsp32Simulation();
  };

  const startEsp32Simulation = () => {
    if (esp32SampleInterval.current) return;

    const anomalyModeRef = { current: anomalyMode };

    esp32SampleInterval.current = setInterval(async () => {
      if (isHardwareActiveRef.current) {

        return;
      }
      let nextBpm = 75;
      let nextSpo2 = 98;

      if (anomalyModeRef.current === 'spike') {
        nextBpm = 148;
        nextSpo2 = 89;
        anomalyModeRef.current = 'none';
        setAnomalyMode('none');
      } else if (anomalyModeRef.current === 'sustained') {
        nextBpm = 125;
        nextSpo2 = 88;
        anomalyCountRef.current += 1;
        if (anomalyCountRef.current >= 4) {
          anomalyModeRef.current = 'none';
          setAnomalyMode('none');
          anomalyCountRef.current = 0;
        }
      } else {
        const base = 86;
        const variance = Math.floor(Math.random() * 6) - 3;
        nextBpm = Math.min(Math.max(base + variance, 58), 138);
        nextSpo2 = Math.random() > 0.98 ? 96 : 98;
      }

      setBpm(nextBpm);
      setSpo2(nextSpo2);

      const newReading = { bpm: nextBpm, spo2: nextSpo2 };
      localBuffersRef2.current = [...localBuffersRef2.current, newReading];

      const now = Date.now();
      const timeSinceLastPush = now - lastPushTimeRef2.current;
      const shouldPushImmediately = nextBpm < 60 || nextBpm > 140 || nextSpo2 < 92;

      if (timeSinceLastPush >= cloudPushCadence * 1000 || shouldPushImmediately) {
        const buf = localBuffersRef2.current;
        const avgBpm  = Math.round(buf.reduce((acc, c) => acc + c.bpm,  0) / buf.length);
        const avgSpo2 = Math.round(buf.reduce((acc, c) => acc + c.spo2, 0) / buf.length);

        lastPushTimeRef2.current = now;
        localBuffersRef2.current = [];
        setLastPushTime(now);
        setLocalBuffers([]);

        const isCurrentlyOnline = isOnlineRef.current;
        if (!isCurrentlyOnline) {
          const queueSize = await offlineQueue.enqueue(user.id, avgBpm, avgSpo2);
          setOfflineQueueSize(queueSize);
          setVitalsHistory(prev => [...prev.slice(-30), { bpm: avgBpm, spo2: avgSpo2, timestamp: now }]);
          return;
        }

        try {
          const response = await api.submitVitals(user.id, avgBpm, avgSpo2, 'ble');
          setVitalsHistory(prev => [...prev.slice(-30), { bpm: avgBpm, spo2: avgSpo2, timestamp: now }]);
          if (response.triggeredAlert) {
            setHealthStatus('Health Risk Alert');
            loadAlertHistory();
            Alert.alert('HEALTH WARNING', 'Sustained abnormal vital readings detected. Alert escalated to Supervisor.', [{ text: 'OK' }]);
          } else {
            setHealthStatus(response.consecutiveAbnormalCount >= 3 ? 'Health Risk Alert' : 'Normal');
          }
        } catch (err) {
          console.error('Failed to sync to database:', err);
        }
      }
    }, localSampleCadence * 1000);
  };

  const handleManualCheckIn = async () => {
    setLoadingVitals(true);

    const nextBpm = Math.floor(Math.random() * 12) + 72;
    const nextSpo2 = 98;

    setBpm(nextBpm);
    setSpo2(nextSpo2);
    setLocalBuffers([]);
    setLastPushTime(Date.now());

    if (!isOnline) {
      const queueSize = await offlineQueue.enqueue(user.id, nextBpm, nextSpo2);
      setOfflineQueueSize(queueSize);
      setVitalsHistory(prev => [...prev, { bpm: nextBpm, spo2: nextSpo2, timestamp: Date.now() }]);
      setLoadingVitals(false);
      return;
    }

    try {
      const response = await api.submitVitals(user.id, nextBpm, nextSpo2, 'ble');
      setVitalsHistory(prev => [...prev, { bpm: nextBpm, spo2: nextSpo2, timestamp: Date.now() }]);
      setConsecutiveAbnormal(response.consecutiveAbnormalCount);
      setHealthStatus(response.consecutiveAbnormalCount >= 3 ? 'Health Risk Alert' : 'Normal');
      loadAlertHistory();
      if (gpsCoords) loadWeather(gpsCoords);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingVitals(false);
    }
  };

  const triggerSingleNoisySpike = () => {
    setAnomalyMode('spike');
    Alert.alert('Simulating Noise', 'Next 5s local sensor sample will contain a noise artifact (HR 148, SpO2 89%). Alert should NOT trigger as it is a single sample.');
  };

  const triggerSustainedCritical = () => {
    setAnomalyMode('sustained');
    anomalyCountRef.current = 0;
    Alert.alert('Simulating Sustained Critical Vitals', 'Sensors will report abnormal vitals (HR 125, SpO2 88%) for 3 consecutive cycles to trigger the automatic health alert.');
  };

  const handleSimulateFall = async (severity: 'minor' | 'confirmed') => {
    setMovementState('Fall Detected');
    setFallModalVisible(true);
    setCountdown(15);
    setLastFall({ timestamp: Date.now(), severity });

    try {
      const response = await api.triggerAlert(user.id, 'fall');
      setActiveFallId(response.id);
      loadAlertHistory();
    } catch (err) {
      console.error(err);
    }

    if (countdownInterval.current) clearInterval(countdownInterval.current);
    countdownInterval.current = setInterval(() => {
      setCountdown(prev => {
        if (prev === null) return null;
        if (prev <= 1) {
          clearInterval(countdownInterval.current!);
          Alert.alert('Emergency Alert Escalated', 'No cancellation received. Fall alarm sent with GPS coordinates.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const handleCancelFallAlert = async () => {
    if (countdownInterval.current) clearInterval(countdownInterval.current);
    setCountdown(null);
    setMovementState('Active');

    if (activeFallId) {
      try {
        await api.resolveAlert(activeFallId);
        setActiveFallId(null);
        loadAlertHistory();
      } catch (err) {
        console.error(err);
      }
    }
  };

  const handleClockToggle = async () => {
    const nextAction = clockedIn ? 'clock_out' : 'clock_in';
    const nextCoords = {
      latitude: 37.7749 + (Math.random() - 0.5) * 0.005,
      longitude: -122.4194 + (Math.random() - 0.5) * 0.005,
    };
    setGpsCoords(nextCoords);

    try {
      await api.submitAttendance(user.id, nextAction, nextCoords.latitude, nextCoords.longitude);
      setClockedIn(!clockedIn);
      loadAttendanceHistory();
    } catch (err) {
      console.error(err);
    }
  };

  const handleTaskStatusCycle = async (task: any) => {
    let nextStatus: 'pending' | 'in_progress' | 'done' = 'pending';
    if (task.status === 'pending') nextStatus = 'in_progress';
    else if (task.status === 'in_progress') nextStatus = 'done';

    try {
      await api.updateTaskStatus(task.id, nextStatus);
      loadTasks();
    } catch (err) {
      console.error(err);
    }
  };

  const handleSOSPress = async () => {
    setSubmittingAlert(true);
    try {
      await api.triggerAlert(user.id, 'manual');
      loadAlertHistory();
      Alert.alert('SOS Triggered', 'Manual Panic Alarm sent to Supervisor.');
    } catch (err) {
      console.error(err);
    } finally {
      setSubmittingAlert(false);
    }
  };

  const getSafetyScore = () => {
    let score = 100;

    if (bpm > 120 || bpm < 50) score -= 25;
    else if (bpm > 100 || bpm < 60) score -= 10;

    if (spo2 < 92) score -= 35;
    else if (spo2 < 95) score -= 15;

    if (bodyTemp > 38.5) score -= 30;
    else if (bodyTemp > 37.5) score -= 15;

    if (movementState === 'Fall Detected') score -= 50;

    return Math.max(score, 0);
  };

  const getBpmColor = () => {
    if (bpm > 140 || bpm < 60) return COLORS.danger;
    return COLORS.success;
  };

  const getSpo2Color = () => {
    if (spo2 < 92) return COLORS.danger;
    return COLORS.success;
  };

  const handlePerformLogout = () => {
    setLogoutModalVisible(false);
    if (onLogout) {
      onLogout(gpsCoords || undefined);
    }
  };

  return (
    <LinearGradient
      colors={['#E3D5F2', '#C6D2F6']}
      style={GLOBAL_STYLES.container}
    >

      <View style={styles.header}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {activeTab !== 'dashboard' ? (
            <TouchableOpacity
              onPress={() => setActiveTab('dashboard')}
              style={{ padding: 4 }}
              accessibilityLabel="Back to Dashboard"
            >
              <Icon name="arrow-left" size={22} color={COLORS.text} />
            </TouchableOpacity>
          ) : (
            <View style={styles.headerAvatarCircle}>
              <Icon name="hard-hat" size={20} color="#6C5CE7" />
            </View>
          )}
          <View>
            <Text style={styles.userName}>{user.name}</Text>
            <View style={styles.roleContainer}>
              <Icon name="shield-check" size={13} color={COLORS.success} />
              <Text style={styles.userRole}>Worker Interface</Text>
            </View>
          </View>
        </View>

        <View style={styles.headerActions}>

          <TouchableOpacity
            style={styles.headerLogoutBtn}
            onPress={() => setLogoutModalVisible(true)}
            activeOpacity={0.7}
            hitSlop={{ top: 15, bottom: 15, left: 15, right: 15 }}
            accessibilityLabel="Log out"
          >
            <Icon name="logout" size={18} color="#DC2626" />
          </TouchableOpacity>
        </View>
      </View>

      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Icon name="wifi-off" size={16} color={COLORS.danger} style={{ marginRight: 6 }} />
          <Text style={styles.offlineBannerText}>
            No Signal! Vitals queuing locally ({offlineQueueSize} saved).
          </Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {countdown !== null && (
          <View style={styles.fallOverlay}>
            <Icon name="alert-decagram" size={54} color={COLORS.danger} />
            <Text style={styles.fallOverlayTitle}>FALL DETECTED!</Text>
            <Text style={styles.fallOverlaySubtitle}>Escalating to Supervisor in</Text>
            <Text style={styles.fallOverlayTimer}>{countdown}s</Text>
            <TouchableOpacity style={styles.cancelFallButton} onPress={handleCancelFallAlert}>
              <Icon name="check" size={18} color={COLORS.text} />
              <Text style={styles.cancelFallButtonText}>I'm OK — Cancel Alert</Text>
            </TouchableOpacity>
          </View>
        )}

        {activeTab === 'dashboard' && (
          <View style={styles.dashboardContainer}>

            <LinearGradient
              colors={['#6C5CE7', '#8B5CF6', '#9333EA']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.refHeroContainer}
            >
              <View style={styles.refHeroTopRow}>
                <View style={styles.refWeatherWidget}>
                  <Icon name="weather-partly-cloudy" size={16} color="#FFFFFF" />
                  <Text style={styles.refWeatherText}>
                    {weather ? `${Math.round(weather.temperature)}°C` : '32°C'}
                  </Text>
                </View>

                <Text style={styles.refHeroTitle}>Worker Safety & Vitals</Text>

                <TouchableOpacity
                  style={styles.refWatchBadge}
                  onPress={bleConnected ? handleDisconnectWearable : handleConnectWearable}
                >
                  <Icon name="watch-variant" size={18} color="#FFFFFF" />
                  {bleConnected && <View style={styles.refWatchDot} />}
                </TouchableOpacity>
              </View>

              <ArcProgressGauge
                currentValue={`${getSafetyScore()}%`}
                goalValue="100%"
                label="Safety Score"
                iconName="shield-check"
              />

              <View style={styles.refHeroStatsRow}>
                <View style={styles.refHeroStatItem}>
                  <Text style={styles.refHeroStatLabel}>HEART RATE</Text>
                  <Text style={styles.refHeroStatValue}>{bpm} <Text style={styles.refHeroStatUnit}>BPM</Text></Text>
                </View>
                <View style={styles.refHeroStatDivider} />
                <View style={styles.refHeroStatItem}>
                  <Text style={styles.refHeroStatLabel}>OXYGEN</Text>
                  <Text style={styles.refHeroStatValue}>{spo2}% <Text style={styles.refHeroStatUnit}>SpO2</Text></Text>
                </View>
                <View style={styles.refHeroStatDivider} />
                <View style={styles.refHeroStatItem}>
                  <Text style={styles.refHeroStatLabel}>FALL GUARD</Text>
                  <Text style={styles.refHeroStatValue}>
                    {movementState === 'Fall Detected' ? 'ALERT' : 'SAFE'}
                  </Text>
                </View>
              </View>
            </LinearGradient>

            <View style={styles.refGridContainer}>
              <TouchableOpacity
                style={[styles.refCard, styles.refCardPeach]}
                onPress={() => setActiveTab('fall')}
                activeOpacity={0.85}
              >
                <View style={styles.refCardHeaderRow}>
                  <Text style={[styles.refCardTitle, { color: COLORS.cardPeachText }]}>Fall Guard</Text>
                  <Icon name="shield-alert" size={18} color={COLORS.cardPeachAccent} />
                </View>

                <View style={styles.refCardCenterBody}>
                  <View style={styles.refPeachCenterCircle}>
                    <Text style={[styles.refPeachNumText, movementState === 'Fall Detected' && { color: COLORS.danger }]}>
                      {movementState === 'Fall Detected' ? 'ALERT' : 'SAFE'}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.refCard, styles.refCardLilac]}
                onPress={() => setActiveTab('health')}
                activeOpacity={0.85}
              >
                <View style={styles.refCardHeaderRow}>
                  <Text style={[styles.refCardTitle, { color: COLORS.cardLilacText }]}>Heart Rate</Text>
                  <Icon name="heart-pulse" size={18} color="#EF4444" />
                </View>

                <EcgWaveform color="#8B5CF6" height={34} />

                <View style={styles.refLilacFooterRow}>
                  <Text style={styles.refLilacBpmVal}>{bpm}</Text>
                  <Text style={styles.refLilacBpmUnit}>BPM</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.refCard, styles.refCardMint]}
                onPress={() => setActiveTab('health')}
                activeOpacity={0.85}
              >
                <View style={styles.refCardHeaderRow}>
                  <Text style={[styles.refCardTitle, { color: COLORS.cardMintText }]}>Blood Oxygen</Text>
                  <Icon name="percent" size={18} color={COLORS.cardMintAccent} />
                </View>

                <MiniBarChart color="#14B8A6" height={34} />

                <Text style={styles.refMintFooterText}>{spo2}% <Text style={styles.refMintUnit}>SpO2 · Normal</Text></Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.refCard, styles.refCardAmber]}
                onPress={() => setActiveTab('weather')}
                activeOpacity={0.85}
              >
                <View style={styles.refCardHeaderRow}>
                  <Text style={[styles.refCardTitle, { color: COLORS.cardAmberText }]}>Body Temp</Text>
                  <Icon name="thermometer" size={18} color={COLORS.cardAmberAccent} />
                </View>

                <View style={styles.refCardCenterBody}>
                  <View style={styles.refAmberRing}>
                    <Text style={styles.refAmberRingNum}>{bodyTemp}°C</Text>
                  </View>
                </View>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.sosFullBanner}
              onPress={() => setActiveTab('emergency')}
              activeOpacity={0.85}
            >
              <View style={styles.sosBannerCenter}>
                <View style={styles.sosBannerIconCircle}>
                  <Icon name="alert-octagon" size={24} color="#DC2626" />
                </View>
                <Text style={styles.sosBannerTitle}>SOS Emergency Panic</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dashboardLogoutBtn}
              onPress={() => setLogoutModalVisible(true)}
              activeOpacity={0.8}
            >
              <Icon name="logout" size={20} color="#DC2626" style={{ marginRight: 8 }} />
              <Text style={styles.dashboardLogoutBtnTxt}>CLOCK OUT & LOG OUT</Text>
            </TouchableOpacity>

          </View>
        )}

        {activeTab === 'health' && (
          <View style={styles.tabContent}>

            <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleContainer}>
                  <Icon name="heart-pulse" size={22} color={COLORS.danger} />
                  <Text style={styles.cardTitle}>Health Vitals</Text>
                </View>
                <View style={[GLOBAL_STYLES.badge, { backgroundColor: healthStatus === 'Normal' ? COLORS.successBg : COLORS.dangerBg }]}>
                  <Text style={[GLOBAL_STYLES.badgeText, { color: healthStatus === 'Normal' ? COLORS.success : COLORS.danger, marginLeft: 0 }]}>
                    {healthStatus === 'Normal' ? 'Vitals: Safe' : 'Health Risk Alert'}
                  </Text>
                </View>
              </View>

              <View style={styles.vitalsRow}>
                <View style={styles.gaugeBox}>
                  <Text style={styles.gaugeHeader}>HEART RATE</Text>
                  <View style={[styles.circleGauge, { borderColor: getBpmColor() }]}>
                    <Text style={[styles.gaugeNum, { color: getBpmColor() }]}>{bpm}</Text>
                    <Text style={styles.gaugeUnit}>BPM</Text>
                  </View>
                </View>

                <View style={styles.gaugeBox}>
                  <Text style={styles.gaugeHeader}>OXYGEN SATURATION</Text>
                  <View style={[styles.circleGauge, { borderColor: getSpo2Color() }]}>
                    <Text style={[styles.gaugeNum, { color: getSpo2Color() }]}>{spo2}%</Text>
                    <Text style={styles.gaugeUnit}>SpO2</Text>
                  </View>
                </View>

                <View style={styles.cadenceCheckin}>
                  <TouchableOpacity style={styles.forceCheckinBtn} onPress={handleManualCheckIn} disabled={loadingVitals}>
                    {loadingVitals ? (
                      <ActivityIndicator size="small" color={COLORS.textSecondary} />
                    ) : (
                      <>
                        <Icon name="sync" size={14} color={COLORS.text} style={{ marginRight: 4 }} />
                        <Text style={styles.forceCheckinText}>Force Check-In</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleContainer}>
                  <Icon name="sine-wave" size={22} color={COLORS.primaryLight} />
                  <Text style={styles.cardTitle}>Live Pulse Waveform</Text>
                </View>
                <View style={[GLOBAL_STYLES.badge, { backgroundColor: COLORS.primaryBg }]}>
                  <Text style={[GLOBAL_STYLES.badgeText, { color: COLORS.primaryLight, marginLeft: 0 }]}>Live Signal</Text>
                </View>
              </View>

              <View style={styles.ppgCanvas}>
                <View style={styles.ppgPointsContainer}>
                  {ppgPoints.map((val, idx) => {
                    const height = val * 2;
                    const isPeak = val > 26;
                    return (
                      <View key={idx} style={styles.ppgBarContainer}>
                        {isPeak && <View style={styles.ppgPeakDot} />}
                        <View style={[styles.ppgWaveBar, { height }]} />
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>

            <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleContainer}>
                  <Icon name="thermometer-alert" size={22} color={bpm > 115 ? COLORS.danger : COLORS.warning} />
                  <Text style={styles.cardTitle}>Heat & Stress Monitor</Text>
                </View>
                <View style={[
                  GLOBAL_STYLES.badge,
                  { backgroundColor: bpm > 120 ? COLORS.dangerBg : bpm > 95 ? COLORS.warningBg : COLORS.successBg }
                ]}>
                  <Text style={[
                    GLOBAL_STYLES.badgeText,
                    { color: bpm > 120 ? COLORS.danger : bpm > 95 ? COLORS.warning : COLORS.success, marginLeft: 0 }
                  ]}>
                    {bpm > 120 ? 'CRITICAL STRAIN' : bpm > 95 ? 'MODERATE STRAIN' : 'SAFE'}
                  </Text>
                </View>
              </View>

              <View style={[
                styles.safetyNoticeBox,
                bpm > 120 ? { backgroundColor: 'rgba(239, 68, 68, 0.15)' } :
                bpm > 95 ? { backgroundColor: 'rgba(245, 158, 11, 0.15)' } :
                { backgroundColor: 'rgba(16, 185, 129, 0.15)' }
              ]}>
                <Icon
                  name={bpm > 120 ? "alert-circle" : bpm > 95 ? "water-alert" : "check-circle"}
                  size={18}
                  color={bpm > 120 ? COLORS.danger : bpm > 95 ? COLORS.warning : COLORS.success}
                />
                <Text style={[
                  styles.safetyNoticeTxt,
                  { color: bpm > 120 ? COLORS.danger : bpm > 95 ? COLORS.warning : COLORS.success }
                ]}>
                  {bpm > 120
                    ? '🚨 High Over-Exertion Heat Stress! Take a mandatory 15-minute shaded work rest & hydrate.'
                    : bpm > 95
                    ? '⚠️ Moderate Thermal Load. Drink water regularly and monitor your breathing.'
                    : '✅ Healthy Thermal Balance. Safe working conditions.'}
                </Text>
              </View>
            </View>

            <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
              <Text style={styles.sectionHeader}>Alert Simulation</Text>

              <View style={styles.anomalyMeterBox}>
                <Text style={styles.anomalyMeterLabel}>Consecutive Abnormal Samples: </Text>
                <Text style={[styles.anomalyMeterVal, consecutiveAbnormal > 0 ? { color: COLORS.warning } : { color: COLORS.success }]}>
                  {consecutiveAbnormal} / 3
                </Text>
              </View>

              <View style={styles.alertSimBtnRow}>
                <TouchableOpacity style={[styles.simActionBtn, styles.simActionBtnWarning]} onPress={triggerSingleNoisySpike} activeOpacity={0.8}>
                  <Text style={[styles.simActionBtnText, { color: '#D97706' }]}>Simulate 1x Vitals Spike</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.simActionBtn, styles.simActionBtnDanger]} onPress={triggerSustainedCritical} activeOpacity={0.8}>
                  <Text style={[styles.simActionBtnText, { color: '#DC2626' }]}>Simulate 3x Sustained</Text>
                </TouchableOpacity>
              </View>
            </View>

          </View>
        )}

        {activeTab === 'fall' && (
          <View style={styles.tabContent}>
            <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleContainer}>
                  <Icon name="run" size={22} color={COLORS.success} />
                  <Text style={styles.cardTitle}>IMU Fall & Movement Status</Text>
                </View>
                <View style={[GLOBAL_STYLES.badge, { backgroundColor: movementState === 'Fall Detected' ? COLORS.dangerBg : COLORS.successBg }]}>
                  <Text style={[GLOBAL_STYLES.badgeText, { color: movementState === 'Fall Detected' ? COLORS.danger : COLORS.success, marginLeft: 0 }]}>
                    {movementState}
                  </Text>
                </View>
              </View>

              <View style={styles.movementBody}>
                <View style={[
                  styles.movementStatusPanel,
                  movementState === 'Active' ? styles.movementStatusPanelActive : movementState === 'Idle' ? styles.movementStatusPanelIdle : styles.movementStatusPanelFall
                ]}>
                  <View style={styles.movementStatusIconCircle}>
                    <Icon
                      name={movementState === 'Active' ? 'walk' : movementState === 'Idle' ? 'pause-circle' : 'alert-octagon'}
                      size={22}
                      color="#FFFFFF"
                    />
                  </View>
                  <Text style={styles.movementStatusText}>
                    {movementState === 'Active' ? `Technician is moving (${movementActivity})` : movementState === 'Idle' ? 'No movement detected (Stationary/Idle state)' : 'IMU SUSPECT FALL DETECTED'}
                  </Text>
                </View>

                <Text style={styles.sectionSubHeader}>Live BMI160 3D Gyroscope Coordinates</Text>
                <View style={styles.gyroGrid}>
                  <View style={styles.gyroBox}>
                    <Text style={styles.gyroAxisLabel}>X-AXIS (Pitch)</Text>
                    <Text style={styles.gyroValueText}>{gyro.gx.toFixed(2)} °/s</Text>
                  </View>
                  <View style={styles.gyroBox}>
                    <Text style={styles.gyroAxisLabel}>Y-AXIS (Roll)</Text>
                    <Text style={styles.gyroValueText}>{gyro.gy.toFixed(2)} °/s</Text>
                  </View>
                  <View style={styles.gyroBox}>
                    <Text style={styles.gyroAxisLabel}>Z-AXIS (Yaw)</Text>
                    <Text style={styles.gyroValueText}>{gyro.gz.toFixed(2)} °/s</Text>
                  </View>
                </View>

                <View style={[
                  styles.heightPanel,
                  manDownActive && { borderColor: COLORS.danger, backgroundColor: 'rgba(239, 68, 68, 0.15)' }
                ]}>
                  <View style={styles.heightHeaderRow}>
                    <Text style={[styles.heightTitle, manDownActive && { color: COLORS.danger }]}>
                      {manDownActive ? '🚨 MAN-DOWN IMMOBILITY ALARM' : 'Man-Down Immobility Protection'}
                    </Text>
                    {manDownActive && (
                      <Text style={[styles.heightValueBig, { color: COLORS.danger }]}>{manDownSeconds}s</Text>
                    )}
                  </View>
                  <Text style={styles.heightSubtext}>
                    {manDownActive
                      ? `Worker motionless! Auto-dispatching emergency SOS alert in ${manDownSeconds} seconds!`
                      : 'Triggers automatic emergency SOS if a worker falls or stays completely motionless for > 20s.'}
                  </Text>

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                    {manDownActive ? (
                      <TouchableOpacity
                        style={[styles.simBtn, { backgroundColor: COLORS.success, borderColor: COLORS.success, flex: 1 }]}
                        onPress={() => {
                          setManDownActive(false);
                          setManDownSeconds(20);
                          if (manDownCountdownRef.current) clearInterval(manDownCountdownRef.current);
                        }}
                      >
                        <Text style={[styles.simBtnTxt, { color: '#FFF', fontWeight: 'bold' }]}>I AM SAFE (CANCEL ALARM)</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[styles.simBtn, { borderColor: COLORS.warning, flex: 1 }]}
                        onPress={() => {
                          setManDownActive(true);
                          setManDownSeconds(20);
                          if (manDownCountdownRef.current) clearInterval(manDownCountdownRef.current);
                          manDownCountdownRef.current = setInterval(() => {
                            setManDownSeconds(prev => {
                              if (prev <= 1) {
                                clearInterval(manDownCountdownRef.current!);
                                setManDownActive(false);
                                handleSimulateFall('confirmed');
                                return 0;
                              }
                              return prev - 1;
                            });
                          }, 1000);
                        }}
                      >
                        <Text style={[styles.simBtnTxt, { color: COLORS.warning }]}>Test 20s Man-Down Countdown</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {lastFall && (
                  <View style={styles.fallLogDetail}>
                    <Icon name="history" size={16} color={COLORS.textSecondary} />
                    <Text style={styles.fallHistoryDesc}>
                      Last Trigger: {new Date(lastFall.timestamp).toLocaleTimeString()} ({lastFall.severity} impact)
                    </Text>
                  </View>
                )}

                <Text style={styles.sectionSubHeader}>Simulate Wearable Fall Events</Text>
                <View style={styles.simButtonsRow}>
                  <TouchableOpacity style={[styles.simBtn, styles.simActionBtnWarning]} onPress={() => handleSimulateFall('minor')} activeOpacity={0.8}>
                    <Text style={[styles.simBtnTxt, { color: '#D97706' }]}>Minor Jolt</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.simBtn, styles.simActionBtnDanger]} onPress={() => handleSimulateFall('confirmed')} activeOpacity={0.8}>
                    <Text style={[styles.simBtnTxt, { color: '#DC2626' }]}>Severe Fall</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        )}

        {activeTab === 'emergency' && (
          <View style={styles.tabContent}>
            <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleContainer}>
                  <Icon name="alert-octagon" size={22} color={COLORS.danger} />
                  <Text style={styles.cardTitle}>SOS Emergency Control</Text>
                </View>
              </View>

              <View style={styles.sosContainer}>
                <Animated.View style={[styles.sosOuterRing, { transform: [{ scale: pulseAnim }] }]}>
                  <TouchableOpacity style={styles.sosBigBtn} onPress={handleSOSPress} disabled={submittingAlert}>
                    <Text style={styles.sosBigBtnText}>SOS</Text>
                    <Text style={styles.sosBigBtnSub}>EMERGENCY PANIC</Text>
                  </TouchableOpacity>
                </Animated.View>

                <Text style={styles.sectionSubHeader}>Emergency Alert Log</Text>
                <View style={styles.alertLog}>
                  {alertHistory.length === 0 ? (
                    <Text style={styles.emptyText}>No emergency alerts logged.</Text>
                  ) : (
                    alertHistory.slice(0, 4).map(alert => (
                      <View key={alert.id} style={styles.alertLogItem}>
                        <View style={styles.alertLogHeader}>
                          <Text style={styles.alertLogTitle}>{alert.type === 'manual' ? 'Manual SOS Panic' : alert.type === 'health' ? 'Health Vitals Danger' : 'Suspected Fall Alert'}</Text>
                          <View style={[GLOBAL_STYLES.badge, { backgroundColor: alert.status === 'active' ? COLORS.dangerBg : COLORS.successBg }]}>
                            <Text style={[GLOBAL_STYLES.badgeText, { color: alert.status === 'active' ? COLORS.danger : COLORS.success, marginLeft: 0 }]}>
                              {alert.status.charAt(0).toUpperCase() + alert.status.slice(1)}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.alertLogTime}>Time: {new Date(alert.timestamp).toLocaleString()}</Text>
                      </View>
                    ))
                  )}
                </View>
              </View>
            </View>
          </View>
        )}

        {activeTab === 'weather' && (
          <View style={styles.tabContent}>
            <View style={[GLOBAL_STYLES.glassCard, styles.weatherSearchContainer]}>
              <View style={styles.weatherSearchRow}>
                <View style={styles.weatherSearchInputWrapper}>
                  <Icon name="magnify" size={20} color="#8B5CF6" />
                  <TextInput
                    style={styles.weatherSearchInput}
                    placeholder="Search city or jobsite..."
                    placeholderTextColor="#94A3B8"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    onSubmitEditing={() => requestLocationAndLoad(searchQuery)}
                    returnKeyType="search"
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => { setSearchQuery(''); requestLocationAndLoad(); }}>
                      <Icon name="close-circle" size={18} color="#94A3B8" />
                    </TouchableOpacity>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.weatherGpsBtn}
                  onPress={() => {
                    setSearchQuery('');
                    requestLocationAndLoad();
                  }}
                  activeOpacity={0.7}
                >
                  <Icon name="crosshairs-gps" size={20} color="#FFFFFF" />
                </TouchableOpacity>
              </View>
            </View>

            {(loadingWeather || gpsLoading) && !weather ? (
              <View style={{ padding: 40, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator size="large" color="#6C5CE7" />
                <Text style={{ marginTop: 12, color: COLORS.textSecondary, fontWeight: '600' }}>Updating site weather...</Text>
              </View>
            ) : weather ? (
              <>
                <View style={[GLOBAL_STYLES.glassCard, styles.card, styles.refCardPeach]}>
                  <View style={styles.cardHeader}>
                    <View style={styles.cardTitleContainer}>
                      <Icon name="weather-partly-cloudy" size={22} color={COLORS.warning} />
                      <Text style={styles.cardTitle}>Site Weather Conditions</Text>
                      {weather.locationName && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 28, marginTop: -2, gap: 4 }}>
                          <Icon name="map-marker" size={14} color="#EA580C" />
                          <Text style={{ fontSize: 13, color: '#C2410C', fontWeight: '700' }}>
                            {weather.locationName}{weather.country ? `, ${weather.country}` : ''}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={[GLOBAL_STYLES.badge, { backgroundColor: weather.safeToWork ? COLORS.successBg : COLORS.dangerBg }]}>
                      <Text style={[GLOBAL_STYLES.badgeText, { color: weather.safeToWork ? COLORS.success : COLORS.danger, marginLeft: 0 }]}>
                        {weather.safeToWork ? 'Safe to Work' : 'Work Suspended'}
                      </Text>
                    </View>
                  </View>
                  {weather.description && (
                    <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 4, marginLeft: 28 }}>
                      Condition: <Text style={{ fontWeight: '700', color: COLORS.text }}>{weather.description}</Text>
                    </Text>
                  )}
                </View>

                <View style={[GLOBAL_STYLES.glassCard, styles.weatherFullContainer, styles.refCardAmber]}>
                  <View style={styles.weatherItemLeft}>
                    <View style={[styles.weatherIconCircle, { backgroundColor: 'rgba(255, 255, 255, 0.88)' }]}>
                      <Icon name="thermometer" size={24} color="#D97706" />
                    </View>
                    <View>
                      <Text style={[styles.weatherItemTitle, { color: COLORS.cardAmberText }]}>Temperature</Text>
                      <Text style={styles.weatherItemSub}>
                        Feels like {weather.feelsLike ?? weather.temperature}°C
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.weatherItemValue, { color: '#B45309' }]}>{weather.temperature}°C</Text>
                </View>

                <View style={[GLOBAL_STYLES.glassCard, styles.weatherFullContainer, styles.refCardMint]}>
                  <View style={styles.weatherItemLeft}>
                    <View style={[styles.weatherIconCircle, { backgroundColor: 'rgba(255, 255, 255, 0.88)' }]}>
                      <Icon name="weather-windy" size={24} color="#2563EB" />
                    </View>
                    <View>
                      <Text style={[styles.weatherItemTitle, { color: COLORS.cardMintText }]}>Wind Speed</Text>
                      <Text style={styles.weatherItemSub}>
                        {weather.windSpeedKnots ?? Math.round((weather.windSpeedKmH ?? weather.windSpeed) * 0.54)} kn · {weather.windSpeedMs ?? ((weather.windSpeedKmH ?? weather.windSpeed) / 3.6).toFixed(1)} m/s
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.weatherItemValue, { color: '#0F766E' }, (weather.windSpeedKmH ?? weather.windSpeed) > 38 && { color: COLORS.danger }]}>
                    {weather.windSpeedKmH ?? weather.windSpeed} km/h
                  </Text>
                </View>

                <View style={[GLOBAL_STYLES.glassCard, styles.weatherFullContainer, styles.refCardLilac]}>
                  <View style={styles.weatherItemLeft}>
                    <View style={[styles.weatherIconCircle, { backgroundColor: 'rgba(255, 255, 255, 0.88)' }]}>
                      <Icon name="weather-rainy" size={24} color="#0D9488" />
                    </View>
                    <View>
                      <Text style={[styles.weatherItemTitle, { color: COLORS.cardLilacText }]}>Rainfall</Text>
                      <Text style={styles.weatherItemSub}>
                        Humidity: {weather.humidity}% · {weather.description}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.weatherItemValue, { color: '#6D28D9' }]}>{weather.precipitation} mm</Text>
                </View>

                {weather.hazards && weather.hazards.length > 0 && (
                  <View style={styles.weatherWarningBox}>
                    <Icon name="weather-lightning" size={18} color={COLORS.danger} style={{ marginRight: 6 }} />
                    <Text style={styles.weatherWarningText}>Active Hazards: {weather.hazards.join(', ')}</Text>
                  </View>
                )}

                {weather.recommendation && (
                  <View style={[styles.safetyNoticeBox, { marginTop: 10 }]}>
                    <Icon name="shield-check" size={18} color={weather.safeToWork ? '#059669' : '#DC2626'} style={{ marginRight: 8 }} />
                    <Text style={[styles.safetyNoticeTxt, { color: weather.safeToWork ? '#065F46' : '#991B1B' }]}>
                      {weather.recommendation}
                    </Text>
                  </View>
                )}
              </>
            ) : null}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={fallModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setFallModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.fallModalContent}>
            <View style={styles.fallModalHeader}>
              <View style={styles.fallModalIconCircle}>
                <Icon name="alert-octagon" size={40} color="#DC2626" />
              </View>
              <Text style={styles.fallModalTitle}>🚨 FALL IMPACT DETECTED! 🚨</Text>
            </View>

            <Text style={styles.fallModalBodyText}>
              The wearable safety band has detected a high-impact fall for worker {user.name}. Emergency response dispatched!
            </Text>

            <View style={styles.fallModalDetailsBox}>
              <Text style={styles.fallModalDetailTxt}>📍 Location: Site GPS Coordinates Attached</Text>
              <Text style={styles.fallModalDetailTxt}>⏰ Time: {new Date().toLocaleTimeString()}</Text>
              <Text style={styles.fallModalDetailTxt}>🚨 Status: Supervisor Admin Notified</Text>
            </View>

            <View style={styles.fallModalActionRow}>
              <TouchableOpacity
                style={[styles.fallModalBtn, styles.fallModalBtnSafe]}
                onPress={() => {
                  setFallModalVisible(false);
                  setMovementState('Active');
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.fallModalBtnTxt}>I AM SAFE (DISMISS)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.fallModalBtn, styles.fallModalBtnSos]}
                onPress={() => {
                  setFallModalVisible(false);
                  setActiveTab('emergency');
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.fallModalBtnTxt}>CALL SOS HELP</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={logoutModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setLogoutModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.logoutModalContent}>
            <View style={styles.logoutModalHeader}>
              <View style={styles.logoutModalIconCircle}>
                <Icon name="logout" size={32} color="#DC2626" />
              </View>
              <Text style={styles.logoutModalTitle}>Confirm Log Out</Text>
            </View>

            <Text style={styles.logoutModalBodyText}>
              Are you sure you want to log out, <Text style={{ fontWeight: '800', color: '#1E1B4B' }}>{user.name}</Text>?
              {'\n\n'}Your shift attendance will be recorded and you will be clocked out automatically.
            </Text>

            <View style={styles.logoutModalActionRow}>
              <TouchableOpacity
                style={[styles.logoutModalBtn, styles.logoutModalBtnCancel]}
                onPress={() => setLogoutModalVisible(false)}
                activeOpacity={0.8}
              >
                <Text style={styles.logoutModalBtnCancelTxt}>CANCEL</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.logoutModalBtn, styles.logoutModalBtnConfirm]}
                onPress={handlePerformLogout}
                activeOpacity={0.8}
                disabled={isLoggingOut}
              >
                {isLoggingOut ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.logoutModalBtnConfirmTxt}>LOG OUT</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <View style={styles.dashBottomNav}>
        <View style={styles.dashBottomNavContent}>
          <TouchableOpacity
            style={[styles.dashNavItem, activeTab === 'dashboard' && styles.dashNavItemActive]}
            onPress={() => setActiveTab('dashboard')}
          >
            <Icon name="home-variant" size={24} color={activeTab === 'dashboard' ? '#FFFFFF' : '#8B5CF6'} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dashNavItem, activeTab === 'health' && styles.dashNavItemActive]}
            onPress={() => setActiveTab('health')}
          >
            <Icon name="heart-pulse" size={24} color={activeTab === 'health' ? '#FFFFFF' : '#8B5CF6'} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dashNavItem, activeTab === 'fall' && styles.dashNavItemActive]}
            onPress={() => setActiveTab('fall')}
          >
            <Icon name="walk" size={24} color={activeTab === 'fall' ? '#FFFFFF' : '#8B5CF6'} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.dashNavItem, activeTab === 'emergency' && styles.dashNavItemActive]}
            onPress={() => setActiveTab('emergency')}
          >
            <Icon name="alert-octagon" size={24} color={activeTab === 'emergency' ? '#FFFFFF' : '#EF4444'} />
          </TouchableOpacity>
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 80,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1.5,
    borderBottomColor: 'rgba(255, 255, 255, 0.85)',
    backgroundColor: 'rgba(255, 255, 255, 0.75)',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 10,
    zIndex: 999,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}),
  },
  userName: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  roleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  userRole: {
    color: COLORS.success,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginLeft: 4,
    fontWeight: TYPOGRAPHY.weights.medium,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  connectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' } : {}),
  },
  connectionBadgeOff: {
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderColor: 'rgba(255, 255, 255, 0.95)',
  },
  connectionBadgeConnected: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderColor: 'rgba(16, 185, 129, 0.4)',
  },
  connectionBadgeWarning: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  connectionText: {
    fontSize: 12,
    marginLeft: 5,
    fontWeight: '800',
  },
  logoutButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
  },
  headerLogoutBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(254, 226, 226, 0.95)',
    borderWidth: 1.5,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  headerAvatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dashboardLogoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(254, 226, 226, 0.9)',
    borderWidth: 1.5,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginTop: 14,
    marginBottom: 20,
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 3,
  },
  dashboardLogoutBtnTxt: {
    color: '#DC2626',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  logoutModalContent: {
    width: '88%',
    maxWidth: 380,
    borderRadius: 28,
    padding: 24,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
  },
  logoutModalHeader: {
    alignItems: 'center',
    marginBottom: 12,
  },
  logoutModalIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: 'rgba(254, 226, 226, 0.95)',
    borderWidth: 1.5,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  logoutModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1E1B4B',
  },
  logoutModalBodyText: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 22,
  },
  logoutModalActionRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  logoutModalBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutModalBtnCancel: {
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  logoutModalBtnCancelTxt: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '700',
  },
  logoutModalBtnConfirm: {
    backgroundColor: '#DC2626',
    shadowColor: '#DC2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  logoutModalBtnConfirmTxt: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  tabContent: {
    gap: 16,
  },
  bleCard: {
    borderWidth: 1,
    borderColor: 'rgba(96, 165, 250, 0.2)',
  },
  bleButtonRow: {
    marginBottom: 12,
  },
  bleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  bleBtnConnect: {
    backgroundColor: COLORS.primary,
  },
  bleBtnDisconnect: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: COLORS.danger,
  },
  bleBtnText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.semibold,
  },
  sensorPillsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  sensorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceLight,
  },
  sensorPillText: {
    fontSize: TYPOGRAPHY.sizes.xs - 1,
    color: COLORS.textMuted,
    fontWeight: TYPOGRAPHY.weights.medium,
  },
  dataSourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dataSourceText: {
    fontSize: TYPOGRAPHY.sizes.xs - 1,
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
  card: {
    marginBottom: 0,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  cardSubtitle: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginBottom: 12,
    lineHeight: 16,
  },
  vitalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  gaugeBox: {
    alignItems: 'center',
    flex: 1.1,
  },
  gaugeHeader: {
    color: COLORS.textMuted,
    fontSize: 8,
    fontWeight: TYPOGRAPHY.weights.bold,
    letterSpacing: 0.5,
    marginBottom: 6,
    textAlign: 'center',
  },
  circleGauge: {
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 3.5,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  gaugeNum: {
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  gaugeUnit: {
    color: COLORS.textSecondary,
    fontSize: 8,
    marginTop: -2,
  },
  cadenceCheckin: {
    flex: 1.4,
    borderLeftWidth: 1,
    borderLeftColor: COLORS.border,
    paddingLeft: 12,
    alignItems: 'flex-start',
    gap: 4,
  },
  cadenceTitle: {
    color: COLORS.textMuted,
    fontSize: 8,
    fontWeight: TYPOGRAPHY.weights.bold,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  cadenceBullet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  bulletDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.primaryLight,
  },
  cadenceTxt: {
    color: COLORS.textSecondary,
    fontSize: 9,
  },
  forceCheckinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: 4,
  },
  forceCheckinText: {
    color: COLORS.text,
    fontSize: 9,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  ppgCanvas: {
    height: 90,
    backgroundColor: 'rgba(240, 235, 255, 0.75)',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    paddingHorizontal: 8,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' } : {}),
  },
  ppgPointsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: '100%',
    paddingBottom: 8,
  },
  ppgBarContainer: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    flex: 1,
  },
  ppgPeakDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: COLORS.danger,
    position: 'absolute',
    bottom: 74,
  },
  ppgWaveBar: {
    width: 4,
    backgroundColor: COLORS.primaryLight,
    borderRadius: 2,
  },
  sectionHeader: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.bold,
    marginBottom: 8,
  },
  anomalyMeterBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  anomalyMeterLabel: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
  },
  anomalyMeterVal: {
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  alertSimBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  simActionBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}),
  },
  simActionBtnWarning: {
    backgroundColor: 'rgba(255, 251, 235, 0.85)',
    borderColor: 'rgba(245, 158, 11, 0.6)',
  },
  simActionBtnDanger: {
    backgroundColor: 'rgba(254, 242, 242, 0.85)',
    borderColor: 'rgba(239, 68, 68, 0.6)',
  },
  simActionBtnText: {
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  simBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 20,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}),
  },
  simBtnTxt: {
    fontSize: 13,
    fontWeight: '800',
    textAlign: 'center',
  },
  techBullet: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingBottom: 10,
    marginBottom: 10,
  },
  techBulletTitle: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  techBulletDesc: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs - 1,
    marginTop: 2,
    lineHeight: 14,
  },

  movementBody: {
    gap: 12,
  },
  movementDetailLabel: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
  },
  movementStatusPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 28,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 8,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(24px) saturate(200%)', WebkitBackdropFilter: 'blur(24px) saturate(200%)' } : {}),
  },
  movementStatusPanelActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.82)',
    shadowColor: '#10B981',
    shadowOpacity: 0.28,
  },
  movementStatusPanelIdle: {
    backgroundColor: 'rgba(108, 92, 231, 0.82)',
    shadowColor: '#6C5CE7',
    shadowOpacity: 0.28,
  },
  movementStatusPanelFall: {
    backgroundColor: 'rgba(239, 68, 68, 0.88)',
    shadowColor: '#EF4444',
    shadowOpacity: 0.3,
  },
  movementStatusIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  movementStatusText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 12,
    textAlign: 'center',
  },
  fallLogDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.6)',
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.8)',
  },
  fallHistoryDesc: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
  },
  sectionSubHeader: {
    color: '#4C1D95',
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
    marginTop: 8,
  },
  simButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },

  clockBtn: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  clockBtnText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  gpsPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surfaceLight,
    padding: 8,
    borderRadius: 8,
    marginBottom: 10,
  },
  gpsText: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
  },
  taskList: {
    gap: 8,
    marginTop: 8,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 8,
    padding: 10,
  },
  taskRowDone: {
    opacity: 0.6,
  },
  taskRowTxt: {
    flex: 1,
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
  },
  taskRowTxtDone: {
    textDecorationLine: 'line-through',
    color: COLORS.textSecondary,
  },
  taskRowBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: COLORS.surface,
  },
  taskRowBadge_done: {
    backgroundColor: COLORS.successBg,
  },
  taskRowBadgeTxt: {
    fontSize: 8,
    fontWeight: TYPOGRAPHY.weights.bold,
    color: COLORS.textSecondary,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontStyle: 'italic',
  },
  attendanceLog: {
    gap: 6,
    marginTop: 8,
  },
  attendanceLogItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  attendanceLogTxt: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
  },

  sosContainer: {
    alignItems: 'center',
    gap: 20,
    marginVertical: 10,
  },
  sosOuterRing: {
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: COLORS.dangerBg,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  sosBigBtn: {
    width: 106,
    height: 106,
    borderRadius: 53,
    backgroundColor: COLORS.danger,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: COLORS.danger,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  sosBigBtnText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.xxl,
    fontWeight: TYPOGRAPHY.weights.black,
  },
  sosBigBtnSub: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 7,
    fontWeight: TYPOGRAPHY.weights.bold,
    marginTop: 2,
  },
  alertLog: {
    width: '100%',
    gap: 8,
    marginTop: 8,
  },
  alertLogItem: {
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 10,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 4,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}),
  },
  alertLogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  alertLogTitle: {
    color: '#1E1B4B',
    fontSize: 15,
    fontWeight: '800',
  },
  alertLogTime: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },

  weatherSearchContainer: {
    padding: 8,
    marginBottom: 14,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.65)',
  },
  weatherSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  weatherSearchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(108, 92, 231, 0.2)',
  },
  weatherSearchInput: {
    flex: 1,
    height: '100%',
    color: '#1E1B4B',
    fontSize: 14,
    fontWeight: '600',
  },
  weatherGpsBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#6C5CE7',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  weatherFullContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderRadius: 24,
    paddingVertical: 20,
    paddingHorizontal: 22,
    marginBottom: 16,
    minHeight: 100,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 18,
    elevation: 5,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}),
  },
  weatherItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  weatherIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' } : {}),
  },
  weatherItemTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#1E1B4B',
  },
  weatherItemSub: {
    fontSize: 12,
    fontWeight: '500',
    color: '#64748B',
    marginTop: 2,
  },
  weatherItemValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#4C1D95',
  },
  weatherWarningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.dangerBg,
    padding: 12,
    borderRadius: 14,
    marginTop: 4,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  weatherWarningText: {
    color: COLORS.danger,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: TYPOGRAPHY.weights.semibold,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' } : {}),
  },
  fallModalContent: {
    width: '94%',
    maxWidth: 440,
    borderRadius: 32,
    padding: 26,
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: 2,
    borderColor: 'rgba(239, 68, 68, 0.6)',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 12,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(28px) saturate(190%)', WebkitBackdropFilter: 'blur(28px) saturate(190%)' } : {}),
  },
  fallModalHeader: {
    alignItems: 'center',
    marginBottom: 14,
  },
  fallModalIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(254, 242, 242, 0.95)',
    borderWidth: 2,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 4,
  },
  fallModalTitle: {
    color: '#DC2626',
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  fallModalBodyText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 18,
  },
  fallModalDetailsBox: {
    width: '100%',
    backgroundColor: 'rgba(245, 240, 255, 0.85)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 22,
    gap: 8,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
    elevation: 2,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' } : {}),
  },
  fallModalDetailTxt: {
    color: '#4C1D95',
    fontSize: 13,
    fontWeight: '700',
  },
  fallModalActionRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  fallModalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.6)',
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 12,
    shadowOpacity: 0.2,
    elevation: 4,
  },
  fallModalBtnSafe: {
    backgroundColor: 'rgba(16, 185, 129, 0.92)',
    shadowColor: '#10B981',
  },
  fallModalBtnSos: {
    backgroundColor: 'rgba(239, 68, 68, 0.95)',
    shadowColor: '#EF4444',
  },
  fallModalBtnTxt: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0.5,
  },

  fallOverlay: {
    backgroundColor: COLORS.dangerBg,
    borderColor: COLORS.danger,
    borderWidth: 1.5,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  fallOverlayTitle: {
    color: COLORS.danger,
    fontSize: TYPOGRAPHY.sizes.xl,
    fontWeight: TYPOGRAPHY.weights.black,
    marginTop: 8,
  },
  fallOverlaySubtitle: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 2,
  },
  fallOverlayTimer: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.giant,
    fontWeight: TYPOGRAPHY.weights.black,
    marginVertical: 10,
  },
  cancelFallButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surfaceLight,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cancelFallButtonText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
  },

  bottomTabBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 60,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 14 : 0,
  },
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    height: '100%',
  },
  tabItemActive: {
    borderTopWidth: 2,
    borderTopColor: COLORS.primaryLight,
  },
  tabLabel: {
    color: COLORS.textSecondary,
    fontSize: 9,
    fontWeight: TYPOGRAPHY.weights.medium,
    marginTop: 2,
  },
  tabLabelActive: {
    color: COLORS.text,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.dangerBg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(239, 68, 68, 0.2)',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  offlineBannerText: {
    color: COLORS.danger,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.semibold,
  },

  dashboardContainer: {
    paddingHorizontal: 8,
    paddingTop: 10,
  },
  dashHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  dashWelcome: {
    color: '#6B21A8',
    fontSize: 16,
    fontWeight: '600',
  },
  dashTitle: {
    color: '#4C1D95',
    fontSize: 26,
    fontWeight: '800',
    marginTop: 2,
  },
  dashAvatarContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#FFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4C1D95',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  dashSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 30,
    gap: 12,
  },
  dashNotifBtn: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: '#E9D5FF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dashSearchBox: {
    flex: 1,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#F3E8FF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    gap: 10,
  },
  dashSearchInput: {
    color: COLORS.text,
    fontSize: 16,
    flex: 1,
    height: '100%',
  },
  dashSectionTitle: {
    color: '#4C1D95',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 16,
  },
  sosFullBanner: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(254, 226, 226, 0.78)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 24,
    paddingVertical: 18,
    paddingHorizontal: 20,
    marginBottom: 20,
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}),
  },
  sosBannerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  sosBannerIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#EF4444',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  sosBannerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#991B1B',
    letterSpacing: 0.3,
  },
  dashServicePill: {
    backgroundColor: '#F3E8FF',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  dashServiceLabel: {
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  dashPostsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  dashSeeAll: {
    color: '#4C1D95',
    fontWeight: '600',
    fontSize: 14,
  },
  dashPostCard: {
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#4C1D95',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 3,
  },
  dashPostCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  dashPostAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#4C1D95',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dashPostMeta: {
    flex: 1,
  },
  dashPostAuthor: {
    color: '#1F2937',
    fontSize: 14,
    fontWeight: '700',
  },
  dashPostRole: {
    color: '#6B7280',
    fontWeight: '400',
  },
  dashPostSubtitle: {
    color: '#9CA3AF',
    fontSize: 12,
  },
  dashPostContent: {
    color: '#374151',
    fontSize: 14,
    lineHeight: 20,
  },
  dashBottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 80,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  dashBottomNavContent: {
    backgroundColor: 'rgba(255, 255, 255, 0.48)',
    height: 70,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    borderBottomWidth: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 20 : 0,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: -10 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 20,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(32px) saturate(220%)', WebkitBackdropFilter: 'blur(32px) saturate(220%)' } : {}),
  },
  dashNavItem: {
    padding: 10,
  },
  gyroGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 10,
    gap: 8,
  },
  gyroBox: {
    flex: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderRadius: 14,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' } : {}),
  },
  gyroAxisLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#64748B',
    marginBottom: 4,
  },
  gyroValueText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#6D28D9',
  },
  heightPanel: {
    backgroundColor: 'rgba(245, 240, 255, 0.85)',
    borderRadius: 18,
    padding: 16,
    marginVertical: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 3,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' } : {}),
  },
  heightHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  heightTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4C1D95',
  },
  heightValueBig: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.success,
  },
  heightSubtext: {
    fontSize: 12,
    color: '#6D28D9',
    marginTop: 4,
    lineHeight: 17,
  },
  safetyNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    padding: 8,
    borderRadius: 8,
  },
  safetyNoticeTxt: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
  },

  refHeroContainer: {
    borderRadius: 32,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 10,
  },
  refHeroTopRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    position: 'relative',
    minHeight: 36,
  },
  refWeatherWidget: {
    position: 'absolute',
    left: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  refWeatherText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  refHeroTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  refWatchBadge: {
    position: 'absolute',
    right: 0,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refWatchDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  refHeroStatsRow: {
    width: '100%',
    alignSelf: 'stretch',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.26)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.78)',
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginTop: 14,
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 5,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(24px) saturate(200%) brightness(110%)', WebkitBackdropFilter: 'blur(24px) saturate(200%) brightness(110%)' } : {}),
  },
  refHeroStatItem: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  refHeroStatLabel: {
    color: 'rgba(255, 255, 255, 0.90)',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 3,
    textAlign: 'center',
  },
  refHeroStatValue: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  refHeroStatUnit: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.95)',
  },
  refHeroStatDivider: {
    width: 1.5,
    height: 28,
    borderRadius: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.50)',
  },
  refGridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 16,
    width: '100%',
  },
  refCard: {
    width: '48.5%',
    minHeight: 135,
    borderRadius: 24,
    padding: 14,
    marginBottom: 12,
    justifyContent: 'space-between',
    borderWidth: 1.5,
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 4,
    ...(Platform.OS === 'web' ? { backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)' } : {}),
  },
  refCardPeach: {
    backgroundColor: COLORS.cardPeach,
    borderColor: COLORS.cardPeachBorder,
  },
  refCardLilac: {
    backgroundColor: COLORS.cardLilac,
    borderColor: COLORS.cardLilacBorder,
  },
  refCardMint: {
    backgroundColor: COLORS.cardMint,
    borderColor: COLORS.cardMintBorder,
  },
  refCardAmber: {
    backgroundColor: COLORS.cardAmber,
    borderColor: COLORS.cardAmberBorder,
  },
  refCardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  refCardTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  refCardCenterBody: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  refPeachCenterCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF6B4A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
  },
  refPeachNumText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#FF6B4A',
  },
  refPeachSubText: {
    fontSize: 9,
    fontWeight: '600',
    color: '#94A3B8',
  },
  refLilacFooterRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: 4,
    marginTop: 2,
  },
  refLilacBpmVal: {
    fontSize: 18,
    fontWeight: '800',
    color: '#6D28D9',
  },
  refLilacBpmUnit: {
    fontSize: 11,
    fontWeight: '600',
    color: '#8B5CF6',
  },
  refMintFooterText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F766E',
    marginTop: 2,
    textAlign: 'center',
  },
  refMintUnit: {
    fontSize: 11,
    fontWeight: '500',
    color: '#14B8A6',
  },
  refAmberRingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  refAmberRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 4,
    borderColor: '#F59E0B',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refAmberRingNum: {
    fontSize: 14,
    fontWeight: '800',
    color: '#B45309',
  },
  refAmberRingUnit: {
    fontSize: 8,
    fontWeight: '700',
    color: '#F59E0B',
  },
  dashNavItemActive: {
    backgroundColor: '#6C5CE7',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    shadowColor: '#6C5CE7',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 6,
  },
});

