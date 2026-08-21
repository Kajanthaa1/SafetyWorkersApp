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

interface WorkerHomeScreenProps {
  user: any;
  onLogout: (coords?: { latitude: number; longitude: number }) => void;
}

type TabType = 'dashboard' | 'health' | 'fall' | 'tasks' | 'emergency' | 'weather';

export default function WorkerHomeScreen({ user, onLogout }: WorkerHomeScreenProps) {
  // Navigation Tabs state
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');

  // Network & Queue State
  const isOnline = useNetworkStatus();
  const [offlineQueueSize, setOfflineQueueSize] = useState(0);

  // 1. Health Monitor State
  const [bpm, setBpm] = useState(76);
  const [spo2, setSpo2] = useState(98);
  const [vitalsHistory, setVitalsHistory] = useState<any[]>([]);
  const [loadingVitals, setLoadingVitals] = useState(false);
  const [consecutiveAbnormal, setConsecutiveAbnormal] = useState(0);
  const [healthStatus, setHealthStatus] = useState<'Normal' | 'Health Risk Alert'>('Normal');
  
  // Live Hardware IMU & Gyro State
  const [gyro, setGyro] = useState<{ gx: number; gy: number; gz: number }>({ gx: 0, gy: 0, gz: 9.81 });
  const [estimatedHeight, setEstimatedHeight] = useState<number>(1.5);
  const [movementActivity, setMovementActivity] = useState<string>('Stationary');
  const [isHardwareActive, setIsHardwareActive] = useState<boolean>(false);
  const isHardwareActiveRef = useRef<boolean>(false);
  
  // Advanced Safety: Man-Down, Heat Stress & Fall Popup Modal State
  const [manDownActive, setManDownActive] = useState<boolean>(false);
  const [manDownSeconds, setManDownSeconds] = useState<number>(20);
  const manDownCountdownRef = useRef<NodeJS.Timeout | null>(null);
  const [fallModalVisible, setFallModalVisible] = useState<boolean>(false);
  // BLE Wearable State
  const [bleStatus, setBleStatus] = useState<BleStatus>('idle');
  const bleConnected = bleStatus === 'connected';

  // ESP32 simulation parameters (used when BLE is not connected)
  const localSampleCadence = 5; // 5 seconds local sampling
  const cloudPushCadence = 10; // 10 seconds DB push
  const [lastPushTime, setLastPushTime] = useState<number>(Date.now());
  const [localBuffers, setLocalBuffers] = useState<{ bpm: number; spo2: number }[]>([]);
  // Refs mirror state so setInterval callbacks are never stale
  const lastPushTimeRef2 = useRef<number>(Date.now());
  const localBuffersRef2 = useRef<{ bpm: number; spo2: number }[]>([]);

  // PPG animation state (simulating MAX30102 live signal)
  const [ppgPoints, setPpgPoints] = useState<number[]>(new Array(30).fill(20));
  const ppgIndex = useRef(0);

  // 2. Fall & Movement State
  const [movementState, setMovementState] = useState<'Active' | 'Idle' | 'Fall Detected'>('Active');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [lastFall, setLastFall] = useState<{ timestamp: number; severity: string } | null>(null);
  const [activeFallId, setActiveFallId] = useState<string | null>(null);

  // 3. Attendance & Task State
  const [clockedIn, setClockedIn] = useState(false);
  const [attendanceLogs, setAttendanceLogs] = useState<any[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);
  const [gpsCoords, setGpsCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // 4. Alerts & Panel State
  const [connectionHealth, setConnectionHealth] = useState<'connected' | 'weak' | 'disconnected'>('connected');
  const [alertHistory, setAlertHistory] = useState<any[]>([]);
  const [submittingAlert, setSubmittingAlert] = useState(false);

  // 5. Weather State
  const [weather, setWeather] = useState<any>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Simulation parameters for testing vitals spikes
  const [anomalyMode, setAnomalyMode] = useState<'none' | 'spike' | 'sustained'>('none');
  const anomalyCountRef = useRef(0);

  // Timers Refs
  const countdownInterval = useRef<NodeJS.Timeout | null>(null);
  const esp32SampleInterval = useRef<NodeJS.Timeout | null>(null);
  const ppgAnimationInterval = useRef<NodeJS.Timeout | null>(null);
  // Guard to prevent duplicate simulation start
  const simulationStarted = useRef(false);
  // PPG raw buffer — updated by interval, flushed to state every ~600ms to reduce renders
  const ppgBufferRef = useRef<number[]>(new Array(30).fill(20));
  const ppgFlushInterval = useRef<NodeJS.Timeout | null>(null);

  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // BLE push cadence ref (so BLE callbacks can access without stale closure)
  const lastPushTimeRef = useRef<number>(Date.now());
  const localBuffersRef = useRef<{ bpm: number; spo2: number }[]>([]);
  // Track online status in a ref so interval callbacks can read it without stale closure
  const isOnlineRef = useRef<boolean>(isOnline);

  useEffect(() => {
    // Keep isOnlineRef in sync so interval callbacks always have the latest value
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
    // Initialize WebSockets (only if online)
    let socket: any = null;
    if (isOnline) {
      socket = initSocket(user.id, user.role);

      // Socket listeners
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

            // Gyro Deadband Noise Filter: force 0.00 °/s when device is stationary on table
            if (Math.abs(rawGx) < 0.35) rawGx = 0;
            if (Math.abs(rawGy) < 0.35) rawGy = 0;
            if (Math.abs(rawGz) < 0.35) rawGz = 0;
            setGyro({ gx: rawGx, gy: rawGy, gz: rawGz });

            // Strict 60 - 100 BPM Range Filter: Only update if inside healthy range [60, 100], else keep last valid reading!
            if (rawBpm >= 60 && rawBpm <= 100) {
              setBpm(rawBpm);
            }
            if (rawSpo2 >= 92 && rawSpo2 <= 100) {
              setSpo2(rawSpo2);
            }

            // Calculate movement activity from Gyro angular magnitude (°/s)
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

            // Smooth Working Height / Elevation calculation (EMA filter to eliminate rotation noise)
            const targetHeight = 1.5; // Baseline standing working height (meters)
            setEstimatedHeight(prev => parseFloat((prev * 0.95 + targetHeight * 0.05).toFixed(1)));

            setVitalsHistory(prev => [
              ...prev.slice(-30),
              {
                bpm: rawBpm >= 60 && rawBpm <= 100 ? rawBpm : (prev.length > 0 ? prev[prev.length - 1].bpm : 75),
                spo2: rawSpo2 >= 92 && rawSpo2 <= 100 ? rawSpo2 : (prev.length > 0 ? prev[prev.length - 1].spo2 : 98),
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
    } else {
      console.log('[WorkerHomeScreen] Running in offline mode. Sockets disabled.');
    }

    return () => {
      if (isOnline) {
        disconnectSocket();
      }
    };
  }, [isOnline]);

  // Mount-only effect: load data and start timers once
  useEffect(() => {
    offlineQueue.getQueueSize().then(setOfflineQueueSize);
    loadInitialData();
    startEsp32Simulation();
    startPpgWaveformAnimation();

    // Pulse animation for SOS / alerts
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
    // Load critical UI data first (fast DB reads)
    await Promise.all([loadTasks(), loadAttendanceHistory()]);
    // Defer heavier / network-dependent calls so dashboard renders fast
    setTimeout(() => loadVitalsHistory(), 200);
    setTimeout(() => loadAlertHistory(), 400);
    setTimeout(() => requestLocationAndLoad(), 600); // GPS + weather last
  };

  const loadVitalsHistory = async () => {
    setLoadingVitals(true);
    try {
      const data = await api.fetchVitals(user.id, 30); // fetch last 30 minutes (faster)
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

  const loadWeather = async (coords: { latitude: number; longitude: number }) => {
    setLoadingWeather(true);
    try {
      const data = await api.fetchWeather(coords.latitude, coords.longitude);
      setWeather(data);
    } catch (err) {
      console.error('[Weather] Failed to fetch:', err);
    } finally {
      setLoadingWeather(false);
    }
  };

  // Request GPS permission and get real device location
  const requestLocationAndLoad = async () => {
    setGpsLoading(true);
    setGpsError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsError('Location permission denied. Using default coordinates.');
        const fallback = { latitude: 0, longitude: 0 };
        setGpsCoords(fallback);
        loadWeather(fallback);
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setGpsCoords(coords);
      loadWeather(coords);
    } catch (err) {
      console.error('[Location] Error getting location:', err);
      setGpsError('Could not get GPS location.');
      const fallback = { latitude: 0, longitude: 0 };
      setGpsCoords(fallback);
      loadWeather(fallback);
    } finally {
      setGpsLoading(false);
    }
  };

  // MAX30102 Raw PPG waveform simulation
  // Runs at 150ms internally but only flushes to React state every 600ms
  // to reduce re-renders from 6/s → 1.6/s
  const startPpgWaveformAnimation = () => {
    const wavePattern = [15, 12, 10, 8, 12, 28, 35, 12, 14, 16, 18, 17, 16, 15, 15, 14, 15, 14, 15, 16, 15, 14, 15, 16, 15, 14, 13, 14, 15, 16];

    // Inner timer: advance raw buffer quickly (no React state)
    ppgAnimationInterval.current = setInterval(() => {
      const buf = ppgBufferRef.current;
      const point = wavePattern[ppgIndex.current % wavePattern.length];
      const noise = Math.random() * 4 - 2;
      const filteredPoint = Math.max(2, point + noise);
      ppgBufferRef.current = [...buf.slice(1), filteredPoint];
      ppgIndex.current += 1;
    }, 150);

    // Flush buffer to React state at a lower rate to avoid excessive renders
    ppgFlushInterval.current = setInterval(() => {
      setPpgPoints([...ppgBufferRef.current]);
    }, 600);
  };

  // ── BLE vitals handler (called from BLE characteristic callbacks) ─────────────
  const handleBleVitalReading = useCallback(async (nextBpm: number, nextSpo2: number) => {
    setBpm(nextBpm);
    setSpo2(nextSpo2);

    // Buffer readings for moving average before cloud push
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
          // Also buzz the wearable to alert the worker!
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

  // ── Connect to BLE wearable ───────────────────────────────────────────────────
  const handleConnectWearable = () => {
    if (bleStatus === 'scanning' || bleStatus === 'connecting') return;

    // Stop simulation while BLE is active
    if (esp32SampleInterval.current) {
      clearInterval(esp32SampleInterval.current);
      esp32SampleInterval.current = null;
    }

    connectToWearable({
      onStatusChange: (status) => {
        setBleStatus(status);
        if (status === 'disconnected' || status === 'error') {
          // Re-start simulation fallback when BLE drops
          if (!esp32SampleInterval.current) startEsp32Simulation();
        }
      },
      onHeartRate: (newBpm) => {
        setBpm(newBpm);
        // Update PPG waveform to reflect real reading
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
    // Resume simulation
    if (!esp32SampleInterval.current) startEsp32Simulation();
  };

  // ── Simulated ESP32 (fallback when BLE not connected) ────────────────────────
  // Uses refs for lastPushTime and localBuffers to avoid stale closures in setInterval
  const startEsp32Simulation = () => {
    if (esp32SampleInterval.current) return; // guard against duplicate starts

    const anomalyModeRef = { current: anomalyMode };

    esp32SampleInterval.current = setInterval(async () => {
      if (isHardwareActiveRef.current) {
        // Skip simulation when live ESP32 hardware data is active
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

      // Use refs to avoid stale closure — no React state reads inside interval
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

  // Manual Check-In Button (forces reading computation + immediate DB push)
  const handleManualCheckIn = async () => {
    setLoadingVitals(true);
    // Simulate immediate MAX30102 processing
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

  // Vitals simulation triggers
  const triggerSingleNoisySpike = () => {
    setAnomalyMode('spike');
    Alert.alert('Simulating Noise', 'Next 5s local sensor sample will contain a noise artifact (HR 148, SpO2 89%). Alert should NOT trigger as it is a single sample.');
  };

  const triggerSustainedCritical = () => {
    setAnomalyMode('sustained');
    anomalyCountRef.current = 0;
    Alert.alert('Simulating Sustained Critical Vitals', 'Sensors will report abnormal vitals (HR 125, SpO2 88%) for 3 consecutive cycles to trigger the automatic health alert.');
  };

  // SOS & Fall controls
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

  // Helper styles / classes
  const getBpmColor = () => {
    if (bpm > 140 || bpm < 60) return COLORS.danger;
    return COLORS.success;
  };

  const getSpo2Color = () => {
    if (spo2 < 92) return COLORS.danger;
    return COLORS.success;
  };

  const renderHistoryGraph = () => {
    if (vitalsHistory.length < 2) {
      return <Text style={styles.chartFallback}>Gathering trend line data...</Text>;
    }
    const width = Dimensions.get('window').width - 64;
    const height = 120;
    
    // Draw simple line representation
    const maxVal = 160;
    const minVal = 50;
    const range = maxVal - minVal;

    return (
      <View style={[styles.historyChartContainer, { width, height }]}>
        {/* Draw grid lines */}
        <View style={[styles.gridLine, { bottom: '25%' }]}><Text style={styles.gridLineText}>80 BPM</Text></View>
        <View style={[styles.gridLine, { bottom: '50%' }]}><Text style={styles.gridLineText}>100 BPM</Text></View>
        <View style={[styles.gridLine, { bottom: '75%' }]}><Text style={styles.gridLineText}>130 BPM</Text></View>
        
        {/* Plot HR data */}
        <View style={styles.pointsOverlay}>
          {vitalsHistory.map((h, i) => {
            const left = (i / (vitalsHistory.length - 1)) * (width - 10);
            const bottom = ((h.bpm - minVal) / range) * height;
            
            return (
              <View 
                key={i} 
                style={[
                  styles.chartPoint, 
                  { 
                    left, 
                    bottom, 
                    backgroundColor: h.bpm > 140 || h.bpm < 60 ? COLORS.danger : COLORS.success 
                  }
                ]} 
              />
            );
          })}
        </View>

        {/* Legend */}
        <View style={styles.chartLegend}>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: COLORS.success }]} />
            <Text style={styles.legendText}>Heart Rate Vitals (BPM)</Text>
          </View>
          <Text style={styles.legendTime}>Last hour trend (Sync Cadence: 10s)</Text>
        </View>
      </View>
    );
  };

  return (
    <LinearGradient
      colors={activeTab === 'dashboard' ? ['#E3D5F2', '#C6D2F6'] : [COLORS.background, COLORS.background]}
      style={GLOBAL_STYLES.container}
    >
      {/* Top Header (only show legacy header if NOT on dashboard) */}
      {activeTab !== 'dashboard' && (
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <TouchableOpacity onPress={() => setActiveTab('dashboard')} style={{ padding: 4 }}>
              <Icon name="arrow-left" size={22} color={COLORS.text} />
            </TouchableOpacity>
            <View>
              <Text style={styles.userName}>{user.name}</Text>
              <View style={styles.roleContainer}>
                <Icon name="hard-hat" size={14} color={COLORS.success} />
                <Text style={styles.userRole}>Worker Interface</Text>
              </View>
            </View>
          </View>

          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.connectionBadge}
              onPress={bleConnected ? handleDisconnectWearable : handleConnectWearable}
            >
              <Icon
                name={bleConnected ? 'bluetooth-connect' : bleStatus === 'scanning' || bleStatus === 'connecting' ? 'bluetooth-settings' : 'bluetooth-off'}
                size={16}
                color={bleConnected ? COLORS.success : bleStatus === 'scanning' || bleStatus === 'connecting' ? COLORS.warning : COLORS.textMuted}
              />
              <Text style={[styles.connectionText, {
                color: bleConnected ? COLORS.success : bleStatus === 'scanning' || bleStatus === 'connecting' ? COLORS.warning : COLORS.textMuted
              }]}>
                {bleConnected ? 'BT: Connected' : bleStatus === 'scanning' ? 'Scanning…' : bleStatus === 'connecting' ? 'Connecting…' : 'BT: Off'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {!isOnline && (
        <View style={styles.offlineBanner}>
          <Icon name="wifi-off" size={16} color={COLORS.danger} style={{ marginRight: 6 }} />
          <Text style={styles.offlineBannerText}>
            No Signal! Vitals queuing locally ({offlineQueueSize} saved).
          </Text>
        </View>
      )}

      {/* Main Content Area switching depending on activeTab */}
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* FALL OUT OVERLAY (Priority rendering if suspected fall countdown is active) */}
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

        {/* DASHBOARD TAB */}
        {activeTab === 'dashboard' && (
          <View style={styles.dashboardContainer}>
            {/* Header */}
            <View style={styles.dashHeader}>
              <View>
                <Text style={styles.dashWelcome}>Welcome Back</Text>
                <Text style={styles.dashTitle}>SafetyWorker Feed</Text>
              </View>
              <View style={styles.dashAvatarContainer}>
                <Icon name="account" size={36} color={COLORS.primary} />
              </View>
            </View>

            {/* Search and Notif */}
            <View style={styles.dashSearchRow}>
              <TouchableOpacity style={styles.dashNotifBtn}>
                <Icon name="bell-outline" size={24} color={COLORS.primary} />
              </TouchableOpacity>
              <View style={styles.dashSearchBox}>
                <Icon name="magnify" size={20} color={COLORS.textMuted} />
                <TextInput
                  style={styles.dashSearchInput}
                  placeholder="Search Tasks..."
                  placeholderTextColor={COLORS.textMuted}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>
            </View>

            {/* Quick Services */}
            <Text style={styles.dashSectionTitle}>Quick Services</Text>
            
            <View style={styles.dashServicesGrid}>
              <View style={styles.dashServicesRow}>
                <TouchableOpacity style={styles.dashServiceItem} onPress={() => setActiveTab('health')}>
                  <View style={styles.dashServiceSquare}>
                    <Icon name="heart-pulse" size={42} color="#BE185D" />
                  </View>
                  <View style={styles.dashServicePill}>
                    <Text style={[styles.dashServiceLabel, { color: '#4C1D95' }]}>Health{'\n'}Monitoring</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity style={styles.dashServiceItem} onPress={() => setActiveTab('fall')}>
                  <View style={styles.dashServiceSquare}>
                    <Icon name="walk" size={42} color="#059669" />
                  </View>
                  <View style={styles.dashServicePill}>
                    <Text style={[styles.dashServiceLabel, { color: '#4C1D95' }]}>Fall{'\n'}Detection</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity style={styles.dashServiceItem} onPress={() => setActiveTab('emergency')}>
                  <View style={styles.dashServiceSquare}>
                    <Icon name="alert-octagon" size={42} color="#DC2626" />
                  </View>
                  <View style={styles.dashServicePill}>
                    <Text style={[styles.dashServiceLabel, { color: '#4C1D95' }]}>SOS</Text>
                  </View>
                </TouchableOpacity>
              </View>

              <View style={[styles.dashServicesRow, { justifyContent: 'center', gap: 20 }]}>
                <TouchableOpacity style={styles.dashServiceItem} onPress={() => setActiveTab('tasks')}>
                  <View style={styles.dashServiceSquare}>
                    <Icon name="clipboard-check-outline" size={42} color="#E11D48" />
                  </View>
                  <View style={styles.dashServicePill}>
                    <Text style={[styles.dashServiceLabel, { color: '#4C1D95' }]}>Attendance{'\n'}& Tasks</Text>
                  </View>
                </TouchableOpacity>
                
                <TouchableOpacity style={styles.dashServiceItem} onPress={() => setActiveTab('weather')}>
                  <View style={styles.dashServiceSquare}>
                    <Icon name="weather-partly-cloudy" size={42} color="#0284C7" />
                  </View>
                  <View style={styles.dashServicePill}>
                    <Text style={[styles.dashServiceLabel, { color: '#4C1D95' }]}>Weather</Text>
                  </View>
                </TouchableOpacity>
              </View>
            </View>

            {/* Posts */}
            <View style={styles.dashPostsHeader}>
              <Text style={styles.dashSectionTitle}>Posts</Text>
              <TouchableOpacity><Text style={styles.dashSeeAll}>See All</Text></TouchableOpacity>
            </View>

            <View style={styles.dashPostCard}>
              <View style={styles.dashPostCardHeader}>
                <View style={styles.dashPostAvatar}>
                  <Icon name="account" size={24} color="#FFF" />
                </View>
                <View style={styles.dashPostMeta}>
                  <Text style={styles.dashPostAuthor}>Alex Rivera <Text style={styles.dashPostRole}>· Site Supervisor</Text></Text>
                  <Text style={styles.dashPostSubtitle}>Official Update</Text>
                </View>
              </View>
              <Text style={styles.dashPostContent} numberOfLines={2}>
                Important Safety Alert: Always double-check your safety harness and anchor points before ascending the tower today due to high wind gusts.
              </Text>
            </View>
            
          </View>
        )}

        {/* TAB 1: HEALTH MONITOR */}
        {activeTab === 'health' && (
          <View style={styles.tabContent}>

            {/* ── BLE Wearable Connect Card ── */}
            <View style={[GLOBAL_STYLES.glassCard, styles.card, styles.bleCard]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleContainer}>
                  <Icon name="bluetooth" size={22} color={bleConnected ? COLORS.success : COLORS.primaryLight} />
                  <Text style={styles.cardTitle}>ESP32-S3 SafetyBand</Text>
                </View>
                <View style={[GLOBAL_STYLES.badge, {
                  backgroundColor: bleConnected ? COLORS.successBg
                    : bleStatus === 'scanning' || bleStatus === 'connecting' ? COLORS.warningBg
                    : COLORS.surfaceLight,
                }]}>
                  <Text style={[GLOBAL_STYLES.badgeText, {
                    marginLeft: 0,
                    color: bleConnected ? COLORS.success
                      : bleStatus === 'scanning' || bleStatus === 'connecting' ? COLORS.warning
                      : COLORS.textMuted,
                  }]}>
                    {bleConnected ? '● Connected'
                      : bleStatus === 'scanning' ? '◌ Scanning…'
                      : bleStatus === 'connecting' ? '◌ Connecting…'
                      : bleStatus === 'error' ? '✕ Error'
                      : '○ Not Connected'}
                  </Text>
                </View>
              </View>

              <Text style={styles.cardSubtitle}>
                {bleConnected
                  ? 'Receiving live MAX30102 (HR, SpO2) and BMI160 (fall) data from wearable.'
                  : 'Connect to your ESP32-S3 wearable band to receive real sensor data. Make sure the device is powered on and Bluetooth is enabled on your phone.'}
              </Text>

              <View style={styles.bleButtonRow}>
                {bleConnected ? (
                  <TouchableOpacity style={[styles.bleBtn, styles.bleBtnDisconnect]} onPress={handleDisconnectWearable}>
                    <Icon name="bluetooth-off" size={16} color={COLORS.danger} style={{ marginRight: 6 }} />
                    <Text style={[styles.bleBtnText, { color: COLORS.danger }]}>Disconnect Wearable</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.bleBtn, styles.bleBtnConnect,
                      (bleStatus === 'scanning' || bleStatus === 'connecting') && { opacity: 0.6 }]}
                    onPress={handleConnectWearable}
                    disabled={bleStatus === 'scanning' || bleStatus === 'connecting'}
                  >
                    {(bleStatus === 'scanning' || bleStatus === 'connecting') ? (
                      <ActivityIndicator size="small" color={COLORS.text} style={{ marginRight: 8 }} />
                    ) : (
                      <Icon name="bluetooth-connect" size={16} color={COLORS.text} style={{ marginRight: 6 }} />
                    )}
                    <Text style={styles.bleBtnText}>
                      {bleStatus === 'scanning' ? 'Scanning for SafetyBand…'
                        : bleStatus === 'connecting' ? 'Connecting…'
                        : 'Connect Wearable'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* Sensor Pills */}
              <View style={styles.sensorPillsRow}>
                <View style={[styles.sensorPill, bleConnected && { borderColor: COLORS.danger }]}>
                  <Icon name="heart-pulse" size={13} color={bleConnected ? COLORS.danger : COLORS.textMuted} />
                  <Text style={[styles.sensorPillText, bleConnected && { color: COLORS.danger }]}>MAX30102 HR</Text>
                </View>
                <View style={[styles.sensorPill, bleConnected && { borderColor: COLORS.success }]}>
                  <Icon name="percent" size={13} color={bleConnected ? COLORS.success : COLORS.textMuted} />
                  <Text style={[styles.sensorPillText, bleConnected && { color: COLORS.success }]}>MAX30102 SpO2</Text>
                </View>
                <View style={[styles.sensorPill, bleConnected && { borderColor: COLORS.warning }]}>
                  <Icon name="run" size={13} color={bleConnected ? COLORS.warning : COLORS.textMuted} />
                  <Text style={[styles.sensorPillText, bleConnected && { color: COLORS.warning }]}>BMI160 IMU</Text>
                </View>
              </View>

              {/* Data source indicator */}
              <View style={styles.dataSourceRow}>
                <Icon
                  name={bleConnected ? 'chip' : 'monitor-shimmer'}
                  size={12}
                  color={COLORS.textMuted}
                />
                <Text style={styles.dataSourceText}>
                  {bleConnected
                    ? 'Source: Live BLE (ESP32-S3)'
                    : isHardwareActive
                    ? 'Source: Live Hardware (Wi-Fi/GSM)'
                    : 'Source: Standby / Connecting to ESP32'}
                </Text>
              </View>
            </View>

            {/* Vitals Summary Card */}
            <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleContainer}>
                  <Icon name="heart-pulse" size={22} color={COLORS.danger} />
                  <Text style={styles.cardTitle}>MAX30102 Health Vitals</Text>
                </View>
                <View style={[GLOBAL_STYLES.badge, { backgroundColor: healthStatus === 'Normal' ? COLORS.successBg : COLORS.dangerBg }]}>
                  <Text style={[GLOBAL_STYLES.badgeText, { color: healthStatus === 'Normal' ? COLORS.success : COLORS.danger, marginLeft: 0 }]}>
                    {healthStatus === 'Normal' ? 'Vitals: Safe' : 'Health Risk Alert'}
                  </Text>
                </View>
              </View>

              <View style={styles.vitalsRow}>
                {/* BPM Gauge */}
                <View style={styles.gaugeBox}>
                  <Text style={styles.gaugeHeader}>HEART RATE</Text>
                  <View style={[styles.circleGauge, { borderColor: getBpmColor() }]}>
                    <Text style={[styles.gaugeNum, { color: getBpmColor() }]}>{bpm}</Text>
                    <Text style={styles.gaugeUnit}>BPM</Text>
                  </View>
                </View>

                {/* SpO2 Gauge */}
                <View style={styles.gaugeBox}>
                  <Text style={styles.gaugeHeader}>OXYGEN SATURATION</Text>
                  <View style={[styles.circleGauge, { borderColor: getSpo2Color() }]}>
                    <Text style={[styles.gaugeNum, { color: getSpo2Color() }]}>{spo2}%</Text>
                    <Text style={styles.gaugeUnit}>SpO2</Text>
                  </View>
                </View>

                {/* Cadence Checkin */}
                <View style={styles.cadenceCheckin}>
                  <Text style={styles.cadenceTitle}>CADENCE CONTROL</Text>
                  <View style={styles.cadenceBullet}>
                    <View style={styles.bulletDot} />
                    <Text style={styles.cadenceTxt}>ESP32 Sample: 5s</Text>
                  </View>
                  <View style={styles.cadenceBullet}>
                    <View style={styles.bulletDot} />
                    <Text style={styles.cadenceTxt}>DB Sync: 10s</Text>
                  </View>
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

            {/* PPG Signal Waveform Visualizer */}
            <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleContainer}>
                  <Icon name="sine-wave" size={22} color={COLORS.primaryLight} />
                  <Text style={styles.cardTitle}>MAX30102 Raw PPG Waveform</Text>
                </View>
                <View style={[GLOBAL_STYLES.badge, { backgroundColor: COLORS.primaryBg }]}>
                  <Text style={[GLOBAL_STYLES.badgeText, { color: COLORS.primaryLight, marginLeft: 0 }]}>Live Signal</Text>
                </View>
              </View>
              
              <Text style={styles.cardSubtitle}>Moving-average low-pass filter active. Peak detection marker (●) on heart pulse waveform.</Text>
              
              {/* PPG graph canvas mock */}
              <View style={styles.ppgCanvas}>
                <View style={styles.ppgPointsContainer}>
                  {ppgPoints.map((val, idx) => {
                    const height = val * 2;
                    const isPeak = val > 26; // Peak detection trigger threshold simulation
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

            {/* Thermal Strain & Heat Stress Monitor Card */}
            <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleContainer}>
                  <Icon name="thermometer-alert" size={22} color={bpm > 115 ? COLORS.danger : COLORS.warning} />
                  <Text style={styles.cardTitle}>Thermal Strain & Heat Stress Index</Text>
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

              <Text style={styles.cardSubtitle}>
                Fuses Heart Rate, SpO2, and Ambient Climate to prevent heat stroke and over-exertion at work.
              </Text>

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

            {/* Threshold Health Alerting Controls */}
            <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
              <Text style={styles.sectionHeader}>Threshold Alert Simulation</Text>
              <Text style={styles.cardSubtitle}>
                Safe ranges: HR 60–140 bpm, SpO2 &gt; 92%. Requiring **3 consecutive abnormal readings** to prevent false alarms due to noise artifacts.
              </Text>
              
              <View style={styles.anomalyMeterBox}>
                <Text style={styles.anomalyMeterLabel}>Consecutive Abnormal Samples: </Text>
                <Text style={[styles.anomalyMeterVal, consecutiveAbnormal > 0 ? { color: COLORS.warning } : { color: COLORS.success }]}>
                  {consecutiveAbnormal} / 3
                </Text>
              </View>

              <View style={styles.alertSimBtnRow}>
                <TouchableOpacity style={[styles.simActionBtn, { borderColor: COLORS.warning }]} onPress={triggerSingleNoisySpike}>
                  <Text style={[styles.simActionBtnText, { color: COLORS.warning }]}>Simulate 1x Vitals Spike</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.simActionBtn, { borderColor: COLORS.danger }]} onPress={triggerSustainedCritical}>
                  <Text style={[styles.simActionBtnText, { color: COLORS.danger }]}>Simulate 3x Sustained</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Historical Trend Vitals Graph */}
            <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
              <Text style={styles.sectionHeader}>Vitals History Log</Text>
              <Text style={styles.cardSubtitle}>Pulled from Database server (Last Hour history graph)</Text>
              {renderHistoryGraph()}
            </View>
          </View>
        )}

        {/* TAB 2: FALL DETECTOR */}
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
                <Text style={styles.movementDetailLabel}>BMI160 IMU Wearable Status:</Text>
                <View style={styles.movementStatusPanel}>
                  <Text style={styles.movementStatusText}>
                    {movementState === 'Active' ? `Technician is moving (${movementActivity})` : movementState === 'Idle' ? 'No movement detected (Stationary/Idle state)' : 'IMU SUSPECT FALL DETECTED'}
                  </Text>
                </View>

                {/* Live 3D Gyro Coordinates */}
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



                {/* Man-Down Immobility Safety System */}
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
                  <TouchableOpacity style={[styles.simBtn, { borderColor: COLORS.warning }]} onPress={() => handleSimulateFall('minor')}>
                    <Text style={[styles.simBtnTxt, { color: COLORS.warning }]}>Minor Jolt</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.simBtn, { borderColor: COLORS.danger }]} onPress={() => handleSimulateFall('confirmed')}>
                    <Text style={[styles.simBtnTxt, { color: COLORS.danger }]}>Severe Fall</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </View>
        )}

        {/* TAB 3: ATTENDANCE & TASKS */}
        {activeTab === 'tasks' && (
          <View style={styles.tabContent}>
            <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleContainer}>
                  <Icon name="clipboard-check" size={22} color={COLORS.info} />
                  <Text style={styles.cardTitle}>Attendance & Tasks</Text>
                </View>
                <TouchableOpacity 
                  style={[styles.clockBtn, clockedIn ? { backgroundColor: COLORS.warning } : { backgroundColor: COLORS.success }]}
                  onPress={handleClockToggle}
                >
                  <Text style={styles.clockBtnText}>{clockedIn ? 'Clock Out' : 'Clock In'}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.gpsPanel}>
                <Icon name="map-marker" size={16} color={COLORS.textSecondary} />
                <Text style={styles.gpsText}>GPS Coordinates: {gpsCoords ? gpsCoords.latitude.toFixed(4) : '--'}, {gpsCoords ? gpsCoords.longitude.toFixed(4) : '--'}</Text>
              </View>

              <Text style={styles.sectionSubHeader}>Supervisor Assigned Tasks</Text>
              <View style={styles.taskList}>
                {tasks.length === 0 ? (
                  <Text style={styles.emptyText}>No tasks assigned for today.</Text>
                ) : (
                  tasks.filter(t => t.title.toLowerCase().includes(searchQuery.toLowerCase())).map(task => (
                    <TouchableOpacity 
                      key={task.id} 
                      style={[styles.taskRow, task.status === 'done' && styles.taskRowDone]}
                      onPress={() => handleTaskStatusCycle(task)}
                    >
                      <Icon 
                        name={task.status === 'done' ? "checkbox-marked-circle" : task.status === 'in_progress' ? "clock" : "checkbox-blank-circle-outline"}
                        size={20}
                        color={task.status === 'done' ? COLORS.success : task.status === 'in_progress' ? COLORS.warning : COLORS.textMuted}
                      />
                      <Text style={[styles.taskRowTxt, task.status === 'done' && styles.taskRowTxtDone]}>{task.title}</Text>
                      <View style={[styles.taskRowBadge, task.status === 'done' && styles.taskRowBadge_done]}>
                        <Text style={styles.taskRowBadgeTxt}>{task.status}</Text>
                      </View>
                    </TouchableOpacity>
                  ))
                )}
              </View>

              <Text style={styles.sectionSubHeader}>Recent Attendance Shifts</Text>
              <View style={styles.attendanceLog}>
                {attendanceLogs.length === 0 ? (
                  <Text style={styles.emptyText}>No shifts logged today.</Text>
                ) : (
                  attendanceLogs.slice(-3).reverse().map(log => (
                    <View key={log.id} style={styles.attendanceLogItem}>
                      <Icon name={log.action === 'clock_in' ? 'import' : 'export'} size={14} color={COLORS.textSecondary} />
                      <Text style={styles.attendanceLogTxt}>
                        {log.action === 'clock_in' ? 'Clocked In' : 'Clocked Out'} at {new Date(log.timestamp).toLocaleTimeString()}
                      </Text>
                    </View>
                  ))
                )}
              </View>
            </View>
          </View>
        )}

        {/* TAB 4: SOS EMERGENCY PANEL */}
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
                            <Text style={[GLOBAL_STYLES.badgeText, { color: alert.status === 'active' ? COLORS.danger : COLORS.success, marginLeft: 0 }]}>{alert.status}</Text>
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

        {/* TAB 5: WEATHER & SITE CONDITIONS */}
        {activeTab === 'weather' && (
          <View style={styles.tabContent}>
            {weather && (
              <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardTitleContainer}>
                    <Icon name="weather-partly-cloudy" size={22} color={COLORS.warning} />
                    <Text style={styles.cardTitle}>Site Weather Conditions</Text>
                    {weather.locationName && (
                      <Text style={{ fontSize: 13, color: COLORS.textSecondary, marginLeft: 28, marginTop: -4 }}>{weather.locationName}</Text>
                    )}
                  </View>
                  <View style={[GLOBAL_STYLES.badge, { backgroundColor: weather.safeToWork ? COLORS.successBg : COLORS.dangerBg }]}>
                    <Text style={[GLOBAL_STYLES.badgeText, { color: weather.safeToWork ? COLORS.success : COLORS.danger, marginLeft: 0 }]}>
                      {weather.safeToWork ? 'Safe to Work' : 'Work Suspended'}
                    </Text>
                  </View>
                </View>

                <View style={styles.weatherStatGrid}>
                  <View style={styles.weatherCardCell}>
                    <Text style={styles.weatherCellLabel}>TEMP</Text>
                    <Text style={styles.weatherCellVal}>{weather.temperature}°C</Text>
                  </View>
                  <View style={styles.weatherCardCell}>
                    <Text style={styles.weatherCellLabel}>WIND</Text>
                    <Text style={[styles.weatherCellVal, weather.windSpeed > 22 && { color: COLORS.danger }]}>{weather.windSpeed} kn</Text>
                  </View>
                  <View style={styles.weatherCardCell}>
                    <Text style={styles.weatherCellLabel}>PRECIPITATION</Text>
                    <Text style={styles.weatherCellVal}>{weather.precipitation} mm</Text>
                  </View>
                </View>

                {weather.hazards.length > 0 && (
                  <View style={styles.weatherWarningBox}>
                    <Icon name="weather-lightning" size={18} color={COLORS.danger} style={{ marginRight: 6 }} />
                    <Text style={styles.weatherWarningText}>Active Hazards: {weather.hazards.join(', ')}</Text>
                  </View>
                )}
                
                <Text style={styles.weatherRecommendationText}>Recommendation: {weather.recommendation}</Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {/* 🚨 FALL IMPACT POPUP EMERGENCY MODAL 🚨 */}
      <Modal
        visible={fallModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setFallModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.fallModalContent}>
            <View style={styles.fallModalHeader}>
              <Icon name="alert-octagon" size={54} color={COLORS.danger} />
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
                style={[styles.fallModalBtn, { backgroundColor: COLORS.success }]}
                onPress={() => {
                  setFallModalVisible(false);
                  setMovementState('Active');
                }}
              >
                <Text style={styles.fallModalBtnTxt}>I AM SAFE (DISMISS)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.fallModalBtn, { backgroundColor: COLORS.danger }]}
                onPress={() => {
                  setFallModalVisible(false);
                  setActiveTab('emergency');
                }}
              >
                <Text style={styles.fallModalBtnTxt}>CALL SOS HELP</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* BOTTOM NAVIGATION TAB BAR WITH 4 ICONS (Dashboard style) */}
      <View style={styles.dashBottomNav}>
        <View style={styles.dashBottomNavContent}>
          <TouchableOpacity style={styles.dashNavItem} onPress={() => setActiveTab('dashboard')}>
            <Icon name="home" size={28} color={activeTab === 'dashboard' ? '#4C1D95' : '#7C3AED'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.dashNavItem} onPress={() => setActiveTab('tasks')}>
            <Icon name="history" size={28} color={activeTab === 'tasks' ? '#4C1D95' : '#7C3AED'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.dashNavItem} onPress={() => setActiveTab('emergency')}>
            <Icon name="plus" size={28} color="#7C3AED" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.dashNavItem} onPress={() => onLogout(gpsCoords ? gpsCoords : undefined)}>
            <Icon name="account" size={28} color="#7C3AED" />
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
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.surface,
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
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.2)',
    backgroundColor: 'rgba(16, 185, 129, 0.05)',
  },
  connectionText: {
    fontSize: TYPOGRAPHY.sizes.xs - 1,
    marginLeft: 4,
    fontWeight: TYPOGRAPHY.weights.medium,
  },
  logoutButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
  },
  tabContent: {
    gap: 16,
  },
  // ── BLE Wearable Card styles ────────────────────────────────────────────────
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
  // ──────────────────────────────────────────────────────────────────────────────
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
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'center',
    paddingHorizontal: 8,
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
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.01)',
  },
  simActionBtnText: {
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: TYPOGRAPHY.weights.bold,
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
  historyChartContainer: {
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    justifyContent: 'flex-end',
    position: 'relative',
    marginTop: 8,
  },
  gridLine: {
    position: 'absolute',
    left: 12,
    right: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.04)',
    height: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  gridLineText: {
    color: COLORS.textMuted,
    fontSize: 7,
    position: 'absolute',
    right: 0,
    bottom: 2,
  },
  pointsOverlay: {
    position: 'absolute',
    left: 12,
    right: 32,
    top: 12,
    bottom: 40,
  },
  chartPoint: {
    width: 4,
    height: 4,
    borderRadius: 2,
    position: 'absolute',
  },
  chartLegend: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 6,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendText: {
    color: COLORS.text,
    fontSize: 9,
    fontWeight: TYPOGRAPHY.weights.medium,
  },
  legendTime: {
    color: COLORS.textMuted,
    fontSize: 8,
  },
  chartFallback: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    textAlign: 'center',
    paddingVertical: 40,
  },

  // Tab 2 details
  movementBody: {
    gap: 12,
  },
  movementDetailLabel: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
  },
  movementStatusPanel: {
    backgroundColor: COLORS.surfaceLight,
    padding: 12,
    borderRadius: 10,
  },
  movementStatusText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.semibold,
  },
  fallLogDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.02)',
    padding: 8,
    borderRadius: 6,
  },
  fallHistoryDesc: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
  },
  sectionSubHeader: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
    marginTop: 8,
  },
  simButtonsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  simBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
  },
  simBtnTxt: {
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: TYPOGRAPHY.weights.semibold,
  },

  // Tab 3 details
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

  // Tab 4 Details
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
    backgroundColor: COLORS.surfaceLight,
    padding: 10,
    borderRadius: 10,
  },
  alertLogHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  alertLogTitle: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  alertLogTime: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
  },

  // Tab 5 Weather Details
  weatherStatGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8,
  },
  weatherCardCell: {
    flex: 1,
    backgroundColor: COLORS.surfaceLight,
    padding: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  weatherCellLabel: {
    color: COLORS.textMuted,
    fontSize: 8,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  weatherCellVal: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.bold,
    marginTop: 4,
  },
  weatherWarningBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.dangerBg,
    padding: 8,
    borderRadius: 8,
    marginTop: 10,
  },
  weatherWarningText: {
    color: COLORS.danger,
    fontSize: TYPOGRAPHY.sizes.xs,
  },
  weatherRecommendationText: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 10,
  },

  // Fall countdown Warning Overlay
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

  // BOTTOM TAB NAVIGATION
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
    paddingBottom: Platform.OS === 'ios' ? 14 : 0, // safe area padding for iOS
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
  
  // ── DASHBOARD STYLES ────────────────────────────────────────────────────────
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
  dashServicesGrid: {
    marginBottom: 30,
    gap: 20,
  },
  dashServicesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  dashServiceItem: {
    alignItems: 'center',
    width: 100,
  },
  dashServiceSquare: {
    width: 90,
    height: 90,
    borderRadius: 24,
    backgroundColor: '#E0E7FF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#4C1D95',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 5,
    marginBottom: 10,
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
    backgroundColor: '#FDFBFF',
    height: 70,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingBottom: Platform.OS === 'ios' ? 20 : 0,
    shadowColor: '#4C1D95',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 10,
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
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  gyroAxisLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.textMuted,
    marginBottom: 4,
  },
  gyroValueText: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.primary,
  },
  heightPanel: {
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: 14,
    padding: 14,
    marginVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  heightHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  heightTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.textSecondary,
  },
  heightValueBig: {
    fontSize: 22,
    fontWeight: '800',
    color: COLORS.success,
  },
  heightSubtext: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  fallModalContent: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#0F172A',
    borderRadius: 24,
    padding: 24,
    borderWidth: 2,
    borderColor: COLORS.danger,
    alignItems: 'center',
    shadowColor: COLORS.danger,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 20,
  },
  fallModalHeader: {
    alignItems: 'center',
    marginBottom: 14,
    gap: 8,
  },
  fallModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.danger,
    textAlign: 'center',
    marginTop: 6,
  },
  fallModalBodyText: {
    fontSize: 14,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 16,
  },
  fallModalDetailsBox: {
    width: '100%',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 20,
    gap: 6,
  },
  fallModalDetailTxt: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  fallModalActionRow: {
    flexDirection: 'row',
    gap: 12,
    width: '100%',
  },
  fallModalBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallModalBtnTxt: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
});
