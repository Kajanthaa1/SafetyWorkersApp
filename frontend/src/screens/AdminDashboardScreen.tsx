import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { COLORS, GLOBAL_STYLES, TYPOGRAPHY } from '../styles/theme';
import { api } from '../services/api';
import { initSocket, disconnectSocket } from '../services/socket';
import Icon from '../components/Icon';

interface AdminDashboardScreenProps {
  user: any;
  onLogout: () => void;
}

export default function AdminDashboardScreen({ user, onLogout }: AdminDashboardScreenProps) {
  // Workers Vitals Map (realtime updates stream into here)
  const [workers, setWorkers] = useState<any[]>([]);
  const [workerVitals, setWorkerVitals] = useState<Record<string, any>>({});
  
  // Tasks
  const [tasks, setTasks] = useState<any[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [selectedWorkerId, setSelectedWorkerId] = useState('');
  const [submittingTask, setSubmittingTask] = useState(false);

  // Attendance
  const [attendance, setAttendance] = useState<any[]>([]);

  // Alerts
  const [alerts, setAlerts] = useState<any[]>([]);

  useEffect(() => {
    // Initial fetch
    loadInitialData();

    // Init Socket
    const socket = initSocket(user.id, user.role);

    // Socket Event listeners for realtime admin updates
    socket.on('vitals_update', (data: any) => {
      setWorkerVitals(prev => ({
        ...prev,
        [data.userId]: {
          ...data.reading,
          name: data.name,
          lastUpdated: Date.now()
        }
      }));
    });

    socket.on('new_fall', (data: any) => {
      // Reload alerts and show system notification alert
      loadAlerts();
      // Also update the worker's status directly in local state to highlight them
      setWorkerVitals(prev => ({
        ...prev,
        [data.userId]: {
          ...prev[data.userId],
          movementState: 'Fall Detected'
        }
      }));
    });

    socket.on('fall_status_update', (data: any) => {
      // Refresh alerts
      loadAlerts();
    });

    socket.on('new_alert', (data: any) => {
      loadAlerts();
    });

    socket.on('alert_resolved', (data: any) => {
      loadAlerts();
    });

    socket.on('attendance_update', (data: any) => {
      loadAttendance();
    });

    socket.on('task_update', (data: any) => {
      loadTasks();
    });

    return () => {
      disconnectSocket();
    };
  }, []);

  const loadInitialData = async () => {
    try {
      // Fetch list of workers
      const workerList = await api.fetchWorkers();
      setWorkers(workerList);
      if (workerList.length > 0) {
        setSelectedWorkerId(workerList[0].id);
      }

      // Fetch current alerts
      loadAlerts();

      // Fetch all tasks
      loadTasks();

      // Fetch attendance history
      loadAttendance();

      // Fetch latest vitals for all workers to seed dashboard
      const vitalsSeed: Record<string, any> = {};
      for (const w of workerList) {
        const vitals = await api.fetchVitals(w.id, 5).catch(() => []);
        if (vitals.length > 0) {
          const latest = vitals[vitals.length - 1];
          vitalsSeed[w.id] = {
            ...latest,
            name: w.name,
            lastUpdated: latest.timestamp
          };
        }
      }
      setWorkerVitals(vitalsSeed);

    } catch (err) {
      console.error('Error seeding admin data:', err);
    }
  };

  const loadAlerts = async () => {
    try {
      const data = await api.fetchAlerts();
      setAlerts(data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadTasks = async () => {
    try {
      const data = await api.fetchTasks();
      setTasks(data);
    } catch (err) {
      console.error(err);
    }
  };

  const loadAttendance = async () => {
    try {
      const data = await api.fetchAttendance();
      setAttendance(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleResolveAlert = async (alertId: string) => {
    try {
      await api.resolveAlert(alertId);
      loadAlerts();
      Alert.alert('Alert Resolved', 'The emergency incident has been marked as resolved.');
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to resolve emergency alert.');
    }
  };

  const handleCreateTask = async () => {
    if (!newTaskTitle.trim() || !selectedWorkerId) {
      Alert.alert('Error', 'Task title and assigned worker are required.');
      return;
    }

    setSubmittingTask(true);
    try {
      await api.createTask(selectedWorkerId, newTaskTitle.trim(), user.name);
      setNewTaskTitle('');
      loadTasks();
      Alert.alert('Success', 'Task assigned to worker.');
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Failed to assign task.');
    } finally {
      setSubmittingTask(false);
    }
  };

  // Vitals safety coloring helpers
  const getBpmColor = (bpm: number) => {
    if (bpm > 115 || bpm < 55) return COLORS.danger;
    if (bpm > 95 || bpm < 60) return COLORS.warning;
    return COLORS.success;
  };

  const getSpo2Color = (spo2: number) => {
    if (spo2 < 92) return COLORS.danger;
    if (spo2 < 95) return COLORS.warning;
    return COLORS.success;
  };

  // Filter for active alerts (SOS or suspected falls)
  const activeAlerts = alerts.filter(a => a.status === 'active');

  return (
    <View style={GLOBAL_STYLES.container}>
      {/* Admin Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.adminName}>{user.name}</Text>
          <View style={styles.roleContainer}>
            <Icon name="shield-crown" size={14} color={COLORS.primaryLight} />
            <Text style={styles.adminRole}>Safety Supervisor</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
          <Icon name="logout" size={20} color={COLORS.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Real-time incident flashing banner */}
        {activeAlerts.length > 0 && (
          <View style={styles.alertIncidentBox}>
            <View style={styles.alertHeaderRow}>
              <Icon name="alert-circle" size={26} color={COLORS.danger} style={styles.pulseIcon} />
              <Text style={styles.alertBoxTitle}>ACTIVE EMERGENCY ALARM</Text>
            </View>
            <View style={styles.alertList}>
              {activeAlerts.map(alert => {
                const affectedWorker = workers.find(w => w.id === alert.userId);
                return (
                  <View key={alert.id} style={styles.alertItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.alertWorkerName}>
                        Worker: {affectedWorker ? affectedWorker.name : alert.userId}
                      </Text>
                      <Text style={styles.alertDesc}>
                        Type: {alert.type === 'manual' ? 'MANUAL SOS TRIGGERED' : 'IMPACT / FALL DETECTED'}
                      </Text>
                      <Text style={styles.alertTime}>
                        Time: {new Date(alert.timestamp).toLocaleTimeString()}
                      </Text>
                    </View>
                    <TouchableOpacity
                      style={styles.resolveBtn}
                      onPress={() => handleResolveAlert(alert.id)}
                    >
                      <Text style={styles.resolveBtnText}>Mark Resolved</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </View>
        )}

        {/* Section 1: Workers Vitals Monitor Grid */}
        <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
          <Text style={styles.cardTitle}>Live Worker Safety Monitor</Text>
          <Text style={styles.cardSubtitle}>Real-time BPM, SpO2, and Movement Tracker</Text>

          <View style={styles.workerGrid}>
            {workers.map(w => {
              const vitals = workerVitals[w.id];
              const isOffline = !vitals || (Date.now() - vitals.lastUpdated) > 30000; // 30 seconds to account for GSM latency

              // Check if worker has an active fall alert in alerts list
              const hasActiveFall = activeAlerts.some(a => a.userId === w.id);

              return (
                <View key={w.id} style={[styles.workerCard, hasActiveFall && styles.workerCardDanger]}>
                  <View style={styles.workerHeader}>
                    <View>
                      <Text style={styles.workerNameText}>{w.name}</Text>
                      <Text style={styles.workerIdText}>ID: {w.id}</Text>
                    </View>
                    <View style={[
                      GLOBAL_STYLES.badge,
                      { backgroundColor: isOffline ? 'rgba(255,255,255,0.05)' : (vitals?.source === 'gsm' ? COLORS.warningBg : COLORS.successBg) }
                    ]}>
                      <View style={[
                        styles.dot,
                        { backgroundColor: isOffline ? COLORS.textMuted : (vitals?.source === 'gsm' ? COLORS.warning : COLORS.success) }
                      ]} />
                      <Text style={[
                        GLOBAL_STYLES.badgeText,
                        { color: isOffline ? COLORS.textMuted : (vitals?.source === 'gsm' ? COLORS.warning : COLORS.success) }
                      ]}>
                        {isOffline ? 'Offline' : (vitals?.source === 'gsm' ? 'GSM Fallback' : 'Live (BLE)')}
                      </Text>
                    </View>
                  </View>

                  {!vitals ? (
                    <Text style={styles.noDataText}>No readings received yet</Text>
                  ) : (
                    <View style={[styles.vitalsPanel, isOffline && { opacity: 0.6 }]}>
                      {isOffline && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8, backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: 6, borderRadius: 6 }}>
                          <Icon name="wifi-off" size={14} color={COLORS.danger} />
                          <Text style={{ color: COLORS.danger, fontSize: 10, fontWeight: 'bold' }}>SIGNAL LOST (Stale Data)</Text>
                        </View>
                      )}
                      <View style={styles.vitalStat}>
                        <Icon name="heart-pulse" size={16} color={isOffline ? COLORS.textMuted : getBpmColor(vitals.bpm)} />
                        <Text style={[styles.vitalValText, { color: isOffline ? COLORS.textMuted : getBpmColor(vitals.bpm) }]}>
                          {vitals.bpm} <Text style={styles.vitalUnit}>BPM</Text>
                        </Text>
                      </View>

                      <View style={styles.vitalStat}>
                        <Icon name="lungs" size={16} color={isOffline ? COLORS.textMuted : getSpo2Color(vitals.spo2)} />
                        <Text style={[styles.vitalValText, { color: isOffline ? COLORS.textMuted : getSpo2Color(vitals.spo2) }]}>
                          {vitals.spo2}% <Text style={styles.vitalUnit}>SpO2</Text>
                        </Text>
                      </View>



                      <View style={styles.movementStatRow}>
                        <Text style={styles.movementStatLabel}>IMU State:</Text>
                        <Text style={[
                          styles.movementStatVal,
                          {
                            color: isOffline 
                              ? COLORS.textMuted 
                              : (hasActiveFall 
                                  ? COLORS.danger 
                                  : vitals.bpm > 90 
                                    ? COLORS.success 
                                    : COLORS.warning)
                          }
                        ]}>
                          {isOffline ? 'Unknown (Offline)' : (hasActiveFall ? 'FALL TRIGGERED' : vitals.bpm > 90 ? 'Active' : 'Still/Idle')}
                        </Text>
                      </View>

                      <Text style={[styles.lastSyncText, isOffline && { color: COLORS.danger }]}>
                        {isOffline ? 'Last Sync: ' : 'Sync: '}{new Date(vitals.lastUpdated).toLocaleTimeString()}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>

        {/* Section 2: Task Dispatcher Form */}
        <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
          <Text style={styles.cardTitle}>Dispatch & Assign Tasks</Text>
          
          <View style={styles.formContainer}>
            <TextInput
              style={styles.input}
              placeholder="Enter task description (e.g. Inspect Roof Anchor)"
              placeholderTextColor={COLORS.textMuted}
              value={newTaskTitle}
              onChangeText={setNewTaskTitle}
            />

            <Text style={styles.dropdownLabel}>Assign To Worker:</Text>
            <View style={styles.pickerContainer}>
              {workers.map(w => (
                <TouchableOpacity
                  key={w.id}
                  style={[
                    styles.pickerItem,
                    selectedWorkerId === w.id && styles.pickerItemActive
                  ]}
                  onPress={() => setSelectedWorkerId(w.id)}
                >
                  <Text style={[
                    styles.pickerItemText,
                    selectedWorkerId === w.id && styles.pickerItemTextActive
                  ]}>
                    {w.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.taskCreateBtn, submittingTask && { opacity: 0.6 }]}
              onPress={handleCreateTask}
              disabled={submittingTask}
            >
              {submittingTask ? (
                <ActivityIndicator color={COLORS.text} />
              ) : (
                <>
                  <Icon name="plus" size={20} color={COLORS.text} style={{ marginRight: 4 }} />
                  <Text style={styles.taskCreateBtnText}>Dispatch Task</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Assigned Tasks Grid */}
          <Text style={styles.sectionSubTitle}>Active Tasks Status</Text>
          <View style={styles.taskList}>
            {tasks.length === 0 ? (
              <Text style={styles.emptyText}>No tasks assigned yet.</Text>
            ) : (
              tasks.slice().reverse().map(task => {
                const assignedTo = workers.find(w => w.id === task.userId);
                return (
                  <View key={task.id} style={styles.taskItem}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.taskTitleText}>{task.title}</Text>
                      <Text style={styles.taskAssignmentText}>
                        Assigned to: {assignedTo ? assignedTo.name : task.userId} (by {task.assignedBy})
                      </Text>
                    </View>
                    <View style={[styles.taskStatusBadge, task.status === 'done' ? styles.taskStatusBadge_done : task.status === 'in_progress' ? styles.taskStatusBadge_in_progress : styles.taskStatusBadge_pending]}>
                      <Text style={styles.taskStatusBadgeText}>
                        {task.status === 'done' ? 'Done' : task.status === 'in_progress' ? 'In Progress' : 'Pending'}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>

        {/* Section 3: Attendance Shift Logs */}
        <View style={[GLOBAL_STYLES.glassCard, styles.card]}>
          <Text style={styles.cardTitle}>Attendance Shift Logs</Text>
          <Text style={styles.cardSubtitle}>Clock-In / Clock-Out timestamps with GPS coords</Text>

          <View style={styles.attendanceHistory}>
            {attendance.length === 0 ? (
              <Text style={styles.emptyText}>No attendance records recorded yet today.</Text>
            ) : (
              attendance.slice().reverse().map(log => {
                const worker = workers.find(w => w.id === log.userId);
                return (
                  <View key={log.id} style={styles.attendanceLogItem}>
                    <View style={styles.attendanceLogHeader}>
                      <Icon
                        name={log.action === 'clock_in' ? "import" : "export"}
                        size={16}
                        color={log.action === 'clock_in' ? COLORS.success : COLORS.warning}
                      />
                      <Text style={styles.attendanceLogWorker}>
                        {worker ? worker.name : log.userId}
                      </Text>
                      <Text style={[
                        styles.attendanceActionLabel,
                        { color: log.action === 'clock_in' ? COLORS.success : COLORS.warning }
                      ]}>
                        {log.action === 'clock_in' ? 'CLOCKED IN' : 'CLOCKED OUT'}
                      </Text>
                    </View>
                    <Text style={styles.attendanceLogTime}>
                      Time: {new Date(log.timestamp).toLocaleString()}
                    </Text>
                    <Text style={styles.attendanceLogLocation}>
                      GPS: {log.latitude.toFixed(5)}, {log.longitude.toFixed(5)}
                    </Text>
                  </View>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: 16,
    gap: 16,
    paddingBottom: 40,
  },
  dashboardShell: {
    gap: 16,
  },
  dashboardTitle: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.lg,
    fontWeight: TYPOGRAPHY.weights.bold,
    marginBottom: 4,
  },
  supervisorHomeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  supervisorServiceItem: {
    width: '48%',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 12,
    minHeight: 150,
    justifyContent: 'center',
  },
  supervisorServiceSquare: {
    width: '100%',
    minHeight: 94,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  supervisorServiceLabel: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
    textAlign: 'center',
    lineHeight: 20,
  },
  backToDashboardText: {
    color: COLORS.primaryLight,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: TYPOGRAPHY.weights.bold,
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
  adminName: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  roleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  adminRole: {
    color: COLORS.primaryLight,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginLeft: 4,
    fontWeight: TYPOGRAPHY.weights.medium,
  },
  logoutButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: COLORS.surfaceLight,
  },
  alertIncidentBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: COLORS.danger,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  alertHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  alertBoxTitle: {
    color: COLORS.danger,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.black,
    marginLeft: 8,
    letterSpacing: 0.5,
  },
  pulseIcon: {
    // Pulse animation simulated visually
  },
  alertList: {
    gap: 10,
  },
  alertItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  alertWorkerName: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  alertDesc: {
    color: COLORS.danger,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: TYPOGRAPHY.weights.semibold,
    marginTop: 2,
  },
  alertTime: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 2,
  },
  resolveBtn: {
    backgroundColor: COLORS.danger,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  resolveBtnText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  card: {
    marginBottom: 0,
  },
  cardTitle: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  cardSubtitle: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 2,
    marginBottom: 16,
  },
  workerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  workerCard: {
    flex: 1,
    minWidth: 160,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 12,
  },
  workerCardDanger: {
    borderColor: COLORS.danger,
    backgroundColor: 'rgba(239, 68, 68, 0.05)',
  },
  workerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  workerNameText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  workerIdText: {
    color: COLORS.textMuted,
    fontSize: 9,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  noDataText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontStyle: 'italic',
    marginTop: 10,
  },
  vitalsPanel: {
    gap: 8,
  },
  vitalStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  vitalValText: {
    fontSize: TYPOGRAPHY.sizes.base,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  vitalUnit: {
    fontSize: 9,
    fontWeight: TYPOGRAPHY.weights.regular,
    color: COLORS.textSecondary,
  },
  movementStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingTop: 6,
    marginTop: 2,
  },
  movementStatLabel: {
    color: COLORS.textMuted,
    fontSize: 9,
  },
  movementStatVal: {
    fontSize: 10,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  lastSyncText: {
    color: COLORS.textMuted,
    fontSize: 8,
    alignSelf: 'flex-end',
  },
  formContainer: {
    gap: 12,
    marginBottom: 20,
  },
  input: {
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
  },
  dropdownLabel: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: TYPOGRAPHY.weights.semibold,
  },
  pickerContainer: {
    flexDirection: 'row',
    gap: 8,
  },
  pickerItem: {
    flex: 1,
    backgroundColor: COLORS.surfaceLight,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    paddingVertical: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerItemActive: {
    borderColor: COLORS.primaryLight,
    backgroundColor: COLORS.primaryBg,
  },
  pickerItemText: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontWeight: TYPOGRAPHY.weights.semibold,
  },
  pickerItemTextActive: {
    color: COLORS.text,
  },
  taskCreateBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
  },
  taskCreateBtnText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  sectionSubTitle: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
    marginTop: 10,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  taskList: {
    gap: 8,
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    padding: 10,
  },
  taskTitleText: {
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.semibold,
  },
  taskAssignmentText: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 2,
  },
  taskStatusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  taskStatusBadge_pending: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  taskStatusBadge_in_progress: {
    backgroundColor: COLORS.warningBg,
  },
  taskStatusBadge_done: {
    backgroundColor: COLORS.successBg,
  },
  taskStatusBadgeText: {
    fontSize: 9,
    fontWeight: TYPOGRAPHY.weights.bold,
    color: COLORS.text,
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    fontStyle: 'italic',
  },
  attendanceHistory: {
    gap: 8,
  },
  attendanceLogItem: {
    backgroundColor: COLORS.surfaceLight,
    borderRadius: 10,
    padding: 10,
  },
  attendanceLogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  attendanceLogWorker: {
    flex: 1,
    color: COLORS.text,
    fontSize: TYPOGRAPHY.sizes.sm,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  attendanceActionLabel: {
    fontSize: 9,
    fontWeight: TYPOGRAPHY.weights.bold,
  },
  attendanceLogTime: {
    color: COLORS.textSecondary,
    fontSize: TYPOGRAPHY.sizes.xs,
  },
  attendanceLogLocation: {
    color: COLORS.textMuted,
    fontSize: TYPOGRAPHY.sizes.xs,
    marginTop: 2,
  },
});
