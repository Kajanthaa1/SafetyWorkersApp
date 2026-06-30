import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(__dirname, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const VITALS_FILE = path.join(DATA_DIR, 'vitals.json');
const FALLS_FILE = path.join(DATA_DIR, 'falls.json');
const ATTENDANCE_FILE = path.join(DATA_DIR, 'attendance.json');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const ALERTS_FILE = path.join(DATA_DIR, 'alerts.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface User {
  id: string;
  username: string;
  name: string;
  role: 'worker' | 'supervisor';
}

export interface VitalReading {
  userId: string;
  bpm: number;
  spo2: number;
  timestamp: number;
}

export interface FallEvent {
  id: string;
  userId: string;
  timestamp: number;
  severity: 'minor' | 'confirmed';
  status: 'suspected' | 'confirmed' | 'cancelled' | 'resolved';
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  action: 'clock_in' | 'clock_out';
  timestamp: number;
  latitude: number;
  longitude: number;
}

export interface Task {
  id: string;
  userId: string;
  title: string;
  status: 'pending' | 'in_progress' | 'done';
  assignedBy: string;
  timestamp: number;
}

export interface EmergencyAlert {
  id: string;
  userId: string;
  type: 'manual' | 'fall' | 'health';
  status: 'active' | 'resolved';
  timestamp: number;
  resolvedAt?: number;
}

class Database {
  private users: User[] = [];
  private vitals: VitalReading[] = [];
  private falls: FallEvent[] = [];
  private attendance: AttendanceRecord[] = [];
  private tasks: Task[] = [];
  private alerts: EmergencyAlert[] = [];

  constructor() {
    this.loadData();
    this.seedUsers();
    this.seedTasks();
  }

  private loadData() {
    try {
      if (fs.existsSync(USERS_FILE)) this.users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
      if (fs.existsSync(VITALS_FILE)) this.vitals = JSON.parse(fs.readFileSync(VITALS_FILE, 'utf8'));
      if (fs.existsSync(FALLS_FILE)) this.falls = JSON.parse(fs.readFileSync(FALLS_FILE, 'utf8'));
      if (fs.existsSync(ATTENDANCE_FILE)) this.attendance = JSON.parse(fs.readFileSync(ATTENDANCE_FILE, 'utf8'));
      if (fs.existsSync(TASKS_FILE)) this.tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
      if (fs.existsSync(ALERTS_FILE)) this.alerts = JSON.parse(fs.readFileSync(ALERTS_FILE, 'utf8'));
    } catch (error) {
      console.error('Error loading database files:', error);
    }
  }

  private saveData(file: string, data: any) {
    try {
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      console.error(`Error saving database file ${file}:`, error);
    }
  }

  private seedUsers() {
    if (this.users.length === 0) {
      this.users = [
        { id: 'worker1', username: 'worker1', name: 'John Doe', role: 'worker' },
        { id: 'worker2', username: 'worker2', name: 'Alice Smith', role: 'worker' },
        { id: 'supervisor1', username: 'supervisor1', name: 'Bob Jones', role: 'supervisor' }
      ];
      this.saveData(USERS_FILE, this.users);
    }
  }

  private seedTasks() {
    if (this.tasks.length === 0) {
      const now = Date.now();
      this.tasks = [
        {
          id: 'task1',
          userId: 'worker1',
          title: 'Inspect North Facade Anchors',
          status: 'pending',
          assignedBy: 'supervisor1',
          timestamp: now - 3600000
        },
        {
          id: 'task2',
          userId: 'worker1',
          title: 'Verify Lifeline Tension (Zone C)',
          status: 'in_progress',
          assignedBy: 'supervisor1',
          timestamp: now - 1800000
        },
        {
          id: 'task3',
          userId: 'worker2',
          title: 'Calibrate BMI160 Wearable Unit',
          status: 'done',
          assignedBy: 'supervisor1',
          timestamp: now - 7200000
        }
      ];
      this.saveData(TASKS_FILE, this.tasks);
    }
  }

  // Users
  getUsers(): User[] {
    return this.users;
  }

  getUserById(id: string): User | undefined {
    return this.users.find(u => u.id === id);
  }

  getUserByUsername(username: string): User | undefined {
    return this.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  }

  // Vitals
  getVitals(userId: string, minutes: number = 30): VitalReading[] {
    const cutoff = Date.now() - minutes * 60 * 1000;
    return this.vitals.filter(v => v.userId === userId && v.timestamp >= cutoff);
  }

  getAllLatestVitals(): Record<string, VitalReading> {
    const latest: Record<string, VitalReading> = {};
    for (const v of this.vitals) {
      if (!latest[v.userId] || latest[v.userId].timestamp < v.timestamp) {
        latest[v.userId] = v;
      }
    }
    return latest;
  }

  addVitalReading(reading: VitalReading) {
    this.vitals.push(reading);
    // Keep max 500 records per user to prevent bloat
    const userReadings = this.vitals.filter(v => v.userId === reading.userId);
    if (userReadings.length > 500) {
      const sorted = [...userReadings].sort((a, b) => b.timestamp - a.timestamp);
      const toRemove = sorted.slice(500);
      this.vitals = this.vitals.filter(v => !toRemove.includes(v));
    }
    this.saveData(VITALS_FILE, this.vitals);
  }

  // Falls
  getFalls(userId?: string): FallEvent[] {
    if (userId) {
      return this.falls.filter(f => f.userId === userId);
    }
    return this.falls;
  }

  addFallEvent(fall: FallEvent) {
    this.falls.push(fall);
    this.saveData(FALLS_FILE, this.falls);
  }

  updateFallEventStatus(id: string, status: FallEvent['status']) {
    const fall = this.falls.find(f => f.id === id);
    if (fall) {
      fall.status = status;
      this.saveData(FALLS_FILE, this.falls);
    }
    return fall;
  }

  // Attendance
  getAttendance(userId?: string): AttendanceRecord[] {
    if (userId) {
      return this.attendance.filter(a => a.userId === userId);
    }
    return this.attendance;
  }

  addAttendanceRecord(record: AttendanceRecord) {
    this.attendance.push(record);
    this.saveData(ATTENDANCE_FILE, this.attendance);
  }

  // Tasks
  getTasks(userId?: string): Task[] {
    if (userId) {
      return this.tasks.filter(t => t.userId === userId);
    }
    return this.tasks;
  }

  addTask(task: Task) {
    this.tasks.push(task);
    this.saveData(TASKS_FILE, this.tasks);
    return task;
  }

  updateTaskStatus(id: string, status: Task['status']) {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.status = status;
      this.saveData(TASKS_FILE, this.tasks);
    }
    return task;
  }

  // Alerts
  getAlerts(userId?: string): EmergencyAlert[] {
    if (userId) {
      return this.alerts.filter(a => a.userId === userId);
    }
    return this.alerts.sort((a, b) => b.timestamp - a.timestamp);
  }

  addAlert(alert: EmergencyAlert) {
    this.alerts.push(alert);
    this.saveData(ALERTS_FILE, this.alerts);
    return alert;
  }

  resolveAlert(id: string) {
    const alert = this.alerts.find(a => a.id === id);
    if (alert) {
      alert.status = 'resolved';
      alert.resolvedAt = Date.now();
      this.saveData(ALERTS_FILE, this.alerts);
    }
    return alert;
  }
}

export const db = new Database();
