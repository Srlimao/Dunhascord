# ⚡ Dunhascord

> **High-Performance Discord-Style Voice Chat, Noise Suppression & 1080p 60 FPS Multi-Screen Sharing with Native Process Audio Loopback.**

[![Release 1.0.0](https://img.shields.io/badge/release-v1.0.0-blue.svg)](https://github.com/Srlimao/Dunhascord/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org)
[![Electron](https://img.shields.io/badge/Electron-v34-47848F.svg)](https://www.electronjs.org/)

---

## 🌟 Overview

**Dunhascord** is a self-hosted, lightweight voice and screen-sharing application engineered for gamers and friends who want ultra-low latency, crisp 1080p/1440p 60 FPS streams, crystal-clear voice communication, and **game-only audio capture** without installing third-party virtual audio cables.

---

## ✨ Features

- 🎮 **Native Windows WASAPI Process Audio Loopback Engine**:
  - Direct Win32 / Core Audio COM capture (`AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS` & `IAudioSessionEnumerator`).
  - Isolates game/app audio (e.g. Scrap Mechanic, Chrome, games) with **zero background system sounds** and **no virtual audio cables**.
- 🎥 **Fluid 1080p/1440p @ 60 FPS Gaming Streams**:
  - Tuned WebRTC SDP bitrates (up to 16 Mbps) with `maintain-framerate` degradation preference.
  - Multi-stream mesh supporting multiple simultaneous screen sharers in the same room.
- 🎙️ **Voice Chat & Noise Suppression**:
  - Real-time Web Audio high-pass filter and dynamic noise gate to cut keyboard clicks and background hums.
  - Animated speaking halos and microphone VU volume gauges.
- 🎧 **Live Audio Monitoring & VU Gauges**:
  - Live animated green-to-yellow gradient audio level meters on stream cards.
  - Debug headset monitor button (**`🎧`**) to listen to your stream output directly in real-time.
- 📊 **Real-time Performance HUD**:
  - Live decoded FPS, resolution, bitrate (Mbps), and round-trip latency metrics overlay.
- 🌐 **Dual Platform Support**:
  - **Web Client**: Access via any modern browser (Chrome, Edge, Firefox).
  - **Electron Desktop Client**: Native window picker, hardware capture, and integrated WASAPI process hook.
- 🔒 **Automatic Dual HTTP/HTTPS & WebSockets**:
  - Self-signed certificate generation with Subject Alternative Names (SAN) for easy local LAN & HTTPS testing.

---

## 🚀 Quick Start

### 1. Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- Windows 10/11 (for native WASAPI process loopback)
- Visual Studio C++ build tools (optional, pre-built binary included in `src/bin/`)

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/Srlimao/Dunhascord.git
cd Dunhascord

# Install dependencies
npm install

# Build standalone distribution
npm run build
```

### 3. Running Dunhascord

#### A. Start the Backend Server:
```bash
npm start
```
- **HTTP**: `http://localhost:3000`
- **HTTPS**: `https://localhost:3443`

#### B. Launch the Electron Desktop App:
```bash
npm run electron
```

---

## 🎮 How Game-Only Audio Capture Works

Dunhascord incorporates a compiled 64-bit native Windows audio engine (`src/bin/process_audio_capture.exe`):
1. Upon selecting a window or game (e.g., *Scrap Mechanic*), Dunhascord uses Windows `IAudioSessionEnumerator` to find the exact audio session and process ID.
2. It initiates Windows 10/11 `VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK` on the process tree.
3. Raw 48kHz 16-bit stereo PCM chunks stream over Electron IPC to Web Audio `ScriptProcessorNode` and seamlessly attach to the WebRTC stream.

---

## 🛠️ Quality Presets

| Preset | Resolution | Framerate | Target Bitrate | Ideal For |
| :--- | :--- | :--- | :--- | :--- |
| **1080p 60 FPS** | 1920 x 1080 | 60 FPS | 10 Mbps | High-speed action / Gaming (Default) |
| **1440p 60 FPS** | 2560 x 1440 | 60 FPS | 16 Mbps | High-resolution crisp desktop & UI |
| **720p 60 FPS** | 1280 x 720 | 60 FPS | 5 Mbps | Fast motion on bandwidth-constrained networks |
| **1080p 30 FPS** | 1920 x 1080 | 30 FPS | 6 Mbps | Standard desktop presentation & browsing |

---

## 📁 Project Architecture

```
Dunhascord/
├── .github/workflows/deploy.yml   # CI/CD automated build & release pipeline
├── src/
│   ├── bin/
│   │   └── process_audio_capture.exe  # Native compiled 64-bit WASAPI capturer
│   ├── native/
│   │   └── process_audio_capturer.cpp # C++ WASAPI Process Loopback engine
│   ├── electron/
│   │   ├── main.js                    # Electron main process & IPC audio bridge
│   │   └── preload.js                 # Context bridge API
│   ├── server/
│   │   ├── server.js                  # Dual HTTP/HTTPS server with SAN certs
│   │   └── signaling_handler.js       # WebSocket signaling room manager
│   └── client/
│       ├── app.js                     # Main client coordinator
│       ├── index.html                 # Dark Discord-style interface
│       ├── style.css                  # Modern responsive stylesheet
│       ├── audio/
│       │   ├── voice_processor.js     # Microphone capture & speaking detection
│       │   ├── noise_gate.js          # Web Audio dynamic noise filter
│       │   └── process_audio_receiver.js # PCM buffer stream & volume meter
│       ├── ui/
│       │   ├── source_picker.js       # Window & screen selector
│       │   ├── stream_renderer.js     # Multi-stream cards, stats HUD & VU meter
│       │   └── voice_view.js          # Voice avatar tiles & speaking halos
│       └── webrtc/
│           ├── mesh_manager.js        # Multi-peer WebRTC mesh coordinator
│           ├── stream_capture.js      # Video capture & SDP bitrate munger
│           ├── audio_mixer.js         # Web Audio track routing
│           └── stats_monitor.js       # WebRTC stats collector
├── scripts/
│   ├── build.js                       # Standalone dist builder
│   └── compile-native.bat             # MSVC compiler script for native C++
├── package.json
└── README.md
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
