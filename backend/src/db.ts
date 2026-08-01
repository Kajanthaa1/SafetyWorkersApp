import * as admin from 'firebase-admin';
import * as path from 'path';
import crypto from 'crypto';
import * as fs from 'fs';

// ── Database Fallback Logic ──────────────────────────────────────────────────────
let serviceAccount: any = null;
let useLocalDb = false;

try {
  serviceAccount = require(path.join(__dirname, '../serviceAccountKey.json'));
} catch (e) {
  console.log('[DB] serviceAccountKey.json not found or failed to load. Falling back to local JSON database.');
  useLocalDb = true;
}

if (!useLocalDb && serviceAccount) {
  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }
  } catch (err) {
    console.error('[DB] Failed to initialize Firebase Admin, falling back to local database:', err);
    useLocalDb = true;
  }
} else {
  useLocalDb = true;
}

const firestore = useLocalDb ? null : admin.firestore();
const DATA_DIR = path.join(__dirname, '../data');

// Ensure directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readJsonFile<T>(filename: string, defaultData: T): T {
  const filePath = path.join(DATA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(defaultData, null, 2));
    return defaultData;
  }
  try {
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data) as T;
  } catch (err) {
    console.error(`Error reading ${filename}, returning default:`, err);
    return defaultData;
  }
}

function writeJsonFile<T>(filename: string, data: T): void {
  const filePath = path.join(DATA_DIR, filename);
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`Error writing to ${filename}:`, err);
  }
}

// ── Interfaces ───────────────────────────────────────────────────────────────────
export interface User {
  id: string;
  username: string;
  name: string;
  role: 'worker' | 'supervisor' | 'admin';
  passwordHash: string;
  deviceToken: string;
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export interface VitalReading {
  userId: string;
  bpm: number;
  spo2: number;
  gx?: number;
  gy?: number;
  gz?: number;
  timestamp: number;
  source?: 'ble' | 'gsm';
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

// ── Database Class (Firestore-backed with Local Fallback) ─────────────────────────
class Database {
  private db = firestore as admin.firestore.Firestore;

  // ── Seeding ────────────────────────────────────────────────────────────────────
  async seedIfNeeded(): Promise<void> {
    if (useLocalDb) {
      const users = await this.getUsers();
      const hasSupervisor = users.some(u => u.username === 'supervisor1');
      if (!hasSupervisor) {
        console.log('[DB] Seeding local supervisor account...');
        const supervisor: User = {
          id: 'supervisor1',
          username: 'supervisor1',
          name: 'Bob Jones',
          role: 'supervisor',
          passwordHash: hashPassword('supervisor1'),
          deviceToken: 'device_token_supervisor1_xyz',
        };
        users.push(supervisor);
        writeJsonFile('users.json', users);
        console.log('[DB] Supervisor account created locally.');
      }
      return;
    }
    try {
      // Seed supervisor account if it doesn't exist
      const supervisorSnap = await this.db.collection('users')
        .where('username', '==', 'supervisor1')
        .limit(1)
        .get();

      if (supervisorSnap.empty) {
        console.log('[DB] Seeding supervisor account...');
        const supervisor: User = {
          id: 'supervisor1',
          username: 'supervisor1',
          name: 'Bob Jones',
          role: 'supervisor',
          passwordHash: hashPassword('supervisor1'),
          deviceToken: 'device_token_supervisor1_xyz',
        };
        await this.db.collection('users').doc(supervisor.id).set(supervisor);
        console.log('[DB] Supervisor account created in Firestore.');
      }
    } catch (err) {
      console.error('[DB] Seed error:', err);
    }
  }

  // ── Users ──────────────────────────────────────────────────────────────────────
  async getUsers(): Promise<User[]> {
    if (useLocalDb) {
      return readJsonFile<User[]>('users.json', []);
    }
    const snap = await this.db.collection('users').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as User));
  }

  async getUserById(id: string): Promise<User | undefined> {
    if (useLocalDb) {
      const users = await this.getUsers();
      return users.find(u => u.id === id);
    }
    const doc = await this.db.collection('users').doc(id).get();
    if (!doc.exists) return undefined;
    return { id: doc.id, ...doc.data() } as User;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    if (useLocalDb) {
      const users = await this.getUsers();
      return users.find(u => u.username.toLowerCase() === username.toLowerCase());
    }
    const snap = await this.db
      .collection('users')
      .where('username', '==', username.toLowerCase())
      .limit(1)
      .get();
    if (snap.empty) return undefined;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as User;
  }

  async getUserByDeviceToken(token: string): Promise<User | undefined> {
    if (useLocalDb) {
      const users = await this.getUsers();
      return users.find(u => u.deviceToken === token);
    }
    const snap = await this.db
      .collection('users')
      .where('deviceToken', '==', token)
      .limit(1)
      .get();
    if (snap.empty) return undefined;
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() } as User;
  }

  async addUser(user: User): Promise<User> {
    if (useLocalDb) {
      const users = await this.getUsers();
      const existingIdx = users.findIndex(u => u.id === user.id);
      if (existingIdx >= 0) {
        users[existingIdx] = user;
      } else {
        users.push(user);
      }
      writeJsonFile('users.json', users);
      return user;
    }
    await this.db.collection('users').doc(user.id).set(user);
    return user;
  }

  // ── Vitals ─────────────────────────────────────────────────────────────────────
  async getVitals(userId: string, minutes: number = 30): Promise<VitalReading[]> {
    if (useLocalDb) {
      const vitals = readJsonFile<VitalReading[]>('vitals.json', []);
      const cutoff = Date.now() - minutes * 60 * 1000;
      return vitals
        .filter(v => v.userId === userId && v.timestamp >= cutoff)
        .sort((a, b) => a.timestamp - b.timestamp);
    }
    const cutoff = Date.now() - minutes * 60 * 1000;
    const snap = await this.db
      .collection('vitals')
      .where('userId', '==', userId)
      .where('timestamp', '>=', cutoff)
      .orderBy('timestamp', 'asc')
      .get();
    return snap.docs.map(d => d.data() as VitalReading);
  }

  async getAllLatestVitals(): Promise<Record<string, VitalReading>> {
    const users = await this.getUsers();
    const latest: Record<string, VitalReading> = {};
    if (useLocalDb) {
      const vitals = readJsonFile<VitalReading[]>('vitals.json', []);
      for (const user of users.filter(u => u.role === 'worker')) {
        const userVitals = vitals.filter(v => v.userId === user.id);
        if (userVitals.length > 0) {
          const latestVital = userVitals.reduce((max, current) => current.timestamp > max.timestamp ? current : max, userVitals[0]);
          latest[user.id] = latestVital;
        }
      }
      return latest;
    }
    for (const user of users.filter(u => u.role === 'worker')) {
      const snap = await this.db
        .collection('vitals')
        .where('userId', '==', user.id)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();
      if (!snap.empty) {
        latest[user.id] = snap.docs[0].data() as VitalReading;
      }
    }
    return latest;
  }

  async addVitalReading(reading: VitalReading): Promise<void> {
    if (useLocalDb) {
      const vitals = readJsonFile<VitalReading[]>('vitals.json', []);
      vitals.push(reading);
      writeJsonFile('vitals.json', vitals);
      return;
    }
    await this.db.collection('vitals').add(reading);
  }

  // ── Falls ──────────────────────────────────────────────────────────────────────
  async getFalls(userId?: string): Promise<FallEvent[]> {
    if (useLocalDb) {
      const falls = readJsonFile<FallEvent[]>('falls.json', []);
      const filtered = userId ? falls.filter(f => f.userId === userId) : falls;
      return filtered.sort((a, b) => b.timestamp - a.timestamp);
    }
    let query: admin.firestore.Query = this.db.collection('falls').orderBy('timestamp', 'desc');
    if (userId) {
      query = this.db.collection('falls').where('userId', '==', userId).orderBy('timestamp', 'desc');
    }
    const snap = await query.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as FallEvent));
  }

  async addFallEvent(fall: FallEvent): Promise<void> {
    if (useLocalDb) {
      const falls = readJsonFile<FallEvent[]>('falls.json', []);
      const existingIdx = falls.findIndex(f => f.id === fall.id);
      if (existingIdx >= 0) {
        falls[existingIdx] = fall;
      } else {
        falls.push(fall);
      }
      writeJsonFile('falls.json', falls);
      return;
    }
    await this.db.collection('falls').doc(fall.id).set(fall);
  }

  async updateFallEventStatus(id: string, status: FallEvent['status']): Promise<FallEvent | undefined> {
    if (useLocalDb) {
      const falls = readJsonFile<FallEvent[]>('falls.json', []);
      const fall = falls.find(f => f.id === id);
      if (!fall) return undefined;
      fall.status = status;
      writeJsonFile('falls.json', falls);
      return fall;
    }
    const ref = this.db.collection('falls').doc(id);
    await ref.update({ status });
    const doc = await ref.get();
    if (!doc.exists) return undefined;
    return { id: doc.id, ...doc.data() } as FallEvent;
  }

  // ── Attendance ─────────────────────────────────────────────────────────────────
  async getAttendance(userId?: string): Promise<AttendanceRecord[]> {
    if (useLocalDb) {
      const attendance = readJsonFile<AttendanceRecord[]>('attendance.json', []);
      const filtered = userId ? attendance.filter(a => a.userId === userId) : attendance;
      return filtered.sort((a, b) => a.timestamp - b.timestamp);
    }
    let query: admin.firestore.Query = this.db.collection('attendance').orderBy('timestamp', 'asc');
    if (userId) {
      query = this.db.collection('attendance').where('userId', '==', userId).orderBy('timestamp', 'asc');
    }
    const snap = await query.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord));
  }

  async addAttendanceRecord(record: AttendanceRecord): Promise<void> {
    if (useLocalDb) {
      const attendance = readJsonFile<AttendanceRecord[]>('attendance.json', []);
      const existingIdx = attendance.findIndex(a => a.id === record.id);
      if (existingIdx >= 0) {
        attendance[existingIdx] = record;
      } else {
        attendance.push(record);
      }
      writeJsonFile('attendance.json', attendance);
      return;
    }
    await this.db.collection('attendance').doc(record.id).set(record);
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────────
  async getTasks(userId?: string): Promise<Task[]> {
    if (useLocalDb) {
      const tasks = readJsonFile<Task[]>('tasks.json', []);
      const filtered = userId ? tasks.filter(t => t.userId === userId) : tasks;
      return filtered.sort((a, b) => a.timestamp - b.timestamp);
    }
    let query: admin.firestore.Query = this.db.collection('tasks').orderBy('timestamp', 'asc');
    if (userId) {
      query = this.db.collection('tasks').where('userId', '==', userId).orderBy('timestamp', 'asc');
    }
    const snap = await query.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Task));
  }

  async addTask(task: Task): Promise<Task> {
    if (useLocalDb) {
      const tasks = readJsonFile<Task[]>('tasks.json', []);
      const existingIdx = tasks.findIndex(t => t.id === task.id);
      if (existingIdx >= 0) {
        tasks[existingIdx] = task;
      } else {
        tasks.push(task);
      }
      writeJsonFile('tasks.json', tasks);
      return task;
    }
    await this.db.collection('tasks').doc(task.id).set(task);
    return task;
  }

  async updateTaskStatus(id: string, status: Task['status']): Promise<Task | undefined> {
    if (useLocalDb) {
      const tasks = readJsonFile<Task[]>('tasks.json', []);
      const task = tasks.find(t => t.id === id);
      if (!task) return undefined;
      task.status = status;
      writeJsonFile('tasks.json', tasks);
      return task;
    }
    const ref = this.db.collection('tasks').doc(id);
    await ref.update({ status });
    const doc = await ref.get();
    if (!doc.exists) return undefined;
    return { id: doc.id, ...doc.data() } as Task;
  }

  // ── Alerts ─────────────────────────────────────────────────────────────────────
  async getAlerts(userId?: string): Promise<EmergencyAlert[]> {
    if (useLocalDb) {
      const alerts = readJsonFile<EmergencyAlert[]>('alerts.json', []);
      const filtered = userId ? alerts.filter(a => a.userId === userId) : alerts;
      return filtered.sort((a, b) => b.timestamp - a.timestamp);
    }
    let query: admin.firestore.Query = this.db.collection('alerts').orderBy('timestamp', 'desc');
    if (userId) {
      query = this.db.collection('alerts').where('userId', '==', userId).orderBy('timestamp', 'desc');
    }
    const snap = await query.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as EmergencyAlert));
  }

  async addAlert(alert: EmergencyAlert): Promise<EmergencyAlert> {
    if (useLocalDb) {
      const alerts = readJsonFile<EmergencyAlert[]>('alerts.json', []);
      const existingIdx = alerts.findIndex(a => a.id === alert.id);
      if (existingIdx >= 0) {
        alerts[existingIdx] = alert;
      } else {
        alerts.push(alert);
      }
      writeJsonFile('alerts.json', alerts);
      return alert;
    }
    await this.db.collection('alerts').doc(alert.id).set(alert);
    return alert;
  }

  async resolveAlert(id: string): Promise<EmergencyAlert | undefined> {
    if (useLocalDb) {
      const alerts = readJsonFile<EmergencyAlert[]>('alerts.json', []);
      const alert = alerts.find(a => a.id === id);
      if (!alert) return undefined;
      alert.status = 'resolved';
      alert.resolvedAt = Date.now();
      writeJsonFile('alerts.json', alerts);
      return alert;
    }
    const ref = this.db.collection('alerts').doc(id);
    const resolvedAt = Date.now();
    await ref.update({ status: 'resolved', resolvedAt });
    const doc = await ref.get();
    if (!doc.exists) return undefined;
    return { id: doc.id, ...doc.data() } as EmergencyAlert;
  }
}

export const db = new Database();
