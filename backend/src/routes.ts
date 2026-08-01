import { Router, Request, Response } from 'express';
import https from 'https';
import { db, User, hashPassword } from './db';

export const router = Router();

// ── Socket Emitter ─────────────────────────────────────────────────────────────
export let socketEmitter: ((event: string, data: any) => void) | null = null;
export function setSocketEmitter(emitter: (event: string, data: any) => void) {
  socketEmitter = emitter;
}

// ── Helper: Device Token Auth ──────────────────────────────────────────────────
async function getDeviceUser(req: Request): Promise<User | null> {
  const authHeader = req.headers['authorization'];
  let token = req.headers['x-device-token'] as string;

  if (!token && authHeader && authHeader.startsWith('Device ')) {
    token = authHeader.substring(7).trim();
  }
  if (!token) return null;

  return await db.getUserByDeviceToken(token) || null;
}

// ── Helper: Fetch OpenWeatherMap real weather ──────────────────────────────────────
const OWM_API_KEY = 'a1847fbc4fe0b3d668f78717f250733b';

function fetchOpenWeatherMap(lat: number, lon: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${OWM_API_KEY}&units=metric`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Helper: Consecutive abnormal count (in-memory, per worker) ─────────────────
const consecutiveAbnormalCounts: Record<string, number> = {};

// ── Vitals processing (shared by BLE & GSM routes) ────────────────────────────
async function processVitalReading(
  user: User,
  bpm: number,
  spo2: number,
  gx?: number,
  gy?: number,
  gz?: number,
  source: 'ble' | 'gsm' = 'ble'
) {
  const parsedBpm = Number(bpm);
  const parsedSpo2 = Number(spo2);
  const parsedGx = gx !== undefined ? Number(gx) : 0;
  const parsedGy = gy !== undefined ? Number(gy) : 0;
  const parsedGz = gz !== undefined ? Number(gz) : 0;
  const userId = user.id;

  const reading = {
    userId,
    bpm: parsedBpm,
    spo2: parsedSpo2,
    gx: parsedGx,
    gy: parsedGy,
    gz: parsedGz,
    timestamp: Date.now(),
    source,
  };

  await db.addVitalReading(reading);

  const isAbnormal = parsedBpm < 60 || parsedBpm > 140 || parsedSpo2 < 92;
  if (isAbnormal) {
    consecutiveAbnormalCounts[userId] = (consecutiveAbnormalCounts[userId] || 0) + 1;
  } else {
    consecutiveAbnormalCounts[userId] = 0;
  }

  let triggeredAlert = false;
  if (consecutiveAbnormalCounts[userId] === 3) {
    triggeredAlert = true;
    const newAlert = {
      id: `alert_${Date.now()}`,
      userId,
      type: 'health' as const,
      status: 'active' as const,
      timestamp: Date.now(),
    };
    await db.addAlert(newAlert);
    if (socketEmitter) {
      socketEmitter('new_alert', { userId, name: user.name, alert: newAlert });
    }
  }

  if (socketEmitter) {
    socketEmitter('vitals_update', {
      userId,
      name: user.name,
      reading,
      consecutiveAbnormalCount: consecutiveAbnormalCounts[userId],
      triggeredAlert,
    });
  }

  return {
    ...reading,
    consecutiveAbnormalCount: consecutiveAbnormalCounts[userId],
    triggeredAlert,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. AUTH ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/auth/signup — create a new user account
router.post('/auth/signup', async (req: Request, res: Response) => {
  try {
    const { name, username, password, role } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Full name is required' });
    if (!username || !username.trim()) return res.status(400).json({ error: 'Username is required' });
    if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const userRole = role === 'admin' ? 'admin' : 'worker';

    const existing = await db.getUserByUsername(username.trim().toLowerCase());
    if (existing) return res.status(409).json({ error: 'Username already exists. Please choose another.' });

    const newUser: User = {
      id: `${userRole}_${Date.now()}`,
      username: username.trim().toLowerCase(),
      name: name.trim(),
      role: userRole,
      passwordHash: hashPassword(password),
      deviceToken: `device_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    };

    await db.addUser(newUser);
    console.log(`[Auth] New ${userRole} registered: ${newUser.username} (${newUser.name})`);
    return res.status(201).json(newUser);
  } catch (err: any) {
    console.error('[Auth] Signup error:', err);
    return res.status(500).json({ error: 'Server error during signup' });
  }
});

// POST /api/auth/login — authenticate a user and auto-record attendance (workers)
router.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { username, password, latitude, longitude } = req.body;
    if (!username) return res.status(400).json({ error: 'Username is required' });
    if (!password) return res.status(400).json({ error: 'Password is required' });

    const user = await db.getUserByUsername(username.trim().toLowerCase());
    if (!user) return res.status(404).json({ error: 'User not found. Please sign up first.' });

    if (user.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    // Auto clock-in attendance for workers on login
    if (user.role === 'worker') {
      const lat = Number(latitude) || 0;
      const lon = Number(longitude) || 0;
      const attendanceRecord = {
        id: `att_${Date.now()}`,
        userId: user.id,
        action: 'clock_in' as const,
        timestamp: Date.now(),
        latitude: lat,
        longitude: lon,
      };
      await db.addAttendanceRecord(attendanceRecord);

      if (socketEmitter) {
        socketEmitter('attendance_update', {
          userId: user.id,
          name: user.name,
          record: attendanceRecord,
        });
      }
      console.log(`[Auth] Worker ${user.name} clocked IN on login.`);
    }

    return res.json(user);
  } catch (err: any) {
    console.error('[Auth] Login error:', err);
    return res.status(500).json({ error: 'Server error during login' });
  }
});

// POST /api/auth/logout — auto clock-out worker
router.post('/auth/logout', async (req: Request, res: Response) => {
  try {
    const { userId, latitude, longitude } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const user = await db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (user.role === 'worker') {
      const attendanceRecord = {
        id: `att_${Date.now()}`,
        userId: user.id,
        action: 'clock_out' as const,
        timestamp: Date.now(),
        latitude: Number(latitude) || 0,
        longitude: Number(longitude) || 0,
      };
      await db.addAttendanceRecord(attendanceRecord);
      if (socketEmitter) {
        socketEmitter('attendance_update', { userId: user.id, name: user.name, record: attendanceRecord });
      }
      console.log(`[Auth] Worker ${user.name} clocked OUT on logout.`);
    }

    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Auth] Logout error:', err);
    return res.status(500).json({ error: 'Server error during logout' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. USERS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/users/workers', async (req: Request, res: Response) => {
  try {
    const users = await db.getUsers();
    return res.json(users.filter(u => u.role === 'worker'));
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch workers' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. VITALS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/vitals/:userId', async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const minutes = req.query.minutes ? parseInt(req.query.minutes as string) : 30;
    const readings = await db.getVitals(userId, minutes);
    return res.json(readings);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch vitals' });
  }
});

router.post('/vitals', async (req: Request, res: Response) => {
  try {
    const { userId, bpm, spo2, gx, gy, gz, source } = req.body;
    if (!userId || bpm === undefined || spo2 === undefined) {
      return res.status(400).json({ error: 'userId, bpm, and spo2 are required' });
    }
    const user = await db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const result = await processVitalReading(user, bpm, spo2, gx, gy, gz, source || 'ble');
    return res.status(201).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to submit vitals' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. GSM DEVICE ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────
router.post('/device/vitals', async (req: Request, res: Response) => {
  try {
    const user = await getDeviceUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized: Invalid Device Token' });

    const { bpm, spo2, gx, gy, gz } = req.body;
    if (bpm === undefined || spo2 === undefined) {
      return res.status(400).json({ error: 'bpm and spo2 are required' });
    }
    console.log(`[Device] Vitals from ${user.name}: BPM=${bpm}, SpO2=${spo2}%, Gyro=(${gx || 0}, ${gy || 0}, ${gz || 0})`);
    const result = await processVitalReading(user, bpm, spo2, gx, gy, gz, 'gsm');
    return res.status(201).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to process device vitals' });
  }
});

router.post('/device/alert', async (req: Request, res: Response) => {
  try {
    const user = await getDeviceUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized: Invalid Device Token' });

    const { type } = req.body;
    if (!type || !['manual', 'fall', 'health'].includes(type)) {
      return res.status(400).json({ error: 'type (manual, fall, or health) is required' });
    }
    const newAlert = {
      id: `alert_${Date.now()}`,
      userId: user.id,
      type: type as 'manual' | 'fall' | 'health',
      status: 'active' as const,
      timestamp: Date.now(),
    };
    await db.addAlert(newAlert);
    if (socketEmitter) {
      socketEmitter('new_alert', { userId: user.id, name: user.name, alert: newAlert });
    }
    return res.status(201).json(newAlert);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to trigger device alert' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. ATTENDANCE
// ─────────────────────────────────────────────────────────────────────────────
router.get('/attendance/:userId', async (req: Request, res: Response) => {
  try {
    const history = await db.getAttendance(req.params.userId);
    return res.json(history);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

router.get('/attendance', async (req: Request, res: Response) => {
  try {
    const history = await db.getAttendance();
    return res.json(history);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

router.post('/attendance', async (req: Request, res: Response) => {
  try {
    const { userId, action, latitude, longitude } = req.body;
    if (!userId || !action || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'userId, action, latitude, and longitude are required' });
    }
    const user = await db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const record = {
      id: `att_${Date.now()}`,
      userId,
      action: action as 'clock_in' | 'clock_out',
      timestamp: Date.now(),
      latitude: Number(latitude),
      longitude: Number(longitude),
    };
    await db.addAttendanceRecord(record);
    if (socketEmitter) {
      socketEmitter('attendance_update', { userId, name: user.name, record });
    }
    return res.status(201).json(record);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to submit attendance' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. TASKS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/tasks', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string | undefined;
    const tasks = await db.getTasks(userId);
    return res.json(tasks);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

router.post('/tasks', async (req: Request, res: Response) => {
  try {
    const { userId, title, assignedBy } = req.body;
    if (!userId || !title || !assignedBy) {
      return res.status(400).json({ error: 'userId, title, and assignedBy are required' });
    }
    const user = await db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newTask = {
      id: `task_${Date.now()}`,
      userId,
      title,
      status: 'pending' as const,
      assignedBy,
      timestamp: Date.now(),
    };
    await db.addTask(newTask);
    if (socketEmitter) {
      socketEmitter('task_update', { userId, task: newTask });
    }
    return res.status(201).json(newTask);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create task' });
  }
});

router.patch('/tasks/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !['pending', 'in_progress', 'done'].includes(status)) {
      return res.status(400).json({ error: 'Valid status is required (pending, in_progress, done)' });
    }
    const updatedTask = await db.updateTaskStatus(id, status);
    if (!updatedTask) return res.status(404).json({ error: 'Task not found' });

    if (socketEmitter) {
      socketEmitter('task_update', { userId: updatedTask.userId, task: updatedTask });
    }
    return res.json(updatedTask);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to update task' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. ALERTS / SOS
// ─────────────────────────────────────────────────────────────────────────────
router.get('/alerts', async (req: Request, res: Response) => {
  try {
    const userId = req.query.userId as string | undefined;
    const alerts = await db.getAlerts(userId);
    return res.json(alerts);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to fetch alerts' });
  }
});

router.post('/alerts', async (req: Request, res: Response) => {
  try {
    const { userId, type } = req.body;
    if (!userId || !type || !['manual', 'fall', 'health'].includes(type)) {
      return res.status(400).json({ error: 'userId and type (manual, fall, or health) are required' });
    }
    const user = await db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const newAlert = {
      id: `alert_${Date.now()}`,
      userId,
      type: type as 'manual' | 'fall' | 'health',
      status: 'active' as const,
      timestamp: Date.now(),
    };
    await db.addAlert(newAlert);
    if (socketEmitter) {
      socketEmitter('new_alert', { userId, name: user.name, alert: newAlert });
    }
    return res.status(201).json(newAlert);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to create alert' });
  }
});

router.patch('/alerts/:id/resolve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const resolvedAlert = await db.resolveAlert(id);
    if (!resolvedAlert) return res.status(404).json({ error: 'Alert not found' });

    if (socketEmitter) {
      socketEmitter('alert_resolved', { userId: resolvedAlert.userId, alert: resolvedAlert });
    }
    return res.json(resolvedAlert);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to resolve alert' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. REAL-TIME WEATHER (OpenWeatherMap)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/weather', async (req: Request, res: Response) => {
  const lat = req.query.lat ? parseFloat(req.query.lat as string) : 0;
  const lon = req.query.lon ? parseFloat(req.query.lon as string) : 0;

  try {
    const weatherData = await fetchOpenWeatherMap(lat, lon);
    
    if (weatherData.cod !== 200) {
      throw new Error(weatherData.message || 'Error fetching weather');
    }

    const tempC = Math.round(weatherData.main.temp);
    // OpenWeatherMap returns wind speed in m/s (metric). Convert to knots: 1 m/s = 1.94384 knots
    const windKnots = Math.round(weatherData.wind.speed * 1.94384);
    // Precipitation (1h rain volume in mm). It might be missing if no rain.
    const precipitationMm = weatherData.rain && weatherData.rain['1h'] ? parseFloat(weatherData.rain['1h'].toFixed(1)) : 0;
    const humidity = Math.round(weatherData.main.humidity);
    
    // OpenWeatherMap provides its own text descriptions (e.g., "broken clouds")
    let description = 'Unknown';
    let weatherCode = 800; // default clear
    if (weatherData.weather && weatherData.weather.length > 0) {
      description = weatherData.weather[0].description;
      // Capitalize first letter
      description = description.charAt(0).toUpperCase() + description.slice(1);
      weatherCode = weatherData.weather[0].id;
    }

    // Safety hazard evaluation
    const highWind = windKnots > 22;
    const lightningRisk = weatherCode >= 200 && weatherCode < 300; // Thunderstorm codes in OWM
    const heatIndexDanger = tempC > 33;
    const heavyRain = precipitationMm > 5;

    const hazards: string[] = [];
    if (highWind) hazards.push('High Wind Alert (>22 knots)');
    if (lightningRisk) hazards.push('Lightning Warning Detected');
    if (heatIndexDanger) hazards.push('Extreme Heat Index Alert');
    if (heavyRain) hazards.push('Heavy Precipitation Warning');

    const safeToWork = hazards.length === 0;
    let recommendation = 'Safe to work at height.';
    if (!safeToWork) {
      recommendation = `SUSPEND outdoor high-rise activities due to: ${hazards.join(', ')}.`;
    }

    return res.json({
      locationName: weatherData.name || 'Unknown Location',
      coordinates: { lat, lon },
      temperature: tempC,
      windSpeed: windKnots,
      precipitation: precipitationMm,
      humidity,
      description,
      weatherCode,
      hazards,
      safeToWork,
      recommendation,
      source: 'OpenWeatherMap',
    });
  } catch (err: any) {
    console.error('[Weather] OpenWeatherMap fetch failed:', err.message);
    return res.status(503).json({ error: 'Weather service temporarily unavailable. Check your internet connection.' });
  }
});
