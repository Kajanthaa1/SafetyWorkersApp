import React, { useState, useEffect, useRef } from 'react';
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
} from 'react-native';
import { COLORS, GLOBAL_STYLES, TYPOGRAPHY } from '../styles/theme';
import { api } from '../services/api';
import { initSocket, emitVitalsPush, emitFallTrigger, emitFallCancel, disconnectSocket } from '../services/socket';
import Icon from '../components/Icon';

interface WorkerHomeScreenProps {
  user: any;
  onLogout: () => void;
}

type TabType = 'health' | 'fall' | 'tasks' | 'emergency' | 'weather';

export default function WorkerHomeScreen({ user, onLogout }: WorkerHomeScreenProps) {
  // Navigation Tabs state
  const [activeTab, setActiveTab] = useState<TabType>('health');

  // 1. Health Monitor State
  const [bpm, setBpm] = useState(76);
  const [spo2, setSpo2] = useState(98);
  const [vitalsHistory, setVitalsHistory] = useState<any[]>([]);
  const [loadingVitals, setLoadingVitals] = useState(false);
  const [consecutiveAbnormal, setConsecutiveAbnormal] = useState(0);
  const [healthStatus, setHealthStatus] = useState<'Normal' | 'Health Risk Alert'>('Normal');
  
  // ESP32 simulation parameters
  const [localSampleCadence, setLocalSampleCadence] = useState(5); // 5 seconds local sampling
  const [cloudPushCadence, setCloudPushCadence] = useState(10); // 10 seconds DB push
  const [lastPushTime, setLastPushTime] = useState<number>(Date.now());
  const [localBuffers, setLocalBuffers] = useState<{ bpm: number; spo2: number }[]>([]);

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
  const [gpsCoords, setGpsCoords] = useState({ latitude: 37.7749, longitude: -122.4194 });

  // 4. Alerts & Panel State
  const [connectionHealth, setConnectionHealth] = useState<'connected' | 'weak' | 'disconnected'>('connected');
  const [alertHistory, setAlertHistory] = useState<any[]>([]);
  const [submittingAlert, setSubmittingAlert] = useState(false);

  // 5. Weather State
  const [weather, setWeather] = useState<any>(null);
  const [loadingWeather, setLoadingWeather] = useState(false);

  // Simulation parameters for testing vitals spikes
  const [anomalyMode, setAnomalyMode] = useState<'none' | 'spike' | 'sustained'>('none');
  const anomalyCountRef = useRef(0);

  // Timers Refs
  const countdownInterval = useRef<NodeJS.Timeout | null>(null);
  const esp32SampleInterval = useRef<NodeJS.Timeout | null>(null);
  const ppgAnimationInterval = useRef<NodeJS.Timeout | null>(null);

  // Animation values
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Initialize WebSockets
    const socket = initSocket(user.id, user.role);

    // Socket listeners
    socket.on('task_update', (data: any) => {
      if (data.userId === user.id) {
        loadTasks();
      }
    });

    socket.on('vitals_update', (data: any) => {
      if (data.userId === user.id) {
        setConsecutiveAbnormal(data.consecutiveAbnormalCount);
        if (data.consecutiveAbnormalCount >= 3) {
          setHealthStatus('Health Risk Alert');
        } else {
          setHealthStatus('Normal');
        }
      }
    });

    // Load initial logs
    loadInitialData();

    // Start ESP32 Local 5s Sampling & Cadence simulation
    startEsp32Simulation();

    // Start MAX30102 PPG pulse wave simulation
    startPpgWaveformAnimation();

    // Pulses animation for SOS / alerts
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1.0, duration: 800, useNativeDriver: true }),
      ])
    ).start();

    return () => {
      disconnectSocket();
      if (countdownInterval.current) clearInterval(countdownInterval.current);
      if (esp32SampleInterval.current) clearInterval(esp32SampleInterval.current);
      if (ppgAnimationInterval.current) clearInterval(ppgAnimationInterval.current);
    };
  }, []);

  const loadInitialData = async () => {
    loadTasks();
    loadVitalsHistory();
    loadAttendanceHistory();
    loadAlertHistory();
    loadWeather();
  };

  const loadVitalsHistory = async () => {
    setLoadingVitals(true);
    try {
      const data = await api.fetchVitals(user.id, 60); // fetch last 60 minutes
      setVitalsHistory(data);
      if (data.length > 0) {
        const latest = data[data.length - 1];
        setBpm(latest.bpm);
        setSpo2(latest.spo2);
      }
    } catch (err) {
      console.error('Error fetching vitals:', err);
    } finally {
      setLoadingVitals(false);
    }
  };

  const loadTasks = async () => {
    try {
      const data = await api.fetchTasks(user.id);
      setTasks(data);
    } catch (err) {
      console.error(err);
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
    } catch (err) {
      console.error(err);
    }
  };

  const loadAlertHistory = async () => {
    try {
      const data = await api.fetchAlerts(user.id);
      setAlertHistory(data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadWeather = async () => {
    setLoadingWeather(true);
    try {
      const data = await api.fetchWeather(gpsCoords.latitude, gpsCoords.longitude);
      setWeather(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingWeather(false);
    }
  };

  // MAX30102 Raw PPG waveform simulation
  const startPpgWaveformAnimation = () => {
    const wavePattern = [15, 12, 10, 8, 12, 28, 35, 12, 14, 16, 18, 17, 16, 15, 15, 14, 15, 14, 15, 16, 15, 14, 15, 16, 15, 14, 13, 14, 15, 16];
    
    ppgAnimationInterval.current = setInterval(() => {
      setPpgPoints(prev => {
        const nextWave = [...prev.slice(1)];
        // Get next point in circular pattern
        const point = wavePattern[ppgIndex.current % wavePattern.length];
        
        // Add random motion noise if worker is active
        const noise = movementState === 'Active' ? (Math.random() * 4 - 2) : 0;
        
        // If low pass filter is active, we average it
        const filteredPoint = Math.max(2, point + noise);
        
        nextWave.push(filteredPoint);
        ppgIndex.current += 1;
        return nextWave;
      });
    }, 150);
  };

  // ESP32 simulation running every 5s locally
  const startEsp32Simulation = () => {
    esp32SampleInterval.current = setInterval(async () => {
      if (movementState === 'Fall Detected') return;

      // Simulate ESP32 reading vitals
      let nextBpm = 75;
      let nextSpo2 = 98;

      if (anomalyMode === 'spike') {
        // Single noisy sample: HR spikes to 148, SpO2 drops to 89% for one count, then reverts
        nextBpm = 148;
        nextSpo2 = 89;
        setAnomalyMode('none'); // Revert immediately after one sample
      } else if (anomalyMode === 'sustained') {
        // Sustained hypoxia
        nextBpm = 125;
        nextSpo2 = 88;
        anomalyCountRef.current += 1;
        if (anomalyCountRef.current >= 4) {
          setAnomalyMode('none');
          anomalyCountRef.current = 0;
        }
      } else {
        // Normal fluctuations
        const base = movementState === 'Active' ? 86 : 70;
        const variance = Math.floor(Math.random() * 6) - 3;
        nextBpm = Math.min(Math.max(base + variance, 58), 138);
        nextSpo2 = Math.random() > 0.98 ? 96 : 98;
      }

      setBpm(nextBpm);
      setSpo2(nextSpo2);

      // Add to local ESP32 buffer
      const newReading = { bpm: nextBpm, spo2: nextSpo2 };
      const updatedBuffers = [...localBuffers, newReading];
      setLocalBuffers(updatedBuffers);

      const now = Date.now();
      const timeSinceLastPush = now - lastPushTime;
      const shouldPushImmediately = nextBpm < 60 || nextBpm > 140 || nextSpo2 < 92;

      // Cadence Logic: sample every 5s, push to Firebase/Backend every 10s OR immediately on threshold breach
      if (timeSinceLastPush >= cloudPushCadence * 1000 || shouldPushImmediately) {
        // Compute moving average filter over local buffer before pushing
        const avgBpm = Math.round(updatedBuffers.reduce((acc, curr) => acc + curr.bpm, 0) / updatedBuffers.length);
        const avgSpo2 = Math.round(updatedBuffers.reduce((acc, curr) => acc + curr.spo2, 0) / updatedBuffers.length);

        setLastPushTime(now);
        setLocalBuffers([]); // clear local buffer

        try {
          // Push to backend (acting as Firebase simulator)
          const response = await api.submitVitals(user.id, avgBpm, avgSpo2);
          
          // Append to vitals history
          setVitalsHistory(prev => [...prev.slice(-30), {
            bpm: avgBpm,
            spo2: avgSpo2,
            timestamp: now
          }]);

          // Check if an alert was triggered
          if (response.triggeredAlert) {
            setHealthStatus('Health Risk Alert');
            loadAlertHistory();
            Alert.alert(
              'HEALTH WARNING',
              'Sustained abnormal vital readings detected. Health Alert automatically escalated to Supervisor.',
              [{ text: 'OK' }]
            );
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

    try {
      const response = await api.submitVitals(user.id, nextBpm, nextSpo2);
      setVitalsHistory(prev => [...prev, { bpm: nextBpm, spo2: nextSpo2, timestamp: Date.now() }]);
      setConsecutiveAbnormal(response.consecutiveAbnormalCount);
      setHealthStatus(response.consecutiveAbnormalCount >= 3 ? 'Health Risk Alert' : 'Normal');
      loadAlertHistory();
      loadWeather();
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
    <View style={GLOBAL_STYLES.container}>
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.userName}>{user.name}</Text>
          <View style={styles.roleContainer}>
            <Icon name="hard-hat" size={14} color={COLORS.success} />
            <Text style={styles.userRole}>Worker Interface</Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <TouchableOpacity style={styles.connectionBadge}>
            <Icon name="wifi" size={16} color={COLORS.success} />
            <Text style={[styles.connectionText, { color: COLORS.success }]}>BT: Connected</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
            <Icon name="logout" size={18} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

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

        {/* TAB 1: HEALTH MONITOR */}
        {activeTab === 'health' && (
          <View style={styles.tabContent}>
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

            {/* Signal Processing / Key Technical Details */}
            <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
              <Text style={styles.sectionHeader}>Key Technical Implementation</Text>
              <View style={styles.techBullet}>
                <Icon name="filter" size={16} color={COLORS.primaryLight} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.techBulletTitle}>Signal Filtering (Motion Artifact Mitigation)</Text>
                  <Text style={styles.techBulletDesc}>
                    ESP32 firmware applies a moving-average low-pass filter (window width = 8 samples) to raw IR and Red values before computing BPM, smoothing out high-frequency noise and jolt artifacts.
                  </Text>
                </View>
              </View>

              <View style={styles.techBullet}>
                <Icon name="heart-flash" size={16} color={COLORS.danger} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.techBulletTitle}>PPG Heart Rate Peak Detection</Text>
                  <Text style={styles.techBulletDesc}>
                    Raw IR photoplethysmogram waveforms are processed in real-time. Peak detection isolates systolic crests on the filtered signal, computing the instantaneous BPM using the intervals between peaks.
                  </Text>
                </View>
              </View>

              <View style={styles.techBullet}>
                <Icon name="percent" size={16} color={COLORS.success} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.techBulletTitle}>SpO2 Ratio-of-Ratios Algorithm</Text>
                  <Text style={styles.techBulletDesc}>
                    {"Computes oxygen saturation by calculating the ratio of AC and DC components from Red and IR signals: \\(R = \\frac{AC_{red}/DC_{red}}{AC_{ir}/DC_{ir}}\\). Matches it to the standard MAX30102 regression curve."}
                  </Text>
                </View>
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
                    {movementState === 'Active' ? 'Technician is moving (Active state)' : movementState === 'Idle' ? 'No movement detected (Still/Idle state)' : 'IMU SUSPECT FALL DETECTED'}
                  </Text>
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
                <Text style={styles.gpsText}>GPS Coordinates: {gpsCoords.latitude.toFixed(4)}, {gpsCoords.longitude.toFixed(4)}</Text>
              </View>

              <Text style={styles.sectionSubHeader}>Supervisor Assigned Tasks</Text>
              <View style={styles.taskList}>
                {tasks.length === 0 ? (
                  <Text style={styles.emptyText}>No tasks assigned for today.</Text>
                ) : (
                  tasks.map(task => (
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
                    <Text style={styles.weatherCellVal}>{weather.precipitation}%</Text>
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

      {/* BOTTOM NAVIGATION TAB BAR WITH 5 ICONS */}
      <View style={styles.bottomTabBar}>
        <TouchableOpacity style={[styles.tabItem, activeTab === 'health' && styles.tabItemActive]} onPress={() => setActiveTab('health')}>
          <Icon name="heart-pulse" size={22} color={activeTab === 'health' ? COLORS.danger : COLORS.textSecondary} />
          <Text style={[styles.tabLabel, activeTab === 'health' && styles.tabLabelActive]}>Health</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabItem, activeTab === 'fall' && styles.tabItemActive]} onPress={() => setActiveTab('fall')}>
          <Icon name="walk" size={22} color={activeTab === 'fall' ? COLORS.success : COLORS.textSecondary} />
          <Text style={[styles.tabLabel, activeTab === 'fall' && styles.tabLabelActive]}>Fall</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabItem, activeTab === 'tasks' && styles.tabItemActive]} onPress={() => setActiveTab('tasks')}>
          <Icon name="format-list-checks" size={22} color={activeTab === 'tasks' ? COLORS.info : COLORS.textSecondary} />
          <Text style={[styles.tabLabel, activeTab === 'tasks' && styles.tabLabelActive]}>Tasks</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabItem, activeTab === 'emergency' && styles.tabItemActive]} onPress={() => setActiveTab('emergency')}>
          <Icon name="alert-octagon" size={22} color={activeTab === 'emergency' ? COLORS.danger : COLORS.textSecondary} />
          <Text style={[styles.tabLabel, activeTab === 'emergency' && styles.tabLabelActive]}>SOS</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.tabItem, activeTab === 'weather' && styles.tabItemActive]} onPress={() => setActiveTab('weather')}>
          <Icon name="weather-partly-cloudy" size={22} color={activeTab === 'weather' ? COLORS.warning : COLORS.textSecondary} />
          <Text style={[styles.tabLabel, activeTab === 'weather' && styles.tabLabelActive]}>Weather</Text>
        </TouchableOpacity>
      </View>
    </View>
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
});
