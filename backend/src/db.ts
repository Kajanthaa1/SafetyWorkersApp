import * as admin from 'firebase-admin';
import * as path from 'path';
import crypto from 'crypto';

// ── Firebase Admin Initialization ───────────────────────────────────────────────
const serviceAccount = require(path.join(__dirname, '../serviceAccountKey.json'));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const firestore = admin.firestore();

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

// ── Database Class (Firestore-backed) ────────────────────────────────────────────
class Database {
  private db = firestore;

  // ── Seeding ────────────────────────────────────────────────────────────────────
  async seedIfNeeded(): Promise<void> {
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
    const snap = await this.db.collection('users').get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as User));
  }

  async getUserById(id: string): Promise<User | undefined> {
    const doc = await this.db.collection('users').doc(id).get();
    if (!doc.exists) return undefined;
    return { id: doc.id, ...doc.data() } as User;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
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
    await this.db.collection('users').doc(user.id).set(user);
    return user;
  }

  // ── Vitals ─────────────────────────────────────────────────────────────────────
  async getVitals(userId: string, minutes: number = 30): Promise<VitalReading[]> {
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
    await this.db.collection('vitals').add(reading);
  }

  // ── Falls ──────────────────────────────────────────────────────────────────────
  async getFalls(userId?: string): Promise<FallEvent[]> {
    let query: admin.firestore.Query = this.db.collection('falls').orderBy('timestamp', 'desc');
    if (userId) {
      query = this.db.collection('falls').where('userId', '==', userId).orderBy('timestamp', 'desc');
    }
    const snap = await query.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as FallEvent));
  }

  async addFallEvent(fall: FallEvent): Promise<void> {
    await this.db.collection('falls').doc(fall.id).set(fall);
  }

  async updateFallEventStatus(id: string, status: FallEvent['status']): Promise<FallEvent | undefined> {
    const ref = this.db.collection('falls').doc(id);
    await ref.update({ status });
    const doc = await ref.get();
    if (!doc.exists) return undefined;
    return { id: doc.id, ...doc.data() } as FallEvent;
  }

  // ── Attendance ─────────────────────────────────────────────────────────────────
  async getAttendance(userId?: string): Promise<AttendanceRecord[]> {
    let query: admin.firestore.Query = this.db.collection('attendance').orderBy('timestamp', 'asc');
    if (userId) {
      query = this.db.collection('attendance').where('userId', '==', userId).orderBy('timestamp', 'asc');
    }
    const snap = await query.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord));
  }

  async addAttendanceRecord(record: AttendanceRecord): Promise<void> {
    await this.db.collection('attendance').doc(record.id).set(record);
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────────
  async getTasks(userId?: string): Promise<Task[]> {
    let query: admin.firestore.Query = this.db.collection('tasks').orderBy('timestamp', 'asc');
    if (userId) {
      query = this.db.collection('tasks').where('userId', '==', userId).orderBy('timestamp', 'asc');
    }
    const snap = await query.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as Task));
  }

  async addTask(task: Task): Promise<Task> {
    await this.db.collection('tasks').doc(task.id).set(task);
    return task;
  }

  async updateTaskStatus(id: string, status: Task['status']): Promise<Task | undefined> {
    const ref = this.db.collection('tasks').doc(id);
    await ref.update({ status });
    const doc = await ref.get();
    if (!doc.exists) return undefined;
    return { id: doc.id, ...doc.data() } as Task;
  }

  // ── Alerts ─────────────────────────────────────────────────────────────────────
  async getAlerts(userId?: string): Promise<EmergencyAlert[]> {
    let query: admin.firestore.Query = this.db.collection('alerts').orderBy('timestamp', 'desc');
    if (userId) {
      query = this.db.collection('alerts').where('userId', '==', userId).orderBy('timestamp', 'desc');
    }
    const snap = await query.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() } as EmergencyAlert));
  }

  async addAlert(alert: EmergencyAlert): Promise<EmergencyAlert> {
    await this.db.collection('alerts').doc(alert.id).set(alert);
    return alert;
  }

  async resolveAlert(id: string): Promise<EmergencyAlert | undefined> {
    const ref = this.db.collection('alerts').doc(id);
    const resolvedAt = Date.now();
    await ref.update({ status: 'resolved', resolvedAt });
    const doc = await ref.get();
    if (!doc.exists) return undefined;
    return { id: doc.id, ...doc.data() } as EmergencyAlert;
  }
}

export const db = new Database();
