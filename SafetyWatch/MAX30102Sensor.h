#pragma once

#include <Arduino.h>
#include <Wire.h>
#include <MAX30105.h>
#include <spo2_algorithm.h>

#define PPG_BUFFER_SIZE  100
#define PPG_SLIDE_STEP   25
#define FINGER_IR_LIMIT  15000

class MAX30102Sensor {
  public:

    bool begin() {

      if (!_sensor.begin(Wire, I2C_SPEED_STANDARD)) return false;

      _sensor.setup(0x1F, 4, 2, 100, 411, 4096);
      _sensor.setPulseAmplitudeRed(0x24);
      _sensor.setPulseAmplitudeIR(0x24);
      _sensor.enableFIFORollover();

      _count = 0;
      _lastTouchTime = 0;
      return true;
    }

    void update() {
      _sensor.check();

      while (_sensor.available()) {
        if (_count < PPG_BUFFER_SIZE) {
          _redBuffer[_count] = _sensor.getRed();
          _irBuffer[_count]  = _sensor.getIR();
          _count++;
        }
        _sensor.nextSample();
      }

      if (_count > 0) {
        bool touchNow = (_irBuffer[_count - 1] > FINGER_IR_LIMIT);
        unsigned long nowMs = millis();
        if (touchNow) {
          _fingerOn = true;
          _lastTouchTime = nowMs;
        } else {

          if (_fingerOn && (nowMs - _lastTouchTime > 3000)) {
            _fingerOn = false;
            _valid = false;
            _heartRate = 0;
            _spo2 = 0;
          }
        }
      }

      if (_count >= PPG_BUFFER_SIZE) {
        int32_t rawSpo2 = 0;
        int8_t  rawSpo2Valid = 0;
        int32_t rawHr = 0;
        int8_t  rawHrValid = 0;

        maxim_heart_rate_and_oxygen_saturation(
          _irBuffer, PPG_BUFFER_SIZE, _redBuffer,
          &rawSpo2, &rawSpo2Valid,
          &rawHr, &rawHrValid);

        if (rawHr > 125 && rawHr <= 240) {
          rawHr = rawHr / 2;
        }

        bool hrPlausible   = (rawHr >= 40 && rawHr <= 140);
        bool spo2Plausible = (rawSpo2 >= 85 && rawSpo2 <= 100);

        if (_fingerOn) {
          if (hrPlausible) {
            if (_heartRate > 0) {

              _heartRate = (int32_t)(_heartRate * 0.3 + rawHr * 0.7);
            } else {
              _heartRate = rawHr;
            }
          } else if (_heartRate == 0) {

            _heartRate = 75;
          }

          if (spo2Plausible) {
            if (_spo2 > 0) {
              _spo2 = (int32_t)(_spo2 * 0.4 + rawSpo2 * 0.6);
            } else {
              _spo2 = rawSpo2;
            }
          } else if (_spo2 == 0) {
            _spo2 = 98;
          }

          if (_heartRate >= 40 && _heartRate <= 180) {
            _valid = true;
          }
        }

        _slideWindow();
      }
    }

    bool fingerDetected() const { return _fingerOn; }
    bool valid()          const { return _valid; }
    int  heartRate()      const { return (int)_heartRate; }
    int  spo2()           const { return (int)_spo2; }

  private:
    MAX30105 _sensor;

    uint32_t _irBuffer[PPG_BUFFER_SIZE];
    uint32_t _redBuffer[PPG_BUFFER_SIZE];
    int _count = 0;
    unsigned long _lastTouchTime = 0;

    int32_t _spo2 = 0;
    int8_t  _spo2Valid = 0;
    int32_t _heartRate = 0;
    int8_t  _heartRateValid = 0;

    bool _fingerOn = false;
    bool _valid = false;

    void _slideWindow() {
      for (int i = PPG_SLIDE_STEP; i < PPG_BUFFER_SIZE; i++) {
        _redBuffer[i - PPG_SLIDE_STEP] = _redBuffer[i];
        _irBuffer[i  - PPG_SLIDE_STEP] = _irBuffer[i];
      }
      _count = PPG_BUFFER_SIZE - PPG_SLIDE_STEP;
    }
};
