# Safety Workers App 👷‍♂️🦺

An IoT-powered industrial worker safety and health monitoring ecosystem. The system pairs an ESP32-based wearable smart band (**SafetyWatch**) with a real-time **Backend Server** (Node.js / Express / Socket.io) and a cross-platform **Mobile & Web Application** (React Native / Expo) to detect hazards, track vitals, trigger emergency alarms, and streamline site attendance.

---

## 👥 Group Members

| Registration No | Name |
| :--- | :--- |
| **23/ENG/090** | Panchalingam K |
| **23/ENG/132** | B.Shangeeth |
| **23/EBG/133** | S.Shanoorzan |

- **23/ENG/090** - Panchalingam K
- **23/ENG/132** - B.Shangeeth
- **23/EBG/133** - S.Shanoorzan

---

## 📌 Project Overview

In high-risk industrial, manufacturing, and construction environments, ensuring worker safety and rapid response during emergencies is critical. **Safety Workers App** provides continuous physiological and environmental monitoring through wearable sensors, automatically flagging critical health spikes, dangerous falls, or SOS triggers to supervisors in real time.

### 🌟 Key Features

- **❤️ Real-time Vitals Monitoring**: Continuous measurement and broadcasting of Heart Rate (BPM) and Blood Oxygen Saturation ($\text{SpO}_2$) using the MAX30102 optical sensor.
- **🚨 Fall & Impact Detection**: 6-axis IMU (BMI160) tracking acceleration and gyroscope vectors with automatic fall trigger algorithms.
- **🆘 Instant SOS & Emergency Response**: Rapid on-device and in-app SOS buttons dispatching instant push notifications, audible alarms, and visual dashboard alerts.
- **📶 Multi-Channel Connectivity**: Flexible telemetry over BLE (Bluetooth Low Energy) for smartphone uplink, and direct Wi-Fi cloud data uplink.
- **🏢 Altitude & Floor Level Tracking**: Monitors worker vertical elevation and building floor level to pinpoint exact indoor locations during emergencies.
- **🕒 Smart Attendance & Geolocation**: Digital clock-in / clock-out logging with GPS coordinates and automated shift records.
- **📊 Supervisor & Admin Dashboard**: Centralized dashboard for site supervisors to monitor all active workers, acknowledge active alarms, and view historical health analytics.

---

## 🏗️ System Architecture

```
+-------------------------------------------------------------+
|                     SafetyWatch Wearable                    |
|      (ESP32 + MAX30102 PPG + BMI160 IMU + OLED Display)     |
+-------------------------------------------------------------+
                     |                          |
       Bluetooth LE (BLE)                 Direct Wi-Fi
                     |                          |
                     v                          |
+---------------------------+                   |
|   React Native / Expo     |                   |
|   Mobile & Web Frontend   |                   |
+---------------------------+                   |
              |                                 |
         REST / Socket.io                  REST / HTTP
              |                                 |
              +----------------+----------------+
                               |
                               v
               +-------------------------------+
               |     Backend API & WebSocket   |
               | (Node.js + Express + Socket)  |
               +-------------------------------+
                               |
                               v
               +-------------------------------+
               | Firebase Admin / Local Storage|
               +-------------------------------+
```

---

## 🛠️ Tech Stack & Hardware Components

### Hardware & Embedded Firmware (`SafetyWatch/`)
- **Microcontroller**: ESP32
- **Heart Rate & Pulse Oximeter**: MAX30102
- **Inertial Measurement Unit (IMU)**: BMI160 (Accelerometer & Gyroscope)
- **Display**: I2C 0.96" OLED Display (SSD1306)
- **Alert Indicator**: Active Piezo Buzzer & Status LEDs
- **Protocols**: I2C, BLE (Bluetooth Low Energy), Wi-Fi (HTTP REST Uplink)

### Backend Services (`backend/`)
- **Runtime**: Node.js & TypeScript
- **Framework**: Express.js
- **Real-Time Engine**: Socket.IO (bidirectional low-latency events)
- **Database / Cloud**: Firebase Admin SDK & structured JSON storage
- **Tooling**: `ts-node-dev`, `dotenv`, `cors`

### Frontend Application (`frontend/`)
- **Framework**: React Native with Expo (v54) & TypeScript
- **Navigation & Styling**: Custom responsive design with `expo-linear-gradient`
- **Sensors & Connectivity**: `react-native-ble-plx`, `expo-location`, `socket.io-client`
- **Supported Platforms**: Android, iOS, and Web

---

## 📁 Repository Structure

```
SafetyWorkersApp/
├── SafetyWatch/                    # ESP32 Arduino / C++ Firmware
│   ├── SafetyWatch.ino             # Main firmware setup and loop logic
│   ├── MAX30102Sensor.h            # Pulse oximeter & heart rate driver
│   ├── BMI160Sensor.h              # 6-axis accelerometer & fall detection
│   ├── CloudUplink.h               # Wi-Fi HTTP telemetry uplink
│   └── DisplayManager.h            # OLED display rendering management
│
├── backend/                        # Node.js TypeScript API & WebSocket Server
│   ├── data/                       # Local JSON datasets (attendance, vitals, users)
│   ├── src/
│   │   ├── db.ts                   # Database interface & data persistence
│   │   ├── routes.ts               # REST API endpoints & route handlers
│   │   └── server.ts               # Express server & Socket.IO instance
│   └── package.json
│
├── frontend/                       # React Native Expo Mobile App
│   ├── src/
│   │   ├── screens/
│   │   │   ├── LoginScreen.tsx          # Worker & Admin authentication
│   │   │   ├── WorkerHomeScreen.tsx     # Worker vitals, BLE pairing & SOS
│   │   │   └── AdminDashboardScreen.tsx # Real-time supervisor monitoring
│   │   └── services/
│   │       └── api.ts                   # Backend API & socket client connection
│   └── package.json
│
├── firestore.rules                 # Security rules for Firebase deployment
└── README.md                       # Project documentation
```

---

## 🚦 Getting Started

### 1. SafetyWatch Firmware
1. Open [`SafetyWatch/SafetyWatch.ino`](SafetyWatch/SafetyWatch.ino) in the Arduino IDE or PlatformIO.
2. Install the necessary libraries:
   - Adafruit SSD1306 & GFX Library
   - SparkFun MAX3010X Pulse and Proximity Sensor Library
   - DFRobot BMI160 / relevant BMI160 library
3. Connect your ESP32 board and upload the firmware.

### 2. Backend Server Setup
```bash
cd backend
npm install
npm run dev
```
The server will start at `http://localhost:5000` (or your configured LAN IP).

### 3. Frontend App Setup
```bash
cd frontend
npm install
npm run start
```
Scan the generated QR code using the **Expo Go** mobile app (Android/iOS) or press `w` to open in a web browser.