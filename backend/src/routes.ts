import { Router, Request, Response } from 'express';
import http from 'http';
import https from 'https';
import { db, User, hashPassword } from './db';

export const router = Router();

// ── Socket Emitter ─────────────────────────────────────────────────────────────
export let socketEmitter: ((event: string, data: any) => void) | null = null;
export function setSocketEmitter(emitter: (event: string, data: any) => void) {
  socketEmitter = emitter;
}
export function emitSocket(event: string, data: any) {
  if (socketEmitter) {
    socketEmitter(event, data);
  } else if ((global as any).io) {
    (global as any).io.emit(event, data);
  } else {
    console.warn(`[Socket] Neither socketEmitter nor global.io is available to emit: ${event}`);
  }
}

// ── Helper: Device Token Auth ──────────────────────────────────────────────────
async function getDeviceUser(req: Request): Promise<User | null> {
  const authHeader = req.headers['authorization'];
  let token = req.headers['x-device-token'] as string;

  if (!token && authHeader && authHeader.startsWith('Device ')) {
    token = authHeader.substring(7).trim();
  }
  if (!token) return null;

  // Check for active worker sanoo1 and automatically bind hardware token to sanoo1
  const sanooUser = await db.getUserByUsername('sanoo1');
  if (sanooUser) {
    if (sanooUser.deviceToken !== token) {
      sanooUser.deviceToken = token;
      await db.updateUserDeviceToken(sanooUser.id, token);
    }
    return sanooUser;
  }

  const found = await db.getUserByDeviceToken(token);
  if (found) return found;

  // Fallback: If device token is default hardware token, return last registered worker
  const users = await db.getUsers();
  const worker = users.filter(u => u.role === 'worker').pop();
  return worker || null;
}

// ── Helper: Fetch OpenWeatherMap real weather ──────────────────────────────────────
const OWM_API_KEY = 'a1847fbc4fe0b3d668f78717f250733b';

function fetchJson(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function fetchOpenWeatherMap(options: { lat?: number; lon?: number; city?: string }): Promise<any> {
  let url = '';
  if (options.city && options.city.trim()) {
    url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(options.city.trim())}&appid=${OWM_API_KEY}&units=metric`;
  } else if (options.lat !== undefined && options.lon !== undefined && (options.lat !== 0 || options.lon !== 0)) {
    url = `https://api.openweathermap.org/data/2.5/weather?lat=${options.lat}&lon=${options.lon}&appid=${OWM_API_KEY}&units=metric`;
  } else {
    // If coordinates are 0,0 or missing, auto-detect location via IP
    try {
      const ipInfo = await fetchJson('http://ip-api.com/json');
      if (ipInfo && ipInfo.status === 'success' && ipInfo.lat && ipInfo.lon) {
        url = `https://api.openweathermap.org/data/2.5/weather?lat=${ipInfo.lat}&lon=${ipInfo.lon}&appid=${OWM_API_KEY}&units=metric`;
      }
    } catch (e) {
      console.warn('[Weather] IP geolocation lookup failed in backend:', e);
    }
  }

  // If still empty, default to detected regional center
  if (!url) {
    url = `https://api.openweathermap.org/data/2.5/weather?lat=6.9318&lon=79.8863&appid=${OWM_API_KEY}&units=metric`;
  }

  return fetchJson(url);
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
  source: 'ble' | 'gsm' = 'ble',
  altitude?: number,
  floorLevel?: number
) {
  const parsedBpm = Number(bpm);
  const parsedSpo2 = Number(spo2);
  const parsedGx = gx !== undefined ? Number(gx) : 0;
  const parsedGy = gy !== undefined ? Number(gy) : 0;
  const parsedGz = gz !== undefined ? Number(gz) : 0;
  const parsedAltitude = altitude !== undefined ? Number(altitude) : 1.5;
  const parsedFloor = floorLevel !== undefined ? Number(floorLevel) : Math.floor(parsedAltitude / 3) + 1;
  const userId = user.id;

  const reading = {
    userId,
    bpm: parsedBpm,
    spo2: parsedSpo2,
    gx: parsedGx,
    gy: parsedGy,
    gz: parsedGz,
    altitude: parsedAltitude,
    floorLevel: parsedFloor,
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
    emitSocket('new_alert', { userId, name: user.name, alert: newAlert });
  }

  emitSocket('vitals_update', {
    userId,
    name: user.name,
    reading,
    consecutiveAbnormalCount: consecutiveAbnormalCounts[userId],
    triggeredAlert,
  });

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
    const { userId, bpm, spo2, gx, gy, gz, altitude, floorLevel, source } = req.body;
    if (!userId || bpm === undefined || spo2 === undefined) {
      return res.status(400).json({ error: 'userId, bpm, and spo2 are required' });
    }
    const user = await db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const result = await processVitalReading(user, bpm, spo2, gx, gy, gz, source || 'ble', altitude, floorLevel);
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

    const { bpm, spo2, gx, gy, gz, altitude, floorLevel } = req.body;
    if (bpm === undefined || spo2 === undefined) {
      return res.status(400).json({ error: 'bpm and spo2 are required' });
    }
    console.log(`[Device] Vitals from ${user.name}: BPM=${bpm}, SpO2=${spo2}%, Gyro=(${gx || 0}, ${gy || 0}, ${gz || 0}), Altitude=${altitude || 1.5}m`);
    const result = await processVitalReading(user, bpm, spo2, gx, gy, gz, 'gsm', altitude, floorLevel);
    return res.status(201).json(result);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to process device vitals' });
  }
});

router.post('/device/alert', async (req: Request, res: Response) => {
  try {
    const user = await getDeviceUser(req);
    if (!user) return res.status(401).json({ error: 'Unauthorized: Invalid Device Token' });

    const { type, severity } = req.body;
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

    if (type === 'fall') {
      const fallEvent = {
        id: `fall_${Date.now()}`,
        userId: user.id,
        timestamp: Date.now(),
        severity: (severity as 'minor' | 'confirmed') || 'confirmed',
        status: 'confirmed' as const,
      };
      await db.addFallEvent(fallEvent);
      if (socketEmitter) {
        socketEmitter('new_fall', { userId: user.id, name: user.name, fall: fallEvent });
      }
    }

    if (socketEmitter) {
      socketEmitter('new_alert', { userId: user.id, name: user.name, alert: newAlert });
    }
    return res.status(201).json(newAlert);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to trigger device alert' });
  }
});

router.post('/sensor', async (req: Request, res: Response) => {
  try {
    const { workerId, bpm, spo2, gx, gy, gz, fall, alert, imuOnline } = req.body;
    
    // Find user by username or ID, normalizing worker01 <-> worker1
    let user = await db.getUserByUsername(workerId);
    if (!user && workerId) {
      user = await db.getUserById(workerId);
    }
    if (!user && workerId) {
      const normalized = workerId.toLowerCase().replace(/worker0+([1-9]\d*)/, 'worker$1');
      user = (await db.getUserByUsername(normalized)) || (await db.getUserById(normalized));
    }
    if (!user) {
      const sanooUser = await db.getUserByUsername('sanoo1');
      if (sanooUser) user = sanooUser;
    }
    if (!user) {
      // Fallback: return last registered worker
      const users = await db.getUsers();
      user = users.filter(u => u.role === 'worker').pop() || null;
    }
    
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (alert && fall) {
        // Trigger fall alert
        const newAlert = {
          id: `alert_${Date.now()}`,
          userId: user.id,
          type: 'fall' as const,
          status: 'active' as const,
          timestamp: Date.now(),
        };
        await db.addAlert(newAlert);

        const fallEvent = {
          id: `fall_${Date.now()}`,
          userId: user.id,
          timestamp: Date.now(),
          severity: 'confirmed' as const,
          status: 'confirmed' as const,
        };
        await db.addFallEvent(fallEvent);

        emitSocket('new_fall', { userId: user.id, name: user.name, fall: fallEvent });
        emitSocket('new_alert', { userId: user.id, name: user.name, alert: newAlert });
    }
    
    console.log(`[Sensor] Inbound from ${workerId}: BPM=${bpm}, SpO2=${spo2}, user=${user.name} (${user.id})`);
    if (bpm !== null || spo2 !== null) {
      // Process vitals with fallback if one is momentarily null
      const safeBpm = bpm !== null ? Number(bpm) : 75;
      const safeSpo2 = spo2 !== null ? Number(spo2) : 98;
      await processVitalReading(user, safeBpm, safeSpo2, gx, gy, gz, 'gsm', 1.5, 1);

      // If mapped user is worker1 and active worker sanoo1 is also in system, keep sanoo1 synced
      if (user.username !== 'sanoo1') {
        const sanooUser = await db.getUserByUsername('sanoo1');
        if (sanooUser) {
          await processVitalReading(sanooUser, safeBpm, safeSpo2, gx, gy, gz, 'gsm', 1.5, 1);
        }
      }
    } else if (gx !== undefined || gy !== undefined || gz !== undefined) {
      // Even if finger is momentarily off, stream live motion / gyro to worker app
      emitSocket('vitals_update', {
        userId: user.id,
        name: user.name,
        reading: {
          userId: user.id,
          bpm: 0,
          spo2: 0,
          gx: Number(gx || 0),
          gy: Number(gy || 0),
          gz: Number(gz || 0),
          timestamp: Date.now(),
          source: 'gsm',
        },
      });
    }
    
    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('Error in /sensor:', err);
    return res.status(500).json({ error: 'Failed to process sensor data' });
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
  const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
  const lon = req.query.lon ? parseFloat(req.query.lon as string) : undefined;
  const city = req.query.city ? (req.query.city as string) : undefined;

  try {
    const weatherData = await fetchOpenWeatherMap({ lat, lon, city });
    
    if (weatherData.cod !== 200) {
      throw new Error(weatherData.message || 'Error fetching weather');
    }

    const tempC = Math.round(weatherData.main.temp);
    const feelsLikeC = Math.round(weatherData.main.feels_like ?? tempC);

    // Wind speed:
    // OpenWeatherMap returns wind speed in m/s (metric).
    // Convert to km/h: 1 m/s = 3.6 km/h
    // Convert to knots: 1 m/s = 1.94384 knots
    const windSpeedMs = parseFloat((weatherData.wind?.speed || 0).toFixed(1));
    const windSpeedKmH = Math.round(windSpeedMs * 3.6);
    const windKnots = Math.round(windSpeedMs * 1.94384);

    // Precipitation (rain volume in mm).
    let precipitationMm = 0;
    if (weatherData.rain) {
      if (typeof weatherData.rain['1h'] === 'number') {
        precipitationMm = parseFloat(weatherData.rain['1h'].toFixed(1));
      } else if (typeof weatherData.rain['3h'] === 'number') {
        precipitationMm = parseFloat((weatherData.rain['3h'] / 3).toFixed(1));
      }
    } else if (weatherData.snow) {
      if (typeof weatherData.snow['1h'] === 'number') {
        precipitationMm = parseFloat(weatherData.snow['1h'].toFixed(1));
      }
    }
    const humidity = Math.round(weatherData.main.humidity);
    
    // OpenWeatherMap provides its own text descriptions (e.g., "broken clouds")
    let description = 'Clear Sky';
    let weatherCode = 800; // default clear
    if (weatherData.weather && weatherData.weather.length > 0) {
      description = weatherData.weather[0].description;
      // Capitalize first letter
      description = description.charAt(0).toUpperCase() + description.slice(1);
      weatherCode = weatherData.weather[0].id;
    }

    // Safety hazard evaluation:
    // Working at height threshold: > 38 km/h (~20 knots)
    const highWind = windSpeedKmH > 38 || windKnots > 20;
    const lightningRisk = weatherCode >= 200 && weatherCode < 300; // Thunderstorm codes in OWM
    const heatIndexDanger = feelsLikeC >= 35 || tempC >= 35;
    const heavyRain = precipitationMm > 5 || (weatherCode >= 502 && weatherCode <= 504);

    const hazards: string[] = [];
    if (highWind) hazards.push(`High Wind Alert (${windSpeedKmH} km/h)`);
    if (lightningRisk) hazards.push('Lightning Warning Detected');
    if (heatIndexDanger) hazards.push(`Extreme Heat Index (${feelsLikeC}°C)`);
    if (heavyRain) hazards.push('Heavy Precipitation Warning');

    const safeToWork = hazards.length === 0;
    let recommendation = 'Safe to work at height.';
    if (!safeToWork) {
      recommendation = `SUSPEND outdoor high-rise activities due to: ${hazards.join(', ')}.`;
    }

    return res.json({
      locationName: weatherData.name || 'Site Location',
      country: weatherData.sys?.country || '',
      coordinates: {
        lat: weatherData.coord?.lat ?? (lat ?? 0),
        lon: weatherData.coord?.lon ?? (lon ?? 0),
      },
      temperature: tempC,
      feelsLike: feelsLikeC,
      windSpeed: windSpeedKmH, // Primary unit in km/h
      windSpeedKmH,
      windSpeedKnots: windKnots,
      windSpeedMs,
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
