/*
 * DisplayManager.h
 * Smart IoT Worker Safety Watch - Group 10
 *
 * OLED screen: shows BPM, SpO2 and fall status.
 *
 * ==========================================================
 * WHY THE SCREEN WAS BREAKING UP
 *
 * The SSD1306 needs command bytes before every frame telling it
 * WHERE to put the picture. The MAX30102 and BMI160 use the same
 * two wires. When their traffic disturbs those command bytes, the
 * picture lands on the wrong rows - that is why the bottom line
 * appeared at the top with streaks underneath.
 *
 * THREE FIXES IN THIS FILE:
 *  1. The screen re-initialises itself every few seconds, so any
 *     corruption clears by itself instead of staying broken.
 *  2. A short pause before and after each frame, so the display
 *     transfer does not overlap with sensor traffic.
 *  3. Simple layout: text only, no lines or filled boxes. Fewer
 *     drawing commands means less to go wrong.
 * ==========================================================
 *
 * IF IT IS STILL BAD DURING YOUR DEMO:
 *   set ENABLE_DISPLAY to 0 below. Sensors and serial keep working.
 *
 * LIBRARIES: "Adafruit GFX Library" + "Adafruit SSD1306"
 */

#pragma once

#define ENABLE_DISPLAY   1    // 1 = use screen | 0 = skip screen completely
#define USE_SH1106       0    // 0 = SSD1306 (0.96") | 1 = SH1106 (1.3")

// How often to rebuild the screen from scratch (milliseconds).
// This is what makes a broken picture repair itself.
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

    // =================================================
    // START THE SCREEN
    // =================================================
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

    // =================================================
    // BOOT MESSAGE
    // =================================================
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

    // =================================================
    // FALL ALERT - big and simple
    // =================================================
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

    /* =================================================
     * MAIN SCREEN  (text only - nothing fancy)
     *
     *   WORKER MONITOR
     *
     *   BPM       88
     *   SpO2      97%
     *
     *   FALL: NONE
     * =================================================
     */
    void showStatus(bool fingerOn, bool dataValid,
                    int bpm, int spo2, bool fall, bool imuOK) {
      if (!_ready) return;
#if ENABLE_DISPLAY
      unsigned long now = millis();

      // ---- self healing ----
      // Every few seconds, restart the panel completely.
      // If the picture went wrong, this puts it right again.
      bool timeToReinit = (now - _lastReinit >= DISPLAY_REINIT_MS);

      if (timeToReinit) {
        _startPanel();
        _lastReinit  = now;
        _forceRedraw = true;
      }

      // ---- skip if nothing changed ----
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

      // ---------- title ----------
      _oled->setTextSize(1);
      _oled->setCursor(0, 0);
      _oled->print(F("WORKER MONITOR"));

      // ---------- BPM ----------
      _oled->setTextSize(1);
      _oled->setCursor(0, 18);
      _oled->print(F("BPM"));

      _oled->setTextSize(2);
      _oled->setCursor(56, 14);
      if (dataValid)     _oled->print(bpm);
      else if (fingerOn) _oled->print(F(".."));
      else               _oled->print(F("--"));

      // ---------- SpO2 ----------
      _oled->setTextSize(1);
      _oled->setCursor(0, 38);
      _oled->print(F("SpO2"));

      _oled->setTextSize(2);
      _oled->setCursor(56, 34);
      if (dataValid)     { _oled->print(spo2); _oled->print(F("%")); }
      else if (fingerOn)   _oled->print(F(".."));
      else                 _oled->print(F("--"));

      // ---------- fall status ----------
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
    // =================================================
    // Start (or restart) the panel and fix its settings
    // =================================================
    bool _startPanel() {
  #if USE_SH1106
      if (!_oled->begin(OLED_ADDR, true)) return false;
  #else
      if (!_oled->begin(SSD1306_SWITCHCAPVCC, OLED_ADDR)) return false;

      // Tell the panel exactly how to lay out the picture.
      // These are the settings that get corrupted by bus noise,
      // so we set them again every time.
      _oled->ssd1306_command(SSD1306_SETSTARTLINE | 0x00);  // start at row 0
      _oled->ssd1306_command(SSD1306_MEMORYMODE);           // addressing mode
      _oled->ssd1306_command(0x00);                         // horizontal
      _oled->ssd1306_command(SSD1306_SEGREMAP | 0x01);      // left/right correct
      _oled->ssd1306_command(SSD1306_COMSCANDEC);           // top/bottom correct
  #endif

      _oled->setTextWrap(false);     // long text must not spill onto other rows
      _oled->clearDisplay();
      _oled->display();
      return true;
    }

    // =================================================
    // Send one frame, kept away from sensor traffic
    // =================================================
    void _sendFrame() {
      delay(2);            // let the bus settle before the big transfer
      _oled->display();    // sends the whole 1KB picture
      delay(2);            // and settle again afterwards
    }
#endif
};
