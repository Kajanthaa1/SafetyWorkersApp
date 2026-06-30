import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { router, setSocketEmitter } from './routes';

dotenv.config();

const app = express();
const port = process.env.PORT || 5000;

// Enable CORS
app.use(cors({
  origin: '*', // For development, allow all origins
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
  credentials: true
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
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']
  }
});

// Attach Socket.io emitter to API routes
setSocketEmitter((event: string, data: any) => {
  io.emit(event, data);
});

// Socket.io connection logic
io.on('connection', (socket) => {
  console.log(`Socket client connected: ${socket.id}`);

  // Join a role-specific room or user-specific room
  socket.on('join', (data: { userId: string; role: string }) => {
    console.log(`User ${data.userId} with role ${data.role} joined.`);
    socket.join(data.role); // join room 'worker' or 'supervisor'
    socket.join(data.userId); // join personal room
  });

  // Handle direct socket vital updates
  socket.on('vitals_push', (data: { userId: string; name: string; bpm: number; spo2: number }) => {
    // Save to DB and emit to everyone
    const reading = {
      userId: data.userId,
      bpm: data.bpm,
      spo2: data.spo2,
      timestamp: Date.now()
    };
    
    // We can import db internally or call its direct methods
    const { db } = require('./db');
    db.addVitalReading(reading);

    io.emit('vitals_update', {
      userId: data.userId,
      name: data.name,
      reading
    });
  });

  // Handle manual fall triggers
  socket.on('fall_trigger', (data: { userId: string; severity: 'minor' | 'confirmed' }) => {
    const { db } = require('./db');
    const user = db.getUserById(data.userId);
    const newFall = {
      id: `fall_${Date.now()}`,
      userId: data.userId,
      timestamp: Date.now(),
      severity: data.severity,
      status: 'suspected' as const
    };
    db.addFallEvent(newFall);

    io.emit('new_fall', {
      userId: data.userId,
      name: user ? user.name : 'Unknown Worker',
      fall: newFall
    });
  });

  // Handle fall cancellation / resolution
  socket.on('fall_cancel', (data: { id: string; userId: string }) => {
    const { db } = require('./db');
    const fall = db.updateFallEventStatus(data.id, 'cancelled');
    io.emit('fall_status_update', {
      fallId: data.id,
      userId: data.userId,
      status: 'cancelled'
    });
  });

  socket.on('disconnect', () => {
    console.log(`Socket client disconnected: ${socket.id}`);
  });
});

server.listen(port, () => {
  console.log(`SafetyWorkerApp backend listening on port ${port}`);
});
