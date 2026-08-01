#include <Wire.h>
#include <MAX30105.h>
#include <spo2_algorithm.h>
#include "DFRobot_BMI160.h"
#include <WiFi.h>
#include <HTTPClient.h>

// ==================== WiFi & Server Configuration ====================
const char* ssid = "FOE_Students";
const char* password = "FOE@30st";
const char* serverVitalsEndpoint = "http://10.34.14.241:5000/api/device/vitals";
const char* serverAlertEndpoint = "http://10.34.14.241:5000/api/device/alert";
const char* deviceToken = "device_token_worker1_xyz";

// ==================== MAX30102 Oximeter ====================
MAX30105 oximeter;
const int MAX_SAMPLES = 100;
uint32_t irBuffer[MAX_SAMPLES];   
uint32_t redBuffer[MAX_SAMPLES];  
int32_t spo2;                     
int8_t validSPO2;                 
int32_t heartRate;                
int8_t validHeartRate;            

// ==================== BMI160 Gyroscope ====================
DFRobot_BMI160 bmi160;
const int8_t BMI160_ADDR = 0x69;   
const float FALL_THRESHOLD = 200.0; // Adjust this based on testing

// ==================== Timing ====================
unsigned long lastOximeterRead = 0;
const int OXIMETER_INTERVAL = 2000;  
unsigned long lastGyroPrintTime = 0;
const int GYRO_PRINT_INTERVAL = 500;  

// ==================== Variables ====================
int latestBPM = 0;
int latestSpO2 = 0;
bool hasValidData = false;
int readCount = 0;

float gx = 0, gy = 0, gz = 0;
bool gyroValid = false;
bool fallDetected = false;

// ==================== Network Function ====================
void sendDataToApp(int bpm, int oxygen, float gyroX, float gyroY, float gyroZ, bool fallFlag) {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    
    if (fallFlag) {
      // Send Fall Alert to Backend
      Serial.println(F("🚨 Fall event triggered! Sending alert to server..."));
      http.begin(serverAlertEndpoint);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("x-device-token", deviceToken);

      String jsonPayload = "{\"type\":\"fall\"}";
      int httpResponseCode = http.POST(jsonPayload);
      
      if (httpResponseCode > 0) {
        Serial.print(F("HTTP Fall Alert Sent. Code: "));
        Serial.println(httpResponseCode);
      } else {
        Serial.print(F("Error sending Fall Alert. Code: "));
        Serial.println(httpResponseCode);
      }
      http.end();
    } else {
      // Send Vitals + Gyroscope Data to Backend & Firebase
      Serial.println(F("Sending standard vitals & gyro update..."));
      http.begin(serverVitalsEndpoint);
      http.addHeader("Content-Type", "application/json");
      http.addHeader("x-device-token", deviceToken);

      // Construct JSON payload with BPM, SpO2, and Gyro (X, Y, Z)
      String jsonPayload = "{\"bpm\":" + String(bpm) + 
                           ",\"spo2\":" + String(oxygen) + 
                           ",\"gx\":" + String(gyroX, 2) + 
                           ",\"gy\":" + String(gyroY, 2) + 
                           ",\"gz\":" + String(gyroZ, 2) + "}";
      int httpResponseCode = http.POST(jsonPayload);
      
      if (httpResponseCode > 0) {
        Serial.print(F("HTTP Vitals & Gyro Sent. Code: "));
        Serial.println(httpResponseCode);
      } else {
        Serial.print(F("Error sending vitals. Code: "));
        Serial.println(httpResponseCode);
      }
      http.end();
    }
  } else {
    Serial.println(F("WiFi Disconnected. Cannot send data."));
  }
}

void setup() {
  Serial.begin(115200);
  while (!Serial);

  Serial.println(F("\n=== Smartwatch: Vitals & Fall Detection ==="));

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

  // ========== READ GYROSCOPE & DETECT FALL ==========
  int16_t accelGyro[6] = {0};
  int rslt = bmi160.getAccelGyroData(accelGyro);
  
  if (rslt == BMI160_OK) {
    gx = accelGyro[0] * 0.01745;
    gy = accelGyro[1] * 0.01745;
    gz = accelGyro[2] * 0.01745;
    gyroValid = true;

    // Calculate angular magnitude
    float gyroMagnitude = sqrt((gx * gx) + (gy * gy) + (gz * gz));
    
    if (gyroMagnitude > FALL_THRESHOLD) {
      Serial.println(F("🚨 FALL DETECTED! 🚨"));
      fallDetected = true;
      // Immediately send emergency data to server
      sendDataToApp(latestBPM, latestSpO2, gx, gy, gz, true); 
      delay(2000); // Debounce to prevent multiple rapid alerts
      fallDetected = false; 
    }
  } else {
    gyroValid = false;
  }

  // ========== READ OXIMETER ==========
  if (now - lastOximeterRead >= OXIMETER_INTERVAL) {
    lastOximeterRead = now;
    readCount++;

    int samples = 0;
    unsigned long startTime = millis();
    oximeter.clearFIFO();
    
    while (samples < MAX_SAMPLES) {
      if (oximeter.available()) {
        redBuffer[samples] = (uint32_t)oximeter.getRed();
        irBuffer[samples]  = (uint32_t)oximeter.getIR();
        samples++;
      }
      delay(1);
      if (millis() - startTime > 10000) break;
    }

    if (samples >= MAX_SAMPLES) {
      maxim_heart_rate_and_oxygen_saturation(
        irBuffer, MAX_SAMPLES, redBuffer,
        &spo2, &validSPO2, &heartRate, &validHeartRate
      );

      if (validHeartRate && heartRate > 0 && heartRate < 200) {
        latestBPM = heartRate;
        hasValidData = true;
      } else {
        latestBPM = 0;
      }
      
      if (validSPO2 && spo2 > 50 && spo2 < 100) {
        latestSpO2 = spo2;
        hasValidData = true;
      } else {
        latestSpO2 = 0;
      }

      // Send standard vitals & gyro update to app every read cycle
      if (hasValidData && latestBPM > 0 && latestSpO2 > 0) {
         sendDataToApp(latestBPM, latestSpO2, gx, gy, gz, fallDetected);
      }
    }
  }

  // ========== SERIAL PRINTING ==========
  if (now - lastGyroPrintTime >= GYRO_PRINT_INTERVAL) {
    lastGyroPrintTime = now;
    
    if (hasValidData && latestBPM > 0 && latestSpO2 > 0) {
      Serial.print(F("BPM: ")); Serial.print(latestBPM);
      Serial.print(F("\tSpO2: ")); Serial.print(latestSpO2);
      Serial.println(F(" %"));
    }
  }
  delay(10);
}
