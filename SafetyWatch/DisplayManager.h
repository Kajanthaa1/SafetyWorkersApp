#pragma once

#define ENABLE_DISPLAY   1
#define USE_SH1106       0

#define DISPLAY_REINIT_MS  4000

#include <Arduino.h>
#include <Wire.h>

#if ENABLE_DISPLAY
  #include <Adafruit_GFX.h>

  #if USE_SH1106
    #include <Adafruit_SH110X.h>
    #define OLED_TYPE   Adafruit_SH1106G
    #define OLED_WHITE  SH110X_WHITE
    #define OLED_BLACK  SH110X_BLACK
  #else
    #include <Adafruit_SSD1306.h>
    #define OLED_TYPE   Adafruit_SSD1306
    #define OLED_WHITE  SSD1306_WHITE
    #define OLED_BLACK  SSD1306_BLACK
  #endif
#endif

#define OLED_WIDTH   128
#define OLED_HEIGHT  64
#define OLED_ADDR    0x3C

class DisplayManager {
  public:

    bool begin() {
#if !ENABLE_DISPLAY
      return false;
#else
      _oled = new OLED_TYPE(OLED_WIDTH, OLED_HEIGHT, &Wire, -1);

      if (!_startPanel()) return false;

      _ready = true;
      _lastReinit = millis();
      return true;
#endif
    }

    bool ready() const { return _ready; }

    void showBootMessage(const char* line1, const char* line2 = nullptr) {
      if (!_ready) return;
#if ENABLE_DISPLAY
      _oled->clearDisplay();
      _oled->setTextColor(OLED_WHITE);
      _oled->setTextSize(1);
      _oled->setCursor(0, 0);
      _oled->println(line1);
      if (line2) _oled->println(line2);
      _sendFrame();
      _forceRedraw = true;
#endif
    }

    void showFallAlert() {
      if (!_ready) return;
#if ENABLE_DISPLAY
      _oled->clearDisplay();
      _oled->setTextColor(OLED_WHITE);

      _oled->setTextSize(2);
      _oled->setCursor(10, 8);
      _oled->print(F("FALL!"));

      _oled->setTextSize(1);
      _oled->setCursor(10, 34);
      _oled->print(F("EMERGENCY"));
      _oled->setCursor(10, 46);
      _oled->print(F("ALERT SENT"));

      _sendFrame();
      _forceRedraw = true;
#endif
    }

    void showStatus(bool fingerOn, bool dataValid,
                    int bpm, int spo2, bool fall, bool imuOK) {
      if (!_ready) return;
#if ENABLE_DISPLAY
      unsigned long now = millis();

      bool timeToReinit = (now - _lastReinit >= DISPLAY_REINIT_MS);

      if (timeToReinit) {
        _startPanel();
        _lastReinit  = now;
        _forceRedraw = true;
      }

      if (!_forceRedraw &&
          fingerOn == _lastFinger && dataValid == _lastValid &&
          bpm == _lastBpm && spo2 == _lastSpo2 &&
          fall == _lastFall && imuOK == _lastImu) {
        return;
      }

      _lastFinger = fingerOn; _lastValid = dataValid;
      _lastBpm = bpm;         _lastSpo2  = spo2;
      _lastFall = fall;       _lastImu   = imuOK;
      _forceRedraw = false;

      _oled->clearDisplay();
      _oled->setTextColor(OLED_WHITE);

      _oled->setTextSize(1);
      _oled->setCursor(0, 0);
      _oled->print(F("WORKER MONITOR"));

      _oled->setTextSize(1);
      _oled->setCursor(0, 18);
      _oled->print(F("BPM"));

      _oled->setTextSize(2);
      _oled->setCursor(56, 14);
      if (dataValid)     _oled->print(bpm);
      else if (fingerOn) _oled->print(F(".."));
      else               _oled->print(F("--"));

      _oled->setTextSize(1);
      _oled->setCursor(0, 38);
      _oled->print(F("SpO2"));

      _oled->setTextSize(2);
      _oled->setCursor(56, 34);
      if (dataValid)     { _oled->print(spo2); _oled->print(F("%")); }
      else if (fingerOn)   _oled->print(F(".."));
      else                 _oled->print(F("--"));

      _oled->setTextSize(1);
      _oled->setCursor(0, 56);

      if (fall)         _oled->print(F("FALL: DETECTED"));
      else if (!imuOK)  _oled->print(F("FALL: IMU OFF"));
      else              _oled->print(F("FALL: NONE"));

      _sendFrame();
#endif
    }

    void invalidate() { _forceRedraw = true; }

  private:
#if ENABLE_DISPLAY
    OLED_TYPE* _oled = nullptr;
#endif
    bool _ready = false;
    bool _forceRedraw = true;
    unsigned long _lastReinit = 0;

    bool _lastFinger = false, _lastValid = false;
    bool _lastFall = false,   _lastImu = false;
    int  _lastBpm = -1,       _lastSpo2 = -1;

#if ENABLE_DISPLAY

    bool _startPanel() {
  #if USE_SH1106
      if (!_oled->begin(OLED_ADDR, true)) return false;
  #else
      if (!_oled->begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) return false;

      _oled->ssd1306_command(SSD1306_SETSTARTLINE | 0x00);
      _oled->ssd1306_command(SSD1306_MEMORYMODE);
      _oled->ssd1306_command(0x00);
      _oled->ssd1306_command(SSD1306_SEGREMAP | 0x01);
      _oled->ssd1306_command(SSD1306_COMSCANDEC);
  #endif

      _oled->setTextWrap(false);
      _oled->clearDisplay();
      _oled->display();
      return true;
    }

    void _sendFrame() {
      delay(2);
      _oled->display();
      delay(2);
    }
#endif
};
