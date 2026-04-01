const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const socketIO = require("socket.io");

// CÁCH 1: Dùng dynamic import cho strip-ansi (khuyên dùng)
let stripAnsi;
(async () => {
    try {
        const stripAnsiModule = await import("strip-ansi");
        stripAnsi = stripAnsiModule.default;
    } catch (err) {
        console.warn("⚠️ strip-ansi not available, using fallback");
        // Fallback function nếu không có strip-ansi
        stripAnsi = (str) => {
            return str.replace(/\x1b\[[0-9;]*m/g, '');
        };
    }
})();

// CÁCH 2: Nếu bạn muốn dùng require, hãy uncomment và comment cách 1
// const stripAnsi = (str) => {
//     // Simple ANSI escape code remover
//     return str.replace(/\x1b\[[0-9;]*m/g, '');
// };

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const minerPath = path.join(__dirname, "miner", "index.js");
const testPath = path.join(__dirname, "miner", "testLib.js");
let logBuffer = "";
let currentMiner = null;
let isTestRunning = false;
let reconnectAttempts = 0;

function broadcastLog(msg) {
  try {
    const clean = stripAnsi ? stripAnsi(msg) : msg;
    io.emit("miner-log", clean);
    logBuffer += clean;
    // Giới hạn buffer để tránh memory leak
    if (logBuffer.length > 50000) logBuffer = logBuffer.slice(-50000);
  } catch (err) {
    console.error("Error broadcasting log:", err);
    // Fallback: gửi message gốc
    io.emit("miner-log", msg);
    logBuffer += msg;
  }
}

function stopMiner() {
  return new Promise((resolve) => {
    if (currentMiner) {
      broadcastLog("\n⏹️ Stopping miner...\n");
      
      // Thêm timeout để force kill nếu không respond
      const killTimeout = setTimeout(() => {
        if (currentMiner && !currentMiner.killed) {
          broadcastLog("⚠️ Force killing miner...\n");
          currentMiner.kill('SIGKILL');
        }
        resolve();
      }, 5000);
      
      currentMiner.once("exit", () => {
        clearTimeout(killTimeout);
        currentMiner = null;
        broadcastLog("✅ Miner stopped\n");
        resolve();
      });
      
      currentMiner.kill('SIGTERM');
    } else {
      resolve();
    }
  });
}

function runMiner() {
  if (currentMiner) {
    broadcastLog("⚠️ Miner already running\n");
    return false;
  }
  
  try {
    broadcastLog("🚀 Starting miner...\n");
    
    currentMiner = spawn("node", [minerPath], {
      cwd: path.join(__dirname, "miner"),
      env: { ...process.env, NODE_ENV: "production" },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    currentMiner.stdout.on("data", (data) => {
      const msg = data.toString();
      broadcastLog(msg);
      process.stdout.write(msg);
    });

    currentMiner.stderr.on("data", (data) => {
      const msg = data.toString();
      broadcastLog(msg);
      process.stderr.write(msg);
    });

    currentMiner.on("error", (err) => {
      const msg = `❌ Miner process error: ${err.message}\n`;
      broadcastLog(msg);
      console.error(msg);
      currentMiner = null;
    });

    currentMiner.on("exit", (code, signal) => {
      const msg = `Miner exited with code ${code}, signal ${signal}\n`;
      broadcastLog(msg);
      console.log(msg);
      currentMiner = null;
      
      // Tự động restart nếu exit không phải do người dùng
      if (code !== 0 && code !== null) {
        broadcastLog("🔄 Auto-restarting miner in 5 seconds...\n");
        setTimeout(() => {
          if (!currentMiner) {
            runMiner();
          }
        }, 5000);
      }
    });
    
    return true;
  } catch (err) {
    broadcastLog(`❌ Failed to start miner: ${err.message}\n`);
    console.error(err);
    return false;
  }
}

// API endpoints
app.post("/stop", async (req, res) => {
  try {
    await stopMiner();
    res.json({ status: "stopped", success: true });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.post("/restart", async (req, res) => {
  try {
    await stopMiner();
    setTimeout(() => {
      runMiner();
    }, 1000);
    res.json({ status: "restarting", success: true });
  } catch (err) {
    res.status(500).json({ status: "error", message: err.message });
  }
});

app.get("/status", (req, res) => {
  res.json({ 
    running: currentMiner !== null,
    pid: currentMiner ? currentMiner.pid : null
  });
});

app.get("/logs", (req, res) => {
  const limit = parseInt(req.query.limit) || 10000;
  const logs = logBuffer.length > limit ? logBuffer.slice(-limit) : logBuffer;
  res.json({ logs, totalLength: logBuffer.length });
});

app.post("/clear-logs", (req, res) => {
  logBuffer = "";
  broadcastLog("📋 Log cleared\n");
  res.json({ status: "cleared", success: true });
});

// WebSocket events
io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);
  
  // Gửi logs hiện tại
  socket.emit("miner-log", logBuffer);
  socket.emit("miner-status", { 
    running: currentMiner !== null,
    pid: currentMiner ? currentMiner.pid : null
  });
  
  socket.on("disconnect", () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });
  
  socket.on("command", (cmd) => {
    console.log(`Received command: ${cmd}`);
    switch(cmd) {
      case "stop":
        stopMiner();
        break;
      case "restart":
        stopMiner().then(() => setTimeout(() => runMiner(), 1000));
        break;
      case "clear":
        logBuffer = "";
        broadcastLog("📋 Log cleared\n");
        break;
      default:
        socket.emit("error", `Unknown command: ${cmd}`);
    }
  });
});

// Kiểm tra testLib trước khi chạy miner
function runTest() {
  if (isTestRunning) return;
  isTestRunning = true;
  
  broadcastLog("🔍 Running testLib check...\n");
  
  const test = spawn("node", [testPath], { 
    cwd: path.join(__dirname, "miner"),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  let testOutput = "";
  
  test.stdout.on("data", (data) => {
    testOutput += data.toString();
    broadcastLog(data.toString());
  });
  
  test.stderr.on("data", (data) => {
    testOutput += data.toString();
    broadcastLog(data.toString());
  });
  
  test.on("exit", (code) => {
    isTestRunning = false;
    if (code === 0) {
      broadcastLog("✅ TestLib OK, starting miner...\n\n");
      runMiner();
    } else {
      broadcastLog(`❌ TestLib FAILED (code: ${code}). Miner will not start.\n`);
      broadcastLog("💡 Please check miner/testLib.js and dependencies\n");
      console.error("TestLib failed with code:", code);
      console.error("Output:", testOutput);
    }
  });
  
  test.on("error", (err) => {
    isTestRunning = false;
    broadcastLog(`❌ Failed to run test: ${err.message}\n`);
    console.error("Test error:", err);
  });
}

// Handle process termination
process.on("SIGINT", async () => {
  broadcastLog("\n🛑 Received SIGINT, shutting down...\n");
  await stopMiner();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  broadcastLog("\n🛑 Received SIGTERM, shutting down...\n");
  await stopMiner();
  process.exit(0);
});

// Error handling cho uncaught exceptions
process.on("uncaughtException", (err) => {
  broadcastLog(`💥 Uncaught Exception: ${err.message}\n`);
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  broadcastLog(`💥 Unhandled Rejection: ${reason}\n`);
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Khởi động server và chạy test
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Web UI running at http://localhost:${PORT}`);
  console.log(`📁 Miner path: ${minerPath}`);
  console.log(`🔧 Test path: ${testPath}`);
  
  // Đợi strip-ansi load xong rồi chạy test
  setTimeout(() => {
    runTest();
  }, 1000);
});

// Export cho testing
module.exports = { app, server, io, stopMiner, runMiner };
