import { io, Socket } from 'socket.io-client';
import { API_BASE } from './api';

let socket: Socket | null = null;

export const initSocket = (userId: string, role: string) => {
  if (socket) {
    socket.disconnect();
  }

  try {
    socket = io(API_BASE, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 5000,
    });
  } catch (err) {
    console.warn('Socket connection failed, running in offline mode:', err);
    return null as any;
  }

  socket.on('connect', () => {
    console.log('Connected to WebSocket server');
    // Join appropriate rooms
    socket?.emit('join', { userId, role });
  });

  socket.on('disconnect', () => {
    console.log('Disconnected from WebSocket server');
  });

  return socket;
};

export const getSocket = () => socket;

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

// Event emitter wrappers
export const emitVitalsPush = (userId: string, name: string, bpm: number, spo2: number) => {
  socket?.emit('vitals_push', { userId, name, bpm, spo2 });
};

export const emitFallTrigger = (userId: string, severity: 'minor' | 'confirmed') => {
  socket?.emit('fall_trigger', { userId, severity });
};

export const emitFallCancel = (fallId: string, userId: string) => {
  socket?.emit('fall_cancel', { id: fallId, userId });
};
