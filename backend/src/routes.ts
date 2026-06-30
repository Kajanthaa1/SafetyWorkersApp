import { Router, Request, Response } from 'express';
import { db, User } from './db';

export const router = Router();

// Helper to notify socket listeners (attached in server.ts)
export let socketEmitter: ((event: string, data: any) => void) | null = null;
export function setSocketEmitter(emitter: (event: string, data: any) => void) {
  socketEmitter = emitter;
}

// 1. Auth Login
router.post('/auth/login', (req: Request, res: Response) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'Username is required' });
  }

  const user = db.getUserByUsername(username);
  if (!user) {
    return res.status(404).json({ error: 'User not found. Try worker1, worker2, or supervisor1.' });
  }

  return res.json(user);
});

// Get all workers (for supervisor)
router.get('/users/workers', (req: Request, res: Response) => {
  const workers = db.getUsers().filter(u => u.role === 'worker');
  return res.json(workers);
});

// 2. Vitals
router.get('/vitals/:userId', (req: Request, res: Response) => {
  const { userId } = req.params;
  const minutes = req.query.minutes ? parseInt(req.query.minutes as string) : 30;
  const readings = db.getVitals(userId, minutes);
  return res.json(readings);
});

const consecutiveAbnormalCounts: Record<string, number> = {};

router.post('/vitals', (req: Request, res: Response) => {
  const { userId, bpm, spo2 } = req.body;
  if (!userId || bpm === undefined || spo2 === undefined) {
    return res.status(400).json({ error: 'userId, bpm, and spo2 are required' });
  }

  const user = db.getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const parsedBpm = Number(bpm);
  const parsedSpo2 = Number(spo2);
  const reading = {
    userId,
    bpm: parsedBpm,
    spo2: parsedSpo2,
    timestamp: Date.now()
  };

  db.addVitalReading(reading);

  // Vitals Safety ranges: HR 60-140 during work, SpO2 >= 92%
  const isAbnormal = parsedBpm < 60 || parsedBpm > 140 || parsedSpo2 < 92;

  if (isAbnormal) {
    consecutiveAbnormalCounts[userId] = (consecutiveAbnormalCounts[userId] || 0) + 1;
  } else {
    consecutiveAbnormalCounts[userId] = 0;
  }

  let triggeredAlert = false;
  // Trigger health alarm only after 3 consecutive abnormal readings to avoid noise
  if (consecutiveAbnormalCounts[userId] === 3) {
    triggeredAlert = true;
    const newAlert = {
      id: `alert_${Date.now()}`,
      userId,
      type: 'health' as const,
      status: 'active' as const,
      timestamp: Date.now()
    };
    db.addAlert(newAlert);

    if (socketEmitter) {
      socketEmitter('new_alert', {
        userId,
        name: user.name,
        alert: newAlert
      });
    }
  }

  // Notify socket listeners of new vitals
  if (socketEmitter) {
    socketEmitter('vitals_update', {
      userId,
      name: user.name,
      reading,
      consecutiveAbnormalCount: consecutiveAbnormalCounts[userId],
      triggeredAlert
    });
  }

  return res.status(201).json({
    ...reading,
    consecutiveAbnormalCount: consecutiveAbnormalCounts[userId],
    triggeredAlert
  });
});

// 3. Attendance
router.get('/attendance/:userId', (req: Request, res: Response) => {
  const { userId } = req.params;
  const history = db.getAttendance(userId);
  return res.json(history);
});

router.get('/attendance', (req: Request, res: Response) => {
  const history = db.getAttendance();
  return res.json(history);
});

router.post('/attendance', (req: Request, res: Response) => {
  const { userId, action, latitude, longitude } = req.body;
  if (!userId || !action || latitude === undefined || longitude === undefined) {
    return res.status(400).json({ error: 'userId, action, latitude, and longitude are required' });
  }

  const user = db.getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const record = {
    id: `att_${Date.now()}`,
    userId,
    action: action as 'clock_in' | 'clock_out',
    timestamp: Date.now(),
    latitude: Number(latitude),
    longitude: Number(longitude)
  };

  db.addAttendanceRecord(record);

  if (socketEmitter) {
    socketEmitter('attendance_update', {
      userId,
      name: user.name,
      record
    });
  }

  return res.status(201).json(record);
});

// 4. Tasks
router.get('/tasks', (req: Request, res: Response) => {
  const userId = req.query.userId as string | undefined;
  const tasks = db.getTasks(userId);
  return res.json(tasks);
});

router.post('/tasks', (req: Request, res: Response) => {
  const { userId, title, assignedBy } = req.body;
  if (!userId || !title || !assignedBy) {
    return res.status(400).json({ error: 'userId, title, and assignedBy are required' });
  }

  const user = db.getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const newTask = {
    id: `task_${Date.now()}`,
    userId,
    title,
    status: 'pending' as const,
    assignedBy,
    timestamp: Date.now()
  };

  db.addTask(newTask);

  if (socketEmitter) {
    socketEmitter('task_update', {
      userId,
      task: newTask
    });
  }

  return res.status(201).json(newTask);
});

router.patch('/tasks/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status || !['pending', 'in_progress', 'done'].includes(status)) {
    return res.status(400).json({ error: 'Valid status is required (pending, in_progress, done)' });
  }

  const updatedTask = db.updateTaskStatus(id, status);
  if (!updatedTask) {
    return res.status(404).json({ error: 'Task not found' });
  }

  if (socketEmitter) {
    socketEmitter('task_update', {
      userId: updatedTask.userId,
      task: updatedTask
    });
  }

  return res.json(updatedTask);
});

// 5. Alerts / SOS
router.get('/alerts', (req: Request, res: Response) => {
  const userId = req.query.userId as string | undefined;
  const alerts = db.getAlerts(userId);
  return res.json(alerts);
});

router.post('/alerts', (req: Request, res: Response) => {
  const { userId, type } = req.body;
  if (!userId || !type || !['manual', 'fall', 'health'].includes(type)) {
    return res.status(400).json({ error: 'userId and type (manual, fall, or health) are required' });
  }

  const user = db.getUserById(userId);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const newAlert = {
    id: `alert_${Date.now()}`,
    userId,
    type: type as 'manual' | 'fall' | 'health',
    status: 'active' as const,
    timestamp: Date.now()
  };

  db.addAlert(newAlert);

  if (socketEmitter) {
    socketEmitter('new_alert', {
      userId,
      name: user.name,
      alert: newAlert
    });
  }

  return res.status(201).json(newAlert);
});

router.patch('/alerts/:id/resolve', (req: Request, res: Response) => {
  const { id } = req.params;
  const resolvedAlert = db.resolveAlert(id);
  if (!resolvedAlert) {
    return res.status(404).json({ error: 'Alert not found' });
  }

  if (socketEmitter) {
    socketEmitter('alert_resolved', {
      userId: resolvedAlert.userId,
      alert: resolvedAlert
    });
  }

  return res.json(resolvedAlert);
});

// 6. Weather & Site Conditions Simulator
router.get('/weather', (req: Request, res: Response) => {
  const lat = req.query.lat ? parseFloat(req.query.lat as string) : 40.7128;
  const lon = req.query.lon ? parseFloat(req.query.lon as string) : -74.0060;

  // Let's generate weather conditions dynamically based on coordinates and current time
  const time = Date.now();
  const seed = lat + lon + time / 100000;

  // Modulo math for consistent but changing values
  const tempC = Math.round(15 + (seed % 20)); // 15 to 35 C
  const windKnots = Math.round(5 + (seed % 30)); // 5 to 35 knots
  const precipitationPct = Math.round((seed % 10) * 10); // 0% to 100%

  // Determine hazards
  const highWind = windKnots > 22; // High wind hazard for high-rise work is >22 knots
  const lightningRisk = precipitationPct > 70 && (seed % 3 > 1.5);
  const heatIndexDanger = tempC > 33; // Extreme heat hazard

  const hazards: string[] = [];
  if (highWind) hazards.push('High Wind Alert (>22 knots)');
  if (lightningRisk) hazards.push('Lightning Warning Detected');
  if (heatIndexDanger) hazards.push('Extreme Heat Index Alert');

  const safeToWork = hazards.length === 0;

  let recommendation = 'Safe to work at height.';
  if (!safeToWork) {
    recommendation = `SUSPEND outdoor high-rise activities due to: ${hazards.join(', ')}.`;
  }

  return res.json({
    coordinates: { lat, lon },
    temperature: tempC,
    windSpeed: windKnots,
    precipitation: precipitationPct,
    hazards,
    safeToWork,
    recommendation
  });
});
