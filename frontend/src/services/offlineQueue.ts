import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from './api';

const QUEUE_KEY = '@safety_worker_offline_vitals_queue';

export interface QueuedReading {
  userId: string;
  bpm: number;
  spo2: number;
  timestamp: number;
}

export const offlineQueue = {
  /** Add vital reading to the offline queue. */
  async enqueue(userId: string, bpm: number, spo2: number): Promise<number> {
    try {
      const stored = await AsyncStorage.getItem(QUEUE_KEY);
      const queue: QueuedReading[] = stored ? JSON.parse(stored) : [];
      queue.push({
        userId,
        bpm,
        spo2,
        timestamp: Date.now()
      });
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
      console.log(`[OfflineQueue] Enqueued reading. Total queued: ${queue.length}`);
      return queue.length;
    } catch (err) {
      console.error('[OfflineQueue] Failed to enqueue reading:', err);
      return 0;
    }
  },

  /** Get the current size of the offline queue. */
  async getQueueSize(): Promise<number> {
    try {
      const stored = await AsyncStorage.getItem(QUEUE_KEY);
      const queue: QueuedReading[] = stored ? JSON.parse(stored) : [];
      return queue.length;
    } catch (err) {
      return 0;
    }
  },

  /** Attempt to upload all queued readings to the backend. */
  async flush(onSuccess?: (reading: QueuedReading) => void): Promise<void> {
    try {
      const stored = await AsyncStorage.getItem(QUEUE_KEY);
      if (!stored) return;

      const queue: QueuedReading[] = JSON.parse(stored);
      if (queue.length === 0) return;

      console.log(`[OfflineQueue] Flushing ${queue.length} queued readings...`);
      
      // Flush sequentially to preserve order
      for (const item of queue) {
        try {
          await api.submitVitals(item.userId, item.bpm, item.spo2, 'ble');
          if (onSuccess) onSuccess(item);
        } catch (err) {
          // If a request fails, save the remaining queue back and stop flushing
          const failedIndex = queue.indexOf(item);
          const remaining = queue.slice(failedIndex);
          await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
          console.warn('[OfflineQueue] Flush interrupted due to connection or api error');
          return;
        }
      }

      // If all synced, clear queue
      await AsyncStorage.removeItem(QUEUE_KEY);
      console.log('[OfflineQueue] Flush complete. Queue cleared.');
    } catch (err) {
      console.error('[OfflineQueue] Failed to flush queue:', err);
    }
  }
};
