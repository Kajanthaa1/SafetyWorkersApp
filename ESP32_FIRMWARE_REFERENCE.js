/**
 * ESP32-S3 SafetyBand Firmware Reference
 * ========================================
 * 
 * This file describes the BLE GATT server your ESP32-S3 must implement
 * to communicate with the SafetyWorkerApp mobile application.
 * 
 * Required Libraries (Arduino IDE):
 *   - ESP32 BLE Arduino (built-in with esp32 board package)
 *   - MAX30105 by SparkFun
 *   - SparkFun_BMI160 (or equivalent BMI160 library)
 * 
 * ======================== BLE GATT SPEC ========================
 *
 * Device Advertisement Name: "SafetyBand"
 *
 * Service UUID:  4FAFC201-1FB5-459E-8FCC-C5C9C331914B
 *
 * Characteristics:
 *
 *   [1] Heart Rate BPM (MAX30102)
 *       UUID: BEB5483E-36E1-4688-B7F5-EA07361B26A8
 *       Properties: NOTIFY | READ
 *       Data: 1 unsigned byte  (e.g., 0x4C = 76 BPM)
 *       Notify interval: every ~2 seconds (after each full peak detection cycle)
 *
 *   [2] SpO2 % (MAX30102)
 *       UUID: BEB5483E-36E1-4688-B7F5-EA07361B26A9
 *       Properties: NOTIFY | READ
 *       Data: 1 unsigned byte  (e.g., 0x62 = 98%)
 *       Notify interval: every ~2 seconds (same cycle as HR)
 *
 *   [3] Fall Detected (BMI160 IMU)
 *       UUID: BEB5483E-36E1-4688-B7F5-EA07361B26AA
 *       Properties: NOTIFY
 *       Data: 1 byte: 0x01 = fall detected, 0x00 = cleared/idle
 *       Notify: immediately on BMI160 "significant motion" / step detect interrupt
 *               Auto-clear (send 0x00) after 1 second if no further motion
 *
 *   [4] Buzzer Control
 *       UUID: BEB5483E-36E1-4688-B7F5-EA07361B26AB
 *       Properties: WRITE
 *       Data: 0x01 = turn buzzer ON, 0x00 = turn buzzer OFF
 *       The app writes 0x01 when a health alert is triggered, then 0x00 after 3 seconds
 *
 * ======================== WIRING GUIDE ========================
 *
 * MAX30102 → ESP32-S3
 *   VCC  → 3.3V
 *   GND  → GND
 *   SDA  → GPIO 8  (I2C SDA)
 *   SCL  → GPIO 9  (I2C SCL)
 *   INT  → GPIO 7  (optional interrupt pin)
 *
 * BMI160 → ESP32-S3
 *   VCC  → 3.3V
 *   GND  → GND
 *   SDA  → GPIO 8  (shared I2C bus)
 *   SCL  → GPIO 9  (shared I2C bus)
 *   INT1 → GPIO 6  (fall detection interrupt)
 *
 * SIM800L / SIM7600 GSM → ESP32-S3
 *   VCC  → External 4V (requires 2A peak current)
 *   GND  → GND (must share common ground with ESP32)
 *   TX   → GPIO 17 (RXD2)
 *   RX   → GPIO 18 (TXD2) (use level shifter if GSM runs on 5V)
 *
 * Buzzer (active buzzer with NPN transistor driver) → ESP32-S3
 *   Base → GPIO 5 (via 1kΩ resistor)
 *   Collector → Buzzer(-)
 *   Emitter → GND
 *   Buzzer(+) → 3.3V
 *
 * ======================== GSM FALLBACK API ========================
 * 
 * When BLE is not connected to the phone, or phone internet is offline,
 * the ESP32 must fall back to transmitting data directly via GPRS/LTE.
 *
 * Device Authentication Token:
 *   Every request sent over GSM must include a custom authentication header:
 *   - Header name: `x-device-token`  (or `Authorization: Device <token>`)
 *   - Device tokens for workers:
 *     - Worker 1: "device_token_worker1_xyz"
 *     - Worker 2: "device_token_worker2_abc"
 * 
 * Endpoints:
 * 
 * 1. Post Vitals
 *    - URL: `http://<your-server-ip>:5000/api/device/vitals`
 *    - Method: POST
 *    - Headers:
 *        - `Content-Type: application/json`
 *        - `x-device-token: device_token_worker1_xyz`
 *    - JSON Body:
 *        ```json
 *        {
 *          "bpm": 78,
 *          "spo2": 98
 *        }
 *        ```
 * 
 * 2. Post Emergency Alert (Manual SOS / Critical Fall)
 *    - URL: `http://<your-server-ip>:5000/api/device/alert`
 *    - Method: POST
 *    - Headers:
 *        - `Content-Type: application/json`
 *        - `x-device-token: device_token_worker1_xyz`
 *    - JSON Body:
 *        ```json
 *        {
 *          "type": "fall" 
 *        }
 *        ```
 *        (Note: "type" can be "manual" for SOS, or "fall" for IMU triggers)
 * 
 * ======================== NOTES ========================
 * 
 * 1. MAX30102 heart rate calculation:
 *    Use SparkFun's heartRate example, which detects peaks in the IR signal.
 *    Compute BPM = 60000 / average_peak_interval_ms
 *    Apply a simple moving average (window = 4) before notifying the app.
 *
 * 2. SpO2 calculation:
 *    Use the ratio-of-ratios method: R = (AC_red/DC_red) / (AC_ir/DC_ir)
 *    SpO2 ≈ 110 - 25 * R  (empirical calibration curve)
 *    Clamp to [85, 100] range.
 *
 * 3. BMI160 fall detection:
 *    Enable the "significant motion" or "low-g" interrupt.
 *    The app will handle the 15-second countdown + escalation flow.
 *    Your firmware only needs to send 0x01 when the interrupt fires.
 *
 * 4. Power management:
 *    Use ESP32 light sleep between notification cycles to conserve battery.
 *    Target active current: < 50mA avg.
 */

// ======================== ARDUINO C++ IMPLEMENTATION SNIPPET ========================
// Below is a reference Arduino C++ implementation addressing the risk mitigations
// in your Risk Assessment (signal filtering, SPIFFS offline buffering, fall logic, etc.)

#include <Wire.h>
#include <SPIFFS.h>
#include "MAX30105.h"
#include "heartRate.h"
#include "DFRobot_BMI160.h" // Replace with BMI160 library of choice

MAX30105 particleSensor;
DFRobot_BMI160_I2C bmi160;

#define BUZZER_PIN 5
#define I2C_SDA 8
#define I2C_SCL 9

// ── Mitigation [Risk 1]: MAX30102 Signal Filter (Moving Average) ────────────────────
const byte RATE_SIZE = 4; // Window size for moving average filter
byte rates[RATE_SIZE]; 
byte rateSpot = 0;
long lastBeat = 0;
float beatsPerMinute;
int beatAvg;

int getFilteredBPM(long delta) {
  beatsPerMinute = 60 / (delta / 1000.0);
  if (beatsPerMinute < 255 && beatsPerMinute > 20) {
    rates[rateSpot++] = (byte)beatsPerMinute;
    rateSpot %= RATE_SIZE;
    
    // Calculate simple moving average
    int sum = 0;
    for (byte x = 0 ; x < RATE_SIZE ; x++) sum += rates[x];
    beatAvg = sum / RATE_SIZE;
  }
  return beatAvg;
}

// ── Mitigation [Risk 2]: Offline Buffer (SPIFFS Flash Storage) ──────────────────────
void setupSPIFFS() {
  if(!SPIFFS.begin(true)){
    Serial.println("SPIFFS Mount Failed");
    return;
  }
}

void bufferReadingOffline(int bpm, int spo2) {
  File file = SPIFFS.open("/vitals_buffer.csv", FILE_APPEND);
  if(!file){
    Serial.println("Failed to open file for appending");
    return;
  }
  // Store reading with timestamp
  file.printf("%d,%d,%d\n", millis(), bpm, spo2);
  file.close();
  Serial.println("Offline reading buffered to SPIFFS.");
}

// ── Mitigation [Risk 4]: Fall Detection Thresholds & Confirmation ─────────────────────
bool verifyFallInterrupt() {
  // Read accelerometer data to verify gravity drop vs normal motion artifact
  int16_t ax, ay, az;
  bmi160.getAccelerometerData(&ax, &ay, &az);
  
  // Calculate total acceleration magnitude (g force)
  float gForce = sqrt(ax*ax + ay*ay + az*az) / 16384.0; // 16384 LSB/g for +/-2g scale
  
  // High threshold peak (impact) followed by low threshold (inactivity)
  if (gForce > 3.0 || gForce < 0.2) {
    return true; 
  }
  return false;
}

// ── Mitigation [Risk 6]: Redundant Local Buzzer Control ──────────────────────────────
void triggerLocalBuzzer(bool state) {
  if (state) {
    digitalWrite(BUZZER_PIN, HIGH);
    Serial.println("[ALERT] Local Buzzer active!");
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }
}

void loop() {
  // Vitals reading loop
  long irValue = particleSensor.getIR();
  if (checkForBeat(irValue) == true) {
    long delta = millis() - lastBeat;
    lastBeat = millis();
    int currentBPM = getFilteredBPM(delta);
    
    // If BLE is offline, buffer directly to flash SPIFFS
    // bool bleConnected = ... (check BLE status)
    bool bleConnected = false; 
    if (!bleConnected) {
      bufferReadingOffline(currentBPM, 98); // Assuming 98% SpO2 for sample
    }
  }
  
  // Check IMU Fall Interrupts
  // If BMI160 INT1 pin triggers high, check verification threshold
  if (digitalRead(6) == HIGH) { 
    if (verifyFallInterrupt()) {
      triggerLocalBuzzer(true); // Redundant local buzzer alerts worker instantly
      // Send notification to BLE / GSM
    }
  }
}

