import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { router, setSocketEmitter } from './routes';
import { db } from './db';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Enable CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  credentials: true,
}));

app.use(express.json());

// Main Router API
app.use('/api', router);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Create Server
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  },
});

// Attach Socket.io emitter to API routes
setSocketEmitter((event: string, data: any) => {
  io.emit(event, data);
});

// Socket.io connection logic
io.on('connection', (socket) => {
  console.log(`Socket client connected: ${socket.id}`);

  socket.on('join', (data: { userId: string; role: string }) => {
    console.log(`User ${data.userId} with role ${data.role} joined.`);
    socket.join(data.role);
    socket.join(data.userId);
  });

  // Handle direct socket vital updates from wearable
  socket.on('vitals_push', async (data: { userId: string; name: string; bpm: number; spo2: number }) => {
    try {
      const reading = {
        userId: data.userId,
        bpm: data.bpm,
        spo2: data.spo2,
        timestamp: Date.now(),
        source: 'ble' as const,
      };
      await db.addVitalReading(reading);
      io.emit('vitals_update', { userId: data.userId, name: data.name, reading });
    } catch (err) {
      console.error('[Socket] vitals_push error:', err);
    }
  });

  // Handle manual fall triggers
  socket.on('fall_trigger', async (data: { userId: string; severity: 'minor' | 'confirmed' }) => {
    try {
      const user = await db.getUserById(data.userId);
      const newFall = {
        id: `fall_${Date.now()}`,
        userId: data.userId,
        timestamp: Date.now(),
        severity: data.severity,
        status: 'suspected' as const,
      };
      await db.addFallEvent(newFall);
      io.emit('new_fall', {
        userId: data.userId,
        name: user ? user.name : 'Unknown Worker',
        fall: newFall,
      });
    } catch (err) {
      console.error('[Socket] fall_trigger error:', err);
    }
  });

  // Handle fall cancellation / resolution
  socket.on('fall_cancel', async (data: { id: string; userId: string }) => {
    try {
      await db.updateFallEventStatus(data.id, 'cancelled');
      io.emit('fall_status_update', {
        fallId: data.id,
        userId: data.userId,
        status: 'cancelled',
      });
    } catch (err) {
      console.error('[Socket] fall_cancel error:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log(`Socket client disconnected: ${socket.id}`);
  });
});

// Start server and seed Firestore with default accounts
server.listen(port, async () => {
  console.log(`SafetyWorkerApp backend listening on port ${port}`);
  try {
    await db.seedIfNeeded();
    console.log('[DB] Firestore seed check complete.');
  } catch (err) {
    console.error('[DB] Error during seed:', err);
  }
});
