#pragma once

#include <Arduino.h>
#include <Wire.h>

#define BMI160_REG_CHIP_ID    0x00
#define BMI160_REG_PMU_STATUS 0x03
#define BMI160_REG_DATA_GYRO  0x0C
#define BMI160_REG_ACC_CONF   0x40
#define BMI160_REG_ACC_RANGE  0x41
#define BMI160_REG_GYR_CONF   0x42
#define BMI160_REG_GYR_RANGE  0x43
#define BMI160_REG_CMD        0x7E

#define BMI160_CHIP_ID_VALUE  0xD1

#define BMI160_CMD_SOFT_RESET 0xB6
#define BMI160_CMD_ACC_NORMAL 0x11
#define BMI160_CMD_GYR_NORMAL 0x15

#define ACCEL_LSB_PER_G   16384.0f
#define GYRO_LSB_PER_DPS  16.4f

#define FALL_FREEFALL_G      0.5f
#define FALL_IMPACT_G        2.5f
#define FALL_FREEFALL_WINDOW 800
#define FALL_STILL_DELAY     1200
#define FALL_STILL_ACCEL_LO  0.75f
#define FALL_STILL_ACCEL_HI  1.25f
#define FALL_STILL_GYRO_DPS  60.0f

class BMI160Sensor {
  public:

    float ax = 0, ay = 0, az = 0;
    float gx = 0, gy = 0, gz = 0;
    float accelMagnitude = 0;
    float gyroMagnitude  = 0;

    bool begin() {

      uint8_t tryAddr[2] = { 0x69, 0x68 };
      bool found = false;

      for (uint8_t i = 0; i < 2 && !found; i++) {
        _addr = tryAddr[i];
        _chipId = _read8(BMI160_REG_CHIP_ID);
        if (_chipId == BMI160_CHIP_ID_VALUE) found = true;
      }

      if (!found) return false;

      _write8(BMI160_REG_CMD, BMI160_CMD_SOFT_RESET);
      delay(150);

      _write8(BMI160_REG_ACC_CONF,  0x28);
      _write8(BMI160_REG_ACC_RANGE, 0x03);
      _write8(BMI160_REG_GYR_CONF,  0x28);
      _write8(BMI160_REG_GYR_RANGE, 0x00);
      delay(20);

      for (uint8_t attempt = 0; attempt < 5; attempt++) {
        _write8(BMI160_REG_CMD, BMI160_CMD_ACC_NORMAL);
        delay(100);
        _write8(BMI160_REG_CMD, BMI160_CMD_GYR_NORMAL);
        delay(120);

        if (powerModesOK()) {
          _fallState = IDLE;
          return true;
        }
      }
      return false;
    }

    bool powerModesOK() {
      _pmuStatus = _read8(BMI160_REG_PMU_STATUS);
      bool accOK = ((_pmuStatus >> 4) & 0x03) == 0x01;
      bool gyrOK = ((_pmuStatus >> 2) & 0x03) == 0x01;
      return accOK && gyrOK;
    }

    uint8_t address()   const { return _addr; }
    uint8_t chipId()    const { return _chipId; }
    uint8_t pmuStatus() const { return _pmuStatus; }

    bool update() {
      uint8_t buf[12];
      if (!_readBurst(BMI160_REG_DATA_GYRO, buf, 12)) return false;

      int16_t rgx = (int16_t)((buf[1]  << 8) | buf[0]);
      int16_t rgy = (int16_t)((buf[3]  << 8) | buf[2]);
      int16_t rgz = (int16_t)((buf[5]  << 8) | buf[4]);
      int16_t rax = (int16_t)((buf[7]  << 8) | buf[6]);
      int16_t ray = (int16_t)((buf[9]  << 8) | buf[8]);
      int16_t raz = (int16_t)((buf[11] << 8) | buf[10]);

      gx = rgx / GYRO_LSB_PER_DPS;
      gy = rgy / GYRO_LSB_PER_DPS;
      gz = rgz / GYRO_LSB_PER_DPS;

      ax = rax / ACCEL_LSB_PER_G;
      ay = ray / ACCEL_LSB_PER_G;
      az = raz / ACCEL_LSB_PER_G;

      accelMagnitude = sqrtf(ax * ax + ay * ay + az * az);
      gyroMagnitude  = sqrtf(gx * gx + gy * gy + gz * gz);

      _runFallStateMachine();
      return true;
    }

    bool fallDetected() const { return _fallConfirmed; }
    void clearFall() { _fallConfirmed = false; _fallState = IDLE; }

  private:
    enum FallState { IDLE, FREEFALL, IMPACT };

    uint8_t _addr = 0x69;
    uint8_t _chipId = 0;
    uint8_t _pmuStatus = 0;

    FallState _fallState = IDLE;
    unsigned long _freefallTime = 0, _impactTime = 0;
    bool _fallConfirmed = false;

    void _write8(uint8_t reg, uint8_t val) {
      Wire.beginTransmission(_addr);
      Wire.write(reg);
      Wire.write(val);
      Wire.endTransmission();
    }

    uint8_t _read8(uint8_t reg) {
      Wire.beginTransmission(_addr);
      Wire.write(reg);
      if (Wire.endTransmission() != 0) return 0xFF;
      if (Wire.requestFrom(_addr, (uint8_t)1) != 1) return 0xFF;
      return Wire.read();
    }

    bool _readBurst(uint8_t reg, uint8_t* buf, uint8_t len) {
      Wire.beginTransmission(_addr);
      Wire.write(reg);
      if (Wire.endTransmission() != 0) return false;
      if (Wire.requestFrom(_addr, len) != len) return false;
      for (uint8_t i = 0; i < len; i++) buf[i] = Wire.read();
      return true;
    }

    void _runFallStateMachine() {
      unsigned long now = millis();

      switch (_fallState) {
        case IDLE:
          if (accelMagnitude < FALL_FREEFALL_G) {
            _fallState = FREEFALL;
            _freefallTime = now;
          }
          break;

        case FREEFALL:
          if (accelMagnitude > FALL_IMPACT_G) {
            _fallState = IMPACT;
            _impactTime = now;
          } else if (now - _freefallTime > FALL_FREEFALL_WINDOW) {
            _fallState = IDLE;
          }
          break;

        case IMPACT:
          if (now - _impactTime >= FALL_STILL_DELAY) {
            bool lyingStill  = (accelMagnitude > FALL_STILL_ACCEL_LO &&
                                accelMagnitude < FALL_STILL_ACCEL_HI);
            bool notRotating = (gyroMagnitude < FALL_STILL_GYRO_DPS);

            if (lyingStill && notRotating) _fallConfirmed = true;
            _fallState = IDLE;
          }
          break;
      }
    }
};
