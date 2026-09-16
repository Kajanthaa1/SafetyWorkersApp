/*
 * CloudUplink.h
 * Smart IoT Worker Safety Watch - Group 10
 *
 * Connects to Wi-Fi and sends sensor data to the cloud / app.
 *
 * NOTE ON THE NAME:
 * This class is called CloudUplink, not NetworkManager, because the
 * ESP32 board package already has its own class named NetworkManager.
 * Two classes with the same name cause a "redefinition" compile error.
 *
 * ==========================================================
 * YOU MUST EDIT THE SETTINGS BELOW
 *   1. Wi-Fi name and password
 *   2. Choose Firebase OR your own backend
 *   3. Put your real URL in
 * ==========================================================
 *
 * No extra library needed. WiFi.h and HTTPClient.h come with
 * the ESP32 board package.
 */

#pragma once

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>

// =====================================================
// 1. WI-FI SETTINGS
// =====================================================
#define WIFI_SSID      "FOE_Students"
#define WIFI_PASSWORD  "FOE@30st"      // <-- CHECK THIS IS COMPLETE

#define WIFI_CONNECT_TIMEOUT  15000    // ms to wait at boot

// =====================================================
// 2. WHERE TO SEND THE DATA
//    Set ONE of these to 1, the other to 0.
// =====================================================
#define USE_FIREBASE   0     // send straight to Firebase Realtime Database
#define USE_BACKEND    1     // send to your own Node.js server

// ---- Firebase settings (only if USE_FIREBASE is 1) ----
// Find this in Firebase Console -> Realtime Database.
// It looks like:  https://myproject-default-rtdb.firebaseio.com
#define FIREBASE_HOST   "https://YOUR-PROJECT-default-rtdb.firebaseio.com"

// Database secret / auth token. Leave empty "" if your rules allow open writes.
#define FIREBASE_AUTH   ""

// Which worker is wearing this watch
#define WORKER_ID       "worker01"

// ---- Your own backend (only if USE_BACKEND is 1) ----
// Example: "http://192.168.1.50:3000/api/sensor"
#define BACKEND_URL     "http://10.34.13.10:5000/api/sensor"

// =====================================================
// 3. HOW OFTEN TO SEND
// =====================================================
#define SEND_INTERVAL_MS   2500    // send data every 2.5 seconds (rock solid on ESP32-C3)
#define HTTP_TIMEOUT_MS    2500    // give up quickly if server is busy

class CloudUplink {
  public:

    // =================================================
    // CONNECT TO WI-FI (call once in setup)
    // =================================================
    bool begin() {
      Serial.print(F("Connecting to Wi-Fi: "));
      Serial.println(WIFI_SSID);

      WiFi.mode(WIFI_STA);
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

      unsigned long start = millis();

      while (WiFi.status() != WL_CONNECTED &&
             millis() - start < WIFI_CONNECT_TIMEOUT) {
        delay(500);
        Serial.print(".");
      }

      Serial.println();

      if (WiFi.status() == WL_CONNECTED) {
        _connected = true;
        Serial.print(F("  Wi-Fi connected. IP = "));
        Serial.println(WiFi.localIP());
        return true;
      }

      _connected = false;
      Serial.println(F("  Wi-Fi FAILED. Device will work offline."));
      Serial.println(F("  (sensors and screen still run normally)"));
      return false;
    }

    bool connected() {
      _connected = (WiFi.status() == WL_CONNECTED);
      return _connected;
    }

    // =================================================
    // TRY TO RECONNECT IF WI-FI DROPPED
    // Call this from loop(). It does not block.
    // =================================================
    void maintain() {
      if (WiFi.status() == WL_CONNECTED) {
        _connected = true;
        return;
      }

      _connected = false;

      // try again every 10 seconds, but never block the loop
      if (millis() - _lastRetry >= 10000) {
        _lastRetry = millis();
        Serial.println(F("Wi-Fi lost - reconnecting..."));
        WiFi.disconnect();
        WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
      }
    }

    // =================================================
    // SEND NORMAL SENSOR DATA
    // Returns true if the server accepted it.
    // =================================================
    bool sendData(int bpm, int spo2, bool validVitals,
                  float gx, float gy, float gz,
                  bool imuOK, bool fall) {

      if (!connected()) return false;

      // only send every SEND_INTERVAL_MS
      if (millis() - _lastSend < SEND_INTERVAL_MS) return false;
      _lastSend = millis();

      String json = _buildJson(bpm, spo2, validVitals,
                               gx, gy, gz, imuOK, fall, false);

      return _post(json, false);
    }

    // =================================================
    // SEND AN EMERGENCY ALERT (immediately, no waiting)
    // =================================================
    bool sendAlert(int bpm, int spo2, bool validVitals,
                   float gx, float gy, float gz, bool imuOK) {

      if (!connected()) {
        Serial.println(F("ALERT could not be sent - no Wi-Fi"));
        return false;
      }

      String json = _buildJson(bpm, spo2, validVitals,
                               gx, gy, gz, imuOK, true, true);

      Serial.println(F("Sending EMERGENCY alert..."));
      return _post(json, true);
    }

  private:
    bool _connected = false;
    unsigned long _lastSend = 0;
    unsigned long _lastRetry = 0;

    // =================================================
    // Build the JSON message
    // =================================================
    String _buildJson(int bpm, int spo2, bool validVitals,
                      float gx, float gy, float gz,
                      bool imuOK, bool fall, bool isAlert) {

      String j = "{";

      j += "\"workerId\":\"";  j += WORKER_ID;        j += "\",";
      j += "\"uptime\":";      j += millis() / 1000;  j += ",";

      // vitals (allow independent transmission)
      if (bpm >= 35 && bpm <= 220) {
        j += "\"bpm\":"; j += bpm; j += ",";
      } else {
        j += "\"bpm\":null,";
      }

      if (spo2 >= 70 && spo2 <= 100) {
        j += "\"spo2\":"; j += spo2; j += ",";
      } else {
        j += "\"spo2\":null,";
      }

      // motion
      if (imuOK) {
        j += "\"gx\":"; j += String(gx, 1); j += ",";
        j += "\"gy\":"; j += String(gy, 1); j += ",";
        j += "\"gz\":"; j += String(gz, 1); j += ",";
      } else {
        j += "\"gx\":null,\"gy\":null,\"gz\":null,";
      }

      j += "\"fall\":";      j += (fall    ? "true" : "false"); j += ",";
      j += "\"imuOnline\":"; j += (imuOK   ? "true" : "false"); j += ",";
      j += "\"alert\":";     j += (isAlert ? "true" : "false");

      j += "}";
      return j;
    }

    // =================================================
    // Send the JSON over HTTP
    // =================================================
    bool _post(const String &json, bool isAlert) {
      String url;
      bool isHttps = false;

#if USE_FIREBASE
      // Firebase REST API.
      // Normal data goes to /workers/<id>/live.json  (overwritten each time)
      // Alerts go to     /workers/<id>/alerts.json  (a new entry each time)
      url  = FIREBASE_HOST;
      url += "/workers/";
      url += WORKER_ID;
      url += (isAlert ? "/alerts.json" : "/live.json");

      if (strlen(FIREBASE_AUTH) > 0) {
        url += "?auth=";
        url += FIREBASE_AUTH;
      }

      isHttps = true;
#endif

#if USE_BACKEND
      url = BACKEND_URL;
      isHttps = (url.startsWith("https"));
#endif

      HTTPClient http;
      bool ok = false;

      if (isHttps) {
        WiFiClientSecure client;
        client.setInsecure();          // skip certificate check (prototype only)

        http.begin(client, url);
        http.setTimeout(HTTP_TIMEOUT_MS);
        http.addHeader("Content-Type", "application/json");

        // Firebase: PUT replaces live data, POST adds a new alert entry
        int code;
#if USE_FIREBASE
        code = isAlert ? http.POST(json) : http.PUT(json);
#else
        code = http.POST(json);
#endif
        ok = (code > 0 && code < 300);
        _report(code, isAlert);
        http.end();
        client.stop();

      } else {
        WiFiClient client;

        http.begin(client, url);
        http.setTimeout(HTTP_TIMEOUT_MS);
        http.addHeader("Content-Type", "application/json");

        int code = http.POST(json);
        ok = (code > 0 && code < 300);
        _report(code, isAlert);
        http.end();
        client.stop();
      }

      return ok;
    }

    void _report(int code, bool isAlert) {
      if (code > 0 && code < 300) {
        Serial.print(isAlert ? F("  ALERT sent OK (")
                             : F("  data sent OK ("));
        Serial.print(code);
        Serial.println(")");
      } else {
        Serial.print(F("  send FAILED, code = "));
        Serial.print(code);
        if (code < 0) {
          Serial.print(F(" ("));
          Serial.print(HTTPClient::errorToString(code));
          Serial.print(F(")"));
        }
        Serial.println();
      }
    }
};
