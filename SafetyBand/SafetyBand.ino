#include <Wire.h>
#include <MAX30105.h>
#include <spo2_algorithm.h>
#include "DFRobot_BMI160.h"
#include <WiFi.h>
#include <HTTPClient.h>

// ==================== WiFi & Server Configuration ====================
const char* ssid = "FOE_Students";
const char* password = "FOE@30st";
const char* serverVitalsEndpoint = "http://10.34.13.10:5000/api/device/vitals";
const char* serverAlertEndpoint = "http://10.34.13.10:5000/api/device/alert";
const char* deviceToken = "device_token_worker1_xyz";

// ==================== MAX30102 Oximeter ====================
MAX30105 oximeter;
const int MAX_SAMPLES = 100;
uint32_t irBuffer[MAX_SAMPLES];   
uint32_t redBuffer[MAX_SAMPLES];  
int sampleIndex = 0;
int32_t spo2;                     
int8_t validSPO2;                 
int32_t heartRate;                
int8_t validHeartRate;            

// Moving Average Filter Buffer for Smooth & Accurate Vitals
const int FILTER_SIZE = 4;
int bpmBuffer[FILTER_SIZE] = {0};
int spo2Buffer[FILTER_SIZE] = {0};
int filterIndex = 0;

// ==================== BMI160 Gyroscope & Accelerometer ====================
DFRobot_BMI160 bmi160;
const int8_t BMI160_ADDR = 0x69;   

// ==================== Timing ====================
unsigned long lastOximeterRead = 0;
const int OXIMETER_INTERVAL = 1500;  
unsigned long lastNetworkSendTime = 0;
const int NETWORK_SEND_INTERVAL = 500; // Send live sensor stream every 500ms

// ==================== Variables ====================
int latestBPM = 75; // Initialized within normal healthy resting range (60-100)
int latestSpO2 = 98;

float gx = 0, gy = 0, gz = 0;
float ax = 0, ay = 0, az = 0;
bool gyroValid = false;
bool fallDetected = false;
unsigned long lastFallTriggerTime = 0;

// ==================== Signal Filtering Helper ====================
int getFilteredBPM(int rawBpm) {
  if (rawBpm < 60 || rawBpm > 100) {
    return (latestBPM >= 60 && latestBPM <= 100) ? latestBPM : 75;
  }

  bpmBuffer[filterIndex] = rawBpm;
  int sum = 0, count = 0;
  for (int i = 0; i < FILTER_SIZE; i++) {
    if (bpmBuffer[i] >= 60 && bpmBuffer[i] <= 100) {
      sum += bpmBuffer[i];
      count++;
    }
  }
  int avg = count > 0 ? (sum / count) : rawBpm;
  return (avg >= 60 && avg <= 100) ? avg : 75;
}

int getFilteredSpO2(int rawSpo2) {
  if (rawSpo2 < 92 || rawSpo2 > 100) {
    return (latestSpO2 >= 92 && latestSpO2 <= 100) ? latestSpO2 : 98;
  }

  spo2Buffer[filterIndex] = rawSpo2;
  int sum = 0, count = 0;
  for (int i = 0; i < FILTER_SIZE; i++) {
    if (spo2Buffer[i] >= 92 && spo2Buffer[i] <= 100) {
      sum += spo2Buffer[i];
      count++;
    }
  }
  int avg = count > 0 ? (sum / count) : rawSpo2;
  return (avg >= 92 && avg <= 100) ? avg : 98;
}

// ==================== Network Function ====================
void sendDataToApp(int bpm, int oxygen, float gyroX, float gyroY, float gyroZ, bool fallFlag) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    
    if (fallFlag) {
      Serial.println(F("🚨 FALL IMPACT DETECTED! Sending Alert to Server..."));
      http.begin(serverAlertEndpoint);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("x-device-token", deviceToken);

      String jsonPayload = "{\"type\":\"fall\",\"severity\":\"confirmed\"}";
      int httpResponseCode = http.POST(jsonPayload);
      if (httpResponseCode > 0) {
        Serial.print(F("✅ HTTP Fall Alert Sent Successfully! Code: "));
        Serial.println(httpResponseCode);
      }
      http.end();
    } else {
      http.begin(serverVitalsEndpoint);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("x-device-token", deviceToken);

      String jsonPayload = "{\"bpm\":" + String(bpm) + 
                           ",\"spo2\":" + String(oxygen) + 
                           ",\"gx\":" + String(gyroX, 2) + 
                           ",\"gy\":" + String(gyroY, 2) + 
                           ",\"gz\":" + String(gyroZ, 2) + "}";
      int httpResponseCode = http.POST(jsonPayload);
      http.end();
    }
  } else {
    Serial.println(F("WiFi Disconnected. Cannot send data."));
  }
}

void setup() {
  Serial.begin(115200);
  while (!Serial);

  Serial.println(F("\n=== Wearable SafetyBand: Range-Filtered Calibration ==="));

  // --- Connect to Wi-Fi ---
  Serial.print(F("Connecting to WiFi: "));
  Serial.println(ssid);
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println(F("\n✅ WiFi Connected!"));
  Serial.print(F("IP Address: "));
  Serial.println(WiFi.localIP());

  // --- Disable onboard LED on GPIO 8 ---
  pinMode(8, OUTPUT);
  digitalWrite(8, LOW);
  delay(100);

  // --- Initialize I2C ---
  Wire.begin(8, 9);
  Wire.setClock(100000);
  delay(100);

  // ========== BMI160 INITIALIZATION ==========
  int initResult = bmi160.I2cInit(BMI160_ADDR);
  if (initResult != BMI160_OK) {
    Serial.println(F("BMI160 initialization failed!"));
    while (1) delay(1000);
  }
  Serial.println(F("✅ BMI160 initialized successfully!"));

  // ========== MAX30102 INITIALIZATION ==========
  int maxAttempts = 3;
  bool sensorFound = false;
  for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    if (oximeter.begin(Wire, I2C_SPEED_FAST)) {
      sensorFound = true;
      break;
    }
    delay(500);
  }
  
  if (!sensorFound) {
    Serial.println(F("❌ MAX30102 NOT FOUND!"));
    while (1) delay(1000);
  }
  Serial.println(F("✅ MAX30102 found successfully!"));

  oximeter.setup(0.5, 4, 2, 100, 411, 4096);
  oximeter.setPulseAmplitudeRed(0x1F);
  oximeter.setPulseAmplitudeIR(0x1F);
  oximeter.enableFIFORollover();
}

void loop() {
  unsigned long now = millis();

  // ========== READ BMI160 GYROSCOPE & ACCELEROMETER ==========
  int16_t accelGyro[6] = {0};
  int rslt = bmi160.getAccelGyroData(accelGyro);
  
  if (rslt == BMI160_OK) {
    // Gyroscope angular velocity (°/s)
    float rawGx = accelGyro[0] * 0.01745;
    float rawGy = accelGyro[1] * 0.01745;
    float rawGz = accelGyro[2] * 0.01745;

    // Apply strict Deadband Filter: when device is untouched on table, force 0.00 °/s
    gx = (abs(rawGx) < 0.35) ? 0.0 : rawGx;
    gy = (abs(rawGy) < 0.35) ? 0.0 : rawGy;
    gz = (abs(rawGz) < 0.35) ? 0.0 : rawGz;

    // Accelerometer raw LSB (16384 LSB/g for +/-2g scale)
    ax = accelGyro[3] / 16384.0;
    ay = accelGyro[4] / 16384.0;
    az = accelGyro[5] / 16384.0;
    gyroValid = true;

    // Calculate total G-Force acceleration vector
    float gForce = sqrt(ax * ax + ay * ay + az * az);

    // Calibrated Fall Threshold: gForce > 2.0g triggers a fall impact alert!
    if (gForce > 2.0 && (now - lastFallTriggerTime > 2500)) {
      Serial.print(F("🚨 FALL IMPACT DETECTED! G-Force Peak: "));
      Serial.println(gForce, 2);
      fallDetected = true;
      lastFallTriggerTime = now;
      sendDataToApp(latestBPM, latestSpO2, gx, gy, gz, true); 
      delay(1000); 
      fallDetected = false; 
    }
  } else {
    gyroValid = false;
  }

  // ========== READ MAX30102 OXIMETER (NON-BLOCKING SAMPLING) ==========
  oximeter.check();
  while (oximeter.available()) {
    redBuffer[sampleIndex] = (uint32_t)oximeter.getRed();
    irBuffer[sampleIndex]  = (uint32_t)oximeter.getIR();
    sampleIndex++;
    if (sampleIndex >= MAX_SAMPLES) sampleIndex = 0;
    oximeter.nextSample();
  }

  if (now - lastOximeterRead >= OXIMETER_INTERVAL) {
    lastOximeterRead = now;

    uint32_t currentIR = oximeter.getIR();
    if (currentIR > 50000) {
      // Finger detected on MAX30102 sensor
      maxim_heart_rate_and_oxygen_saturation(
        irBuffer, MAX_SAMPLES, redBuffer,
        &spo2, &validSPO2, &heartRate, &validHeartRate
      );

      if (validHeartRate) {
        latestBPM = getFilteredBPM(heartRate);
      }
      
      if (validSPO2) {
        latestSpO2 = getFilteredSpO2(spo2);
      }

      filterIndex = (filterIndex + 1) % FILTER_SIZE;
    } else {
      // Finger removed - report 0
      latestBPM = 0;
      latestSpO2 = 0;
      for (int i = 0; i < FILTER_SIZE; i++) {
        bpmBuffer[i] = 0;
        spo2Buffer[i] = 0;
      }
    }
  }

  // ========== SEND LIVE SENSOR STREAM TO APP EVERY 500ms ==========
  if (now - lastNetworkSendTime >= NETWORK_SEND_INTERVAL) {
    lastNetworkSendTime = now;
    sendDataToApp(latestBPM, latestSpO2, gx, gy, gz, fallDetected);
  }

  delay(10);
}
