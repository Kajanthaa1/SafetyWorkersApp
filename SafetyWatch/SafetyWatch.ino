#include <Wire.h>
#include "BMI160Sensor.h"
#include "MAX30102Sensor.h"
#include "DisplayManager.h"
#include "CloudUplink.h"

#define SDA_PIN  6
#define SCL_PIN  7

#define I2C_SPEED_HZ  50000

#define ALERT_HOLD_MS      8000
#define SERIAL_INTERVAL     500
#define DISPLAY_INTERVAL    500

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

void setup() {
  Serial.begin(115200);

  unsigned long t0 = millis();
  while (!Serial && millis() - t0 < 3000) delay(10);

  Serial.println();
  Serial.println(F("========================================"));
  Serial.println(F("   WORKER SAFETY WATCH - booting"));
  Serial.println(F("========================================"));

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

  Serial.println(F("Starting OLED..."));
  displayOK = screen.begin();

  if (displayOK) {
    Serial.println(F("  OLED ready"));
    screen.showBootMessage("Starting...", "Please wait");
  } else {
    Serial.println(F("  OLED not available (continuing without it)"));
  }

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

  Serial.println(F("Starting MAX30102..."));
  ppgOK = ppg.begin();

  Serial.println(ppgOK ? F("  MAX30102 ready")
                       : F("  MAX30102 FAILED"));

  Wire.setClock(I2C_SPEED_HZ);

  Serial.println();
  Serial.println(F("Starting Wi-Fi..."));
  if (displayOK) screen.showBootMessage("Connecting", "to WiFi...");

  wifiOK = net.begin();

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

void loop() {
  unsigned long now = millis();

  if (imuOK) imu.update();
  if (ppgOK) ppg.update();

  if (!alertActive && imuOK && imu.fallDetected()) {
    alertActive = true;
    alertStartTime = now;

    Serial.println(F(">>> FALL DETECTED <<<"));
    if (displayOK) screen.showFallAlert();

    net.sendAlert(ppg.heartRate(), ppg.spo2(), ppg.valid(),
                  imu.gx, imu.gy, imu.gz, imuOK);
  }

  if (alertActive && (now - alertStartTime >= ALERT_HOLD_MS)) {
    alertActive = false;
    if (imuOK)     imu.clearFall();
    if (displayOK) screen.invalidate();
    Serial.println(F("Alert cleared."));
  }

  if (displayOK && !alertActive && (now - lastDisplay >= DISPLAY_INTERVAL)) {
    lastDisplay = now;
    screen.showStatus(ppg.fingerDetected(), ppg.valid(),
                      ppg.heartRate(), ppg.spo2(),
                      false, imuOK);
  }

  if (now - lastSerial >= SERIAL_INTERVAL) {
    lastSerial = now;

    if (imuOK) {
      Serial.print(imu.gx, 1); Serial.print('\t');
      Serial.print(imu.gy, 1); Serial.print('\t');
      Serial.print(imu.gz, 1); Serial.print('\t');
    } else {

      Serial.print(F("OFF\tOFF\tOFF\t"));
    }

    if (ppg.valid()) {
      Serial.print(ppg.heartRate()); Serial.print('\t');
      Serial.print(ppg.spo2());      Serial.print('\t');
    } else {
      Serial.print(F("--\t--\t"));
    }

    if (alertActive)                 Serial.println(F("FALL DETECTED"));
    else if (!imuOK)                 Serial.println(F("IMU OFF"));
    else if (!ppg.fingerDetected())  Serial.println(F("No finger"));
    else if (!ppg.valid())           Serial.println(F("Reading..."));
    else                             Serial.println(F("Valid"));
  }

  net.maintain();

  net.sendData(ppg.heartRate(), ppg.spo2(), ppg.valid(),
               imu.gx, imu.gy, imu.gz, imuOK, alertActive);

  delay(15);
}
