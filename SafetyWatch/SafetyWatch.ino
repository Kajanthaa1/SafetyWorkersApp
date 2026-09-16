/*
 * SafetyWatch.ino   -   MAIN SKETCH
 * Smart IoT-Based High-Rise Construction Worker Safety System
 * Group 10 | 23/ENG/133, 23/ENG/132, 23/ENG/090
 *
 * ==========================================================
 * PUT ALL 4 FILES IN A FOLDER NAMED EXACTLY:  SafetyWatch
 *   SafetyWatch.ino      <- this file
 *   BMI160Sensor.h
 *   MAX30102Sensor.h
 *   DisplayManager.h
 * ==========================================================
 *
 * DOT BOARD WIRING:
 *   SDA = GPIO6
 *   SCL = GPIO7
 *   BMI160   = 0x69 (or 0x68)
 *   MAX30102 = 0x57
 *   OLED     = 0x3C
 *
 * SERIAL OUTPUT:
 *   Gyro X | Gyro Y | Gyro Z | BPM | SpO2 | Status
 *
 * DISPLAY OUTPUT:
 *   BPM, SpO2, Fall status
 *
 * ARDUINO IDE:
 *   Tools -> USB CDC On Boot -> Enabled
 *   Serial Monitor -> 115200 baud
 *
 * LIBRARIES:
 *   SparkFun MAX3010x Pulse and Proximity Sensor Library
 *   Adafruit GFX Library
 *   Adafruit SSD1306
 */

#include <Wire.h>
#include "BMI160Sensor.h"
#include "MAX30102Sensor.h"
#include "DisplayManager.h"
#include "CloudUplink.h"

// =====================================================
// CONFIGURATION
// =====================================================
#define SDA_PIN  6
#define SCL_PIN  7

// Bus speed.
// 50000 (50kHz) is SLOW but very reliable on hand-soldered dot board.
// The display needs clean signals more than it needs speed.
// If everything is stable you can try 100000 for a smoother screen.
#define I2C_SPEED_HZ  50000

#define ALERT_HOLD_MS      8000   // how long a fall alert stays on
#define SERIAL_INTERVAL     500   // ms between serial lines
#define DISPLAY_INTERVAL    500   // ms between screen refreshes

// =====================================================
// MODULES
// =====================================================
BMI160Sensor    imu;
MAX30102Sensor  ppg;
DisplayManager  screen;
CloudUplink     net;

bool imuOK     = false;
bool ppgOK     = false;
bool displayOK = false;
bool wifiOK    = false;

bool alertActive = false;
unsigned long alertStartTime = 0;

unsigned long lastSerial  = 0;
unsigned long lastDisplay = 0;

// =====================================================
// I2C BUS SCAN (helps find wiring problems)
// =====================================================
void scanI2C() {
  Serial.println(F("I2C scan:"));
  int found = 0;

  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) {
      Serial.print(F("  0x"));
      if (a < 0x10) Serial.print("0");
      Serial.print(a, HEX);

      if (a == 0x57)                 Serial.print(F("  <- MAX30102"));
      if (a == 0x68 || a == 0x69)    Serial.print(F("  <- BMI160"));
      if (a == 0x3C || a == 0x3D)    Serial.print(F("  <- OLED"));

      Serial.println();
      found++;
    }
  }

  if (found == 0)
    Serial.println(F("  NOTHING FOUND - check wiring and 3.3V"));

  Serial.println();
}

// =====================================================
// SETUP  -  runs one time at power on
// =====================================================
void setup() {
  Serial.begin(115200);

  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 3000) delay(10);

  Serial.println();
  Serial.println(F("========================================"));
  Serial.println(F("   WORKER SAFETY WATCH - booting"));
  Serial.println(F("========================================"));

  // ---------- start the I2C bus ----------
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(I2C_SPEED_HZ);
  delay(100);

  Serial.print(F("I2C: SDA=GPIO"));
  Serial.print(SDA_PIN);
  Serial.print(F("  SCL=GPIO"));
  Serial.print(SCL_PIN);
  Serial.print(F("  speed="));
  Serial.println(I2C_SPEED_HZ);
  Serial.println();

  scanI2C();

  // ---------- display ----------
  Serial.println(F("Starting OLED..."));
  displayOK = screen.begin();

  if (displayOK) {
    Serial.println(F("  OLED ready"));
    screen.showBootMessage("Starting...", "Please wait");
  } else {
    Serial.println(F("  OLED not available (continuing without it)"));
  }

  // ---------- motion sensor ----------
  Serial.println(F("Starting BMI160..."));
  imuOK = imu.begin();

  if (imuOK) {
    Serial.print(F("  BMI160 ready at 0x"));
    Serial.print(imu.address(), HEX);
    Serial.print(F("  PMU_STATUS=0x"));
    Serial.println(imu.pmuStatus(), HEX);
  } else {
    Serial.print(F("  BMI160 FAILED. chipID=0x"));
    Serial.print(imu.chipId(), HEX);
    Serial.print(F(" (want 0xD1)  PMU=0x"));
    Serial.println(imu.pmuStatus(), HEX);
    Serial.println(F("  Fall detection will not work."));
  }

  // ---------- pulse sensor ----------
  Serial.println(F("Starting MAX30102..."));
  ppgOK = ppg.begin();

  Serial.println(ppgOK ? F("  MAX30102 ready")
                       : F("  MAX30102 FAILED"));

  // make sure the bus speed is still ours
  Wire.setClock(I2C_SPEED_HZ);

  // ---------- Wi-Fi ----------
  Serial.println();
  Serial.println(F("Starting Wi-Fi..."));
  if (displayOK) screen.showBootMessage("Connecting", "to WiFi...");

  wifiOK = net.begin();

  // ---------- summary ----------
  Serial.println();
  Serial.println(F("========================================"));
  Serial.print(F("  BMI160: "));    Serial.print(imuOK     ? F("OK") : F("FAIL"));
  Serial.print(F("   MAX30102: ")); Serial.print(ppgOK     ? F("OK") : F("FAIL"));
  Serial.print(F("   OLED: "));     Serial.print(displayOK ? F("OK") : F("FAIL"));
  Serial.print(F("   WiFi: "));     Serial.println(wifiOK    ? F("OK") : F("OFFLINE"));
  Serial.println(F("========================================"));
  Serial.println();

  if (displayOK) screen.showBootMessage("Ready", "Place finger");

  Serial.println(F("Place your finger on the MAX30102 and keep it still."));
  Serial.println();
  Serial.println(F("Gyro X\tGyro Y\tGyro Z\tBPM\tSpO2\tStatus"));

  delay(1000);
}

// =====================================================
// LOOP  -  runs again and again, forever
// =====================================================
void loop() {
  unsigned long now = millis();

  // ---------- 1. read both sensors ----------
  if (imuOK) imu.update();     // also runs fall detection inside
  if (ppgOK) ppg.update();     // non blocking - returns fast

  // ---------- 2. check for emergency ----------
  if (!alertActive && imuOK && imu.fallDetected()) {
    alertActive = true;
    alertStartTime = now;

    Serial.println(F(">>> FALL DETECTED <<<"));
    if (displayOK) screen.showFallAlert();

    // send the emergency alert straight away, do not wait for the timer
    net.sendAlert(ppg.heartRate(), ppg.spo2(), ppg.valid(),
                  imu.gx, imu.gy, imu.gz, imuOK);
  }

  // ---------- 3. clear the alert after some seconds ----------
  if (alertActive && (now - alertStartTime >= ALERT_HOLD_MS)) {
    alertActive = false;
    if (imuOK)     imu.clearFall();
    if (displayOK) screen.invalidate();
    Serial.println(F("Alert cleared."));
  }

  // ---------- 4. update the screen ----------
  if (displayOK && !alertActive && (now - lastDisplay >= DISPLAY_INTERVAL)) {
    lastDisplay = now;
    screen.showStatus(ppg.fingerDetected(), ppg.valid(),
                      ppg.heartRate(), ppg.spo2(),
                      false, imuOK);
  }

  // ---------- 5. print to the serial monitor ----------
  if (now - lastSerial >= SERIAL_INTERVAL) {
    lastSerial = now;

    // --- gyro columns ---
    if (imuOK) {
      Serial.print(imu.gx, 1); Serial.print('\t');
      Serial.print(imu.gy, 1); Serial.print('\t');
      Serial.print(imu.gz, 1); Serial.print('\t');
    } else {
      // print OFF, not 0.0 - a fake zero would hide a broken sensor
      Serial.print(F("OFF\tOFF\tOFF\t"));
    }

    // --- heart rate and SpO2 columns ---
    if (ppg.valid()) {
      Serial.print(ppg.heartRate()); Serial.print('\t');
      Serial.print(ppg.spo2());      Serial.print('\t');
    } else {
      Serial.print(F("--\t--\t"));
    }

    // --- status column ---
    if (alertActive)                 Serial.println(F("FALL DETECTED"));
    else if (!imuOK)                 Serial.println(F("IMU OFF"));
    else if (!ppg.fingerDetected())  Serial.println(F("No finger"));
    else if (!ppg.valid())           Serial.println(F("Reading..."));
    else                             Serial.println(F("Valid"));
  }

  // ---------- 6. keep Wi-Fi alive and send data ----------
  net.maintain();          // reconnects in the background if Wi-Fi drops

  net.sendData(ppg.heartRate(), ppg.spo2(), ppg.valid(),
               imu.gx, imu.gy, imu.gz, imuOK, alertActive);

  delay(15);
}
