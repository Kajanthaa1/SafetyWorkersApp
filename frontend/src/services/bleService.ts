/**
 * bleService.ts
 * 
 * Handles all Bluetooth Low Energy (BLE) communication with the ESP32-S3 wearable.
 * 
 * ------- IMPORTANT FOR ESP32 FIRMWARE DEVELOPER --------
 * The ESP32 must advertise a BLE GATT server with the following UUIDs:
 *
 *   Service UUID:   "4FAFC201-1FB5-459E-8FCC-C5C9C331914B"
 *
 *   Characteristics:
 *     Heart Rate (BPM)  : "BEB5483E-36E1-4688-B7F5-EA07361B26A8"  [NOTIFY, READ]
 *       Payload: 1 byte, unsigned integer (e.g., 0x4C = 76 BPM)
 *
 *     SpO2 (%)          : "BEB5483E-36E1-4688-B7F5-EA07361B26A9"  [NOTIFY, READ]
 *       Payload: 1 byte, unsigned integer (e.g., 0x62 = 98%)
 *
 *     Fall Detected     : "BEB5483E-36E1-4688-B7F5-EA07361B26AA"  [NOTIFY]
 *       Payload: 1 byte: 0x01 = fall detected, 0x00 = idle/clear
 *
 *     Buzzer Control    : "BEB5483E-36E1-4688-B7F5-EA07361B26AB"  [WRITE]
 *       Payload: 0x01 = buzz once (SOS confirmation), 0x00 = stop
 *
 * Device Advertisement Name: "SafetyBand"
 * -------------------------------------------------------
 */

import { BleManager, Device, State, Characteristic } from 'react-native-ble-plx';
import { Alert, Platform, PermissionsAndroid } from 'react-native';

// ── BLE UUIDs (must match ESP32 firmware exactly) ──────────────────────────────
export const BLE_SERVICE_UUID        = '4FAFC201-1FB5-459E-8FCC-C5C9C331914B';
export const CHAR_HEART_RATE_UUID    = 'BEB5483E-36E1-4688-B7F5-EA07361B26A8';
export const CHAR_SPO2_UUID          = 'BEB5483E-36E1-4688-B7F5-EA07361B26A9';
export const CHAR_FALL_UUID          = 'BEB5483E-36E1-4688-B7F5-EA07361B26AA';
export const CHAR_BUZZER_UUID        = 'BEB5483E-36E1-4688-B7F5-EA07361B26AB';

// The BLE advertisement name the ESP32 broadcasts
export const ESP32_DEVICE_NAME       = 'SafetyBand';

// ── Types ───────────────────────────────────────────────────────────────────────
export type BleStatus =
  | 'idle'
  | 'scanning'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export interface BleCallbacks {
  onHeartRate:  (bpm: number)    => void;
  onSpO2:       (spo2: number)   => void;
  onFall:       (detected: boolean) => void;
  onStatusChange: (status: BleStatus) => void;
}

// ── Module-level singletons ─────────────────────────────────────────────────────
let manager: BleManager | null = null;
let connectedDevice: Device | null = null;
let callbacks: BleCallbacks | null = null;

// Reconnection and Scan Guards
let isScanning = false;
let isConnecting = false;
let autoReconnectEnabled = true;
let reconnectTimeout: NodeJS.Timeout | null = null;

// ── Helpers ─────────────────────────────────────────────────────────────────────

/** Decode a base64 characteristic value to an unsigned integer (0–255). */
const decodeUInt8 = (value: string | null): number => {
  if (!value) return 0;
  const bytes = Buffer.from(value, 'base64');
  return bytes[0] ?? 0;
};

/** Encode an integer to a base64 string for writing to a characteristic. */
const encodeUInt8 = (value: number): string => {
  return Buffer.from([value]).toString('base64');
};

/** Request necessary Android Runtime Permissions for Bluetooth LE scanning/connection */
const requestBluetoothPermissions = async (): Promise<boolean> => {
  if (Platform.OS === 'ios') return true;

  if (Platform.OS === 'android') {
    if (Platform.Version >= 31) {
      const scanGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN
      );
      const connectGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
      );
      const locationGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      return (
        scanGranted === PermissionsAndroid.RESULTS.GRANTED &&
        connectGranted === PermissionsAndroid.RESULTS.GRANTED &&
        locationGranted === PermissionsAndroid.RESULTS.GRANTED
      );
    } else {
      const locationGranted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
      );
      return locationGranted === PermissionsAndroid.RESULTS.GRANTED;
    }
  }
  return false;
};

// ── Public API ──────────────────────────────────────────────────────────────────

/** Must be called once before any other BLE function (e.g., in the top-level component). */
export const initBle = (): BleManager => {
  if (!manager) {
    manager = new BleManager();
  }
  return manager;
};

/** 
 * Start scanning for the ESP32 wearable.
 * Calls onStatusChange when status changes (scanning → connecting → connected / error).
 */
export const connectToWearable = async (cbs: BleCallbacks) => {
  callbacks = cbs;
  autoReconnectEnabled = true;

  // ── Mitigation [Risk: Permission missing] ──
  const permissionsOk = await requestBluetoothPermissions();
  if (!permissionsOk) {
    console.warn('[BLE] Bluetooth permissions not granted');
    callbacks.onStatusChange('error');
    Alert.alert(
      'Permissions Required',
      'This app needs Bluetooth and location permissions to pair with the SafetyBand wearable.'
    );
    return;
  }

  if (!manager) {
    manager = new BleManager();
  }

  if (connectedDevice) {
    callbacks.onStatusChange('connected');
    return;
  }

  if (isScanning || isConnecting) {
    console.log('[BLE] Already scanning or connecting, ignoring request');
    return;
  }

  callbacks.onStatusChange('scanning');

  // Check if Bluetooth is powered on before scanning
  const stateSubscription = manager.onStateChange((state) => {
    if (state === State.PoweredOn) {
      stateSubscription.remove();
      startScan();
    } else if (state === State.PoweredOff) {
      callbacks?.onStatusChange('error');
      Alert.alert('Bluetooth Off', 'Please enable Bluetooth to connect to your SafetyBand wearable.');
    }
  }, true);
};

const startScan = () => {
  if (!manager || !callbacks) return;
  if (isScanning) return;

  isScanning = true;
  console.log('[BLE] Starting scan for:', ESP32_DEVICE_NAME);

  manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
    if (error) {
      console.error('[BLE] Scan error:', error);
      isScanning = false;
      callbacks?.onStatusChange('error');
      return;
    }

    if (device?.name === ESP32_DEVICE_NAME || device?.localName === ESP32_DEVICE_NAME) {
      console.log('[BLE] Found SafetyBand:', device.id);
      isScanning = false;
      manager?.stopDeviceScan();
      connectToDevice(device);
    }
  });

  // Auto-stop scan after 15 seconds if device not found
  setTimeout(() => {
    if (isScanning && !connectedDevice && manager) {
      manager.stopDeviceScan();
      isScanning = false;
      callbacks?.onStatusChange('disconnected');
      console.warn('[BLE] Scan timed out – SafetyBand not found.');
    }
  }, 15000);
};

const connectToDevice = async (device: Device) => {
  if (!callbacks) return;
  if (isConnecting) return;

  isConnecting = true;
  callbacks.onStatusChange('connecting');

  try {
    const connected = await device.connect({ timeout: 10000 });
    await connected.discoverAllServicesAndCharacteristics();

    connectedDevice = connected;
    isConnecting = false;
    callbacks.onStatusChange('connected');
    console.log('[BLE] Connected and services discovered');

    // Subscribe to live vitals notifications
    subscribeToCharacteristics(connected);

    // Handle unexpected disconnection
    connected.onDisconnected((error, disconnectedDevice) => {
      console.warn('[BLE] Device disconnected:', error?.message ?? 'unknown');
      connectedDevice = null;
      isConnecting = false;
      callbacks?.onStatusChange('disconnected');

      // ── Mitigation [Risk: Disconnection out-of-range] ──
      // Attempt auto-reconnect if it wasn't a deliberate user logout/disconnect
      if (autoReconnectEnabled && callbacks) {
        console.log('[BLE] Attempting auto-reconnection in 5 seconds...');
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
          if (autoReconnectEnabled && callbacks) {
            connectToWearable(callbacks);
          }
        }, 5000);
      }
    });

  } catch (err: any) {
    console.error('[BLE] Connection failed:', err);
    isConnecting = false;
    callbacks?.onStatusChange('error');
    Alert.alert('Connection Failed', `Could not connect to SafetyBand: ${err.message}`);
  }
};

const subscribeToCharacteristics = (device: Device) => {
  // ── Heart Rate ──────────────────────────────────────────────────────────────
  device.monitorCharacteristicForService(
    BLE_SERVICE_UUID,
    CHAR_HEART_RATE_UUID,
    (error, characteristic) => {
      if (error) {
        console.error('[BLE] Heart rate error:', error.message);
        return;
      }
      const bpm = decodeUInt8(characteristic?.value ?? null);
      console.log('[BLE] Heart Rate:', bpm);
      callbacks?.onHeartRate(bpm);
    }
  );

  // ── SpO2 ────────────────────────────────────────────────────────────────────
  device.monitorCharacteristicForService(
    BLE_SERVICE_UUID,
    CHAR_SPO2_UUID,
    (error, characteristic) => {
      if (error) {
        console.error('[BLE] SpO2 error:', error.message);
        return;
      }
      const spo2 = decodeUInt8(characteristic?.value ?? null);
      console.log('[BLE] SpO2:', spo2);
      callbacks?.onSpO2(spo2);
    }
  );

  // ── Fall Detection (BMI160 IMU) ─────────────────────────────────────────────
  device.monitorCharacteristicForService(
    BLE_SERVICE_UUID,
    CHAR_FALL_UUID,
    (error, characteristic) => {
      if (error) {
        console.error('[BLE] Fall detect error:', error.message);
        return;
      }
      const fallFlag = decodeUInt8(characteristic?.value ?? null);
      const isFall = fallFlag === 1;
      console.log('[BLE] Fall detected:', isFall);
      callbacks?.onFall(isFall);
    }
  );
};

/** Trigger the buzzer on the wearable (1 = on, 0 = off). */
export const triggerBuzzer = async (on: boolean) => {
  if (!connectedDevice) {
    console.warn('[BLE] Cannot trigger buzzer – no device connected');
    return;
  }
  try {
    await connectedDevice.writeCharacteristicWithResponseForService(
      BLE_SERVICE_UUID,
      CHAR_BUZZER_UUID,
      encodeUInt8(on ? 1 : 0)
    );
    console.log('[BLE] Buzzer', on ? 'ON' : 'OFF');
  } catch (err: any) {
    console.error('[BLE] Buzzer write failed:', err.message);
  }
};

/** Gracefully disconnect from the wearable. */
export const disconnectWearable = async () => {
  autoReconnectEnabled = false; // Prevent reconnect loops during intentional logout/disconnect
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
  if (connectedDevice) {
    try {
      await connectedDevice.cancelConnection();
    } catch (_) {}
    connectedDevice = null;
  }
  isScanning = false;
  isConnecting = false;
  callbacks?.onStatusChange('disconnected');
  callbacks = null;
};

/** Destroy the BleManager (call on app unmount / logout). */
export const destroyBle = () => {
  disconnectWearable();
  if (manager) {
    manager.destroy();
    manager = null;
  }
};

export const getConnectedDevice = () => connectedDevice;
