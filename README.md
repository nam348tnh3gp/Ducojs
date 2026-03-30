# ⛏️ DUCO Web Miner
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)(https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-18.x-green)](https://nodejs.org/)
[![Rust](https://img.shields.io/badge/Rust-1.70+-orange)](https://www.rust-lang.org/)
[![Platform](https://img.shields.io/badge/Platform-Linux%20%7C%20Windows%20%7C%20macOS-lightgrey)]()

> **High-performance Duino-Coin miner with optional Rust acceleration + real-time web dashboard**

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🚀 **Rust FastHash** | Optional native acceleration (up to **50x faster**) |
| 📊 **Web Dashboard** | Real-time mining logs with Socket.IO |
| 🔄 **Auto-fallback** | Gracefully falls back to pure JS if Rust unavailable |
| 🧵 **Multi-threaded** | Uses all CPU cores via Node.js cluster |
| 🎯 **Smart Pool** | Auto-connects to fastest Duino-Coin pool |
| ⚙️ **Easy Config** | Simple `config.ini` file |
| 🔌 **Auto-reconnect** | Reconnects automatically on connection loss |

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 16.0 or higher
- **npm** or **yarn**
- **Rust** (optional - for FastHash acceleration)

### Installation

```bash
# Clone repository
git clone https://github.com/nam348tnh3gp/Ducojs.git
cd Ducojs

# Install dependencies
npm install

# (Optional) Build Rust FastHash for 50x performance boost
npm run build-fast

# Start miner + web dashboard
npm start

Configuration

Edit config.ini to set your mining parameters:

```ini
username=YourDuinoUsername
mining_key=YourMiningKey
hashlib=js-sha1          # Auto-selected by testLib
threads=2                # Number of CPU threads
difficulty=LOW           # LOW, MEDIUM, or NET
```

💡 Get your mining key: Visit Duino-Coin Wallet

---

🌐 Web Dashboard

Once running, open your browser to http://localhost:3000

Feature Description
📡 Real-time logs Live mining output with colors
⏹️ Stop / Restart Control the miner from web UI
🔍 Share stats Accepted/Rejected shares tracking

---

🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Web Dashboard (Port 3000)               │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  Socket.IO │ Express │ Static Files                 │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      app.js (Master Process)                 │
│  - Spawns miner processes                                   │
│  - Broadcasts logs via WebSocket                            │
│  - Handles stop/restart commands                            │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  Worker 0     │    │  Worker 1     │    │  Worker N     │
│  ┌─────────┐  │    │  ┌─────────┐  │    │  ┌─────────┐  │
│  │ FastHash│◄─┼────┼──│ FastHash│◄─┼────┼──│ FastHash│  │
│  │ (Rust)  │  │    │  │ (Rust)  │  │    │  │ (Rust)  │  │
│  └─────────┘  │    │  └─────────┘  │    │  └─────────┘  │
│       │       │    │       │       │    │       │       │
│       ▼       │    │       ▼       │    │       ▼       │
│  ┌─────────┐  │    │  ┌─────────┐  │    │  ┌─────────┐  │
│  │ JS      │  │    │  │ JS      │  │    │  │ JS      │  │
│  │ Fallback│  │    │  │ Fallback│  │    │  │ Fallback│  │
│  └─────────┘  │    │  └─────────┘  │    │  └─────────┘  │
└───────────────┘    └───────────────┘    └───────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                    ┌─────────────────┐
                    │  Duino-Coin     │
                    │  Pool Server    │
                    └─────────────────┘
```

---

⚡ Performance Comparison

Implementation Speed (H/s) Notes
Pure JavaScript ~10-50 No optimization
Rust FastHash ~500-2,000 50x faster using SIMD

Benchmark on Intel i7-10750H, 4 threads, LOW difficulty

---

📁 Project Structure

```
Ducojs/
├── app.js                 # Web server + process manager
├── package.json           # Dependencies
├── config.ini             # User configuration
├── pools.json             # Default pool configuration
├── testLib.js             # Hash library benchmark
├── libducohasher/         # Rust native addon (optional)
│   ├── Cargo.toml
│   ├── index.js
│   └── src/
│       └── lib.rs
├── miner/
│   ├── index.js           # Multi-threaded miner
│   └── src/
│       └── utils.js       # Mining core + FastHash detection
└── public/
    ├── index.html         # Web dashboard
    └── style.css          # Dashboard styling
```

---

🛠️ Development

Build FastHash from source

```bash
# Requires Rust installed (https://rustup.rs/)
npm run build-fast
```

Run in development mode

```bash
# With auto-restart on file changes
npm install -g nodemon
nodemon app.js
```

Manual testing

```bash
# Test hash library benchmark
node testLib.js

# Run miner standalone (no web UI)
node miner/index.js
```

---

📊 Mining Difficulty Options

Difficulty Description
LOW Lower difficulty, more shares, good for testing
MEDIUM Balanced difficulty
NET Network difficulty, adjusts automatically

---

🔐 Security Notes

· Mining key is stored in plain text in config.ini
· Keep your mining key private
· Do not share your config.ini file

---

🐛 Troubleshooting

FastHash not loading?

```bash
# Check if Rust is installed
rustc --version

# Rebuild FastHash
npm run build-fast
```

Miner won't connect?

· Check pools.json for a valid pool address
· Verify your internet connection
· Ensure the pool server is online

Low hashrate?

· Increase threads in config.ini (max = CPU cores)
· Try building FastHash for 50x speed boost
· Switch to difficulty=LOW for more shares

---

📝 License

Apache License - see LICENSE file for details

---

�Acknowledgments

· Duino-Coin for the amazing project
· revoxhere for the original Python miner
· The Rust community for neon bindings

---

👨‍💻 Author

Anonymous_N | GitHub

---

⭐ Star this repo if you find it useful!

```
