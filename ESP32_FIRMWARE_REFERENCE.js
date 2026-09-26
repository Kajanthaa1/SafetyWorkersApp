#include <Wire.h>
#include <SPIFFS.h>
#include "MAX30105.h"
#include "heartRate.h"
#include "DFRobot_BMI160.h"

MAX30105 particleSensor;
DFRobot_BMI160_I2C bmi160;

#define BUZZER_PIN 5
#define I2C_SDA 8
#define I2C_SCL 9

const byte RATE_SIZE = 4;
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

    int sum = 0;
    for (byte x = 0 ; x < RATE_SIZE ; x++) sum += rates[x];
    beatAvg = sum / RATE_SIZE;
  }
  return beatAvg;
}

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

  file.printf("%d,%d,%d\n", millis(), bpm, spo2);
  file.close();
  Serial.println("Offline reading buffered to SPIFFS.");
}

bool verifyFallInterrupt() {

  int16_t ax, ay, az;
  bmi160.getAccelerometerData(&ax, &ay, &az);

  float gForce = sqrt(ax*ax + ay*ay + az*az) / 16384.0;

  if (gForce > 3.0 || gForce < 0.2) {
    return true;
  }
  return false;
}

void triggerLocalBuzzer(bool state) {
  if (state) {
    digitalWrite(BUZZER_PIN, HIGH);
    Serial.println("[ALERT] Local Buzzer active!");
  } else {
    digitalWrite(BUZZER_PIN, LOW);
  }
}

void loop() {

  long irValue = particleSensor.getIR();
  if (checkForBeat(irValue) == true) {
    long delta = millis() - lastBeat;
    lastBeat = millis();
    int currentBPM = getFilteredBPM(delta);

    bool bleConnected = false;
    if (!bleConnected) {
      bufferReadingOffline(currentBPM, 98);
    }
  }

  if (digitalRead(6) == HIGH) {
    if (verifyFallInterrupt()) {
      triggerLocalBuzzer(true);

    }
  }
}
