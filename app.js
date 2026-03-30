const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const socketIO = require("socket.io");
const stripAnsi = require("strip-ansi").default;
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// Middleware
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Routes
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Đường dẫn - SỬA: libducohasher (không phải libducohash)
const minerDir = path.join(__dirname, "miner");
const minerPath = path.join(minerDir, "index.js");
const testPath = path.join(minerDir, "testLib.js");
const libPath = path.join(__dirname, "libducohasher");

// Kiểm tra file tồn tại
if (!fs.existsSync(minerPath)) {
  console.error(`❌ Không tìm thấy miner tại: ${minerPath}`);
  process.exit(1);
}

if (!fs.existsSync(testPath)) {
  console.error(`❌ Không tìm thấy testLib tại: ${testPath}`);
  process.exit(1);
}

let logBuffer = "";
let currentMiner = null;

function broadcastLog(msg) {
  const clean = stripAnsi(msg);
  io.emit("miner-log", clean);
  logBuffer += clean;
  if (logBuffer.length > 50000) {
    logBuffer = logBuffer.slice(-50000);
  }
}

function stopMiner() {
  return new Promise((resolve) => {
    if (currentMiner && !currentMiner.killed) {
      broadcastLog("\n⏹️ Stopping miner...\n");
      currentMiner.on("exit", () => {
        currentMiner = null;
        resolve();
      });
      currentMiner.kill("SIGTERM");
      
      setTimeout(() => {
        if (currentMiner && !currentMiner.killed) {
          currentMiner.kill("SIGKILL");
        }
      }, 3000);
    } else {
      resolve();
    }
  });
}

function runMiner() {
  if (currentMiner && !currentMiner.killed) {
    broadcastLog("⚠️ Miner already running\n");
    return false;
  }
  
  broadcastLog("🚀 Starting miner...\n");
  
  // Set NODE_PATH để Node có thể tìm module trong thư mục libducohasher
  const env = { ...process.env };
  env.NODE_PATH = libPath;
  
  // Kiểm tra FastHash đã được build chưa
  const fastHashBuilt = fs.existsSync(path.join(libPath, "native", "index.node")) || 
                        fs.existsSync(path.join(libPath, "build", "Release", "ducohasher.node"));
  
  env.ENABLE_FASTHASH = fastHashBuilt ? "1" : "0";
  
  broadcastLog(fastHashBuilt ? "✅ FastHash accelerator available\n" : "⚠️ Using pure JS (slower)\n");
  
  // Chạy miner với environment variables
  currentMiner = spawn("node", [minerPath], {
    cwd: minerDir,
    env: env
  });

  currentMiner.stdout.on("data", (data) => {
    const msg = data.toString();
    broadcastLog(msg);
    console.log("[MINER]", msg.trim());
  });

  currentMiner.stderr.on("data", (data) => {
    const msg = data.toString();
    broadcastLog(msg);
    console.error("[MINER ERROR]", msg.trim());
  });

  currentMiner.on("error", (err) => {
    const msg = `Miner process error: ${err.message}\n`;
    broadcastLog(msg);
    console.error(msg);
    currentMiner = null;
  });

  currentMiner.on("exit", (code, signal) => {
    const msg = `Miner exited with code ${code}, signal ${signal}\n`;
    broadcastLog(msg);
    console.log(msg);
    currentMiner = null;
  });
  
  return true;
}

// API endpoints
app.post("/stop", async (req, res) => {
  await stopMiner();
  res.json({ status: "stopped", running: false });
});

app.post("/restart", async (req, res) => {
  await stopMiner();
  setTimeout(() => {
    runMiner();
  }, 1000);
  res.json({ status: "restarting" });
});

app.get("/status", (req, res) => {
  res.json({ 
    running: currentMiner !== null && !currentMiner.killed,
    pid: currentMiner ? currentMiner.pid : null
  });
});

app.get("/logs", (req, res) => {
  res.json({ logs: logBuffer });
});

app.post("/clear-logs", (req, res) => {
  logBuffer = "";
  broadcastLog("📋 Log cleared\n");
  res.json({ status: "cleared" });
});

// Socket.IO
io.on("connection", (socket) => {
  console.log("Client connected");
  socket.emit("miner-log", logBuffer);
  socket.emit("miner-status", { 
    running: currentMiner !== null && !currentMiner.killed 
  });
  
  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// Kiểm tra libducohasher
function checkLib() {
  if (!fs.existsSync(libPath)) {
    console.log("⚠️ libducohasher not found at:", libPath);
    return false;
  }
  
  const packageJson = path.join(libPath, "package.json");
  if (!fs.existsSync(packageJson)) {
    console.log("⚠️ libducohasher package.json not found");
    return false;
  }
  
  // Kiểm tra native module
  const nativePaths = [
    path.join(libPath, "native", "index.node"),
    path.join(libPath, "build", "Release", "ducohasher.node"),
    path.join(libPath, "index.node")
  ];
  
  const hasNative = nativePaths.some(p => fs.existsSync(p));
  
  if (hasNative) {
    console.log("✅ FastHash native module found");
  } else {
    console.log("⚠️ FastHash native module not found, using pure JS");
  }
  
  return true;
}

// Khởi động miner
function startMinerProcess() {
  console.log("🔍 Kiểm tra testLib...");
  
  // Set environment cho test
  const testEnv = { ...process.env };
  testEnv.NODE_PATH = libPath;
  
  const test = spawn("node", [testPath], { 
    cwd: minerDir,
    env: testEnv,
    stdio: "inherit" 
  });
  
  test.on("exit", (code) => {
    if (code === 0) {
      console.log("✅ TestLib OK, khởi chạy miner...");
      runMiner();
    } else {
      console.error(`❌ TestLib FAILED with code ${code}. Không khởi chạy miner.`);
      broadcastLog(`❌ TestLib failed with code ${code}\n`);
      // Vẫn thử chạy miner nếu testLib fail
      setTimeout(() => {
        console.log("⚠️ Attempting to start miner anyway...");
        runMiner();
      }, 2000);
    }
  });
  
  test.on("error", (err) => {
    console.error(`❌ Cannot run testLib: ${err.message}`);
    broadcastLog(`❌ Cannot run testLib: ${err.message}\n`);
    // Vẫn chạy miner nếu testLib lỗi
    console.log("⚠️ Starting miner anyway...");
    runMiner();
  });
}

// Xử lý khi tắt server
process.on("SIGINT", async () => {
  console.log("\n🛑 Shutting down...");
  await stopMiner();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n🛑 Shutting down...");
  await stopMiner();
  process.exit(0);
});

// Khởi động server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Web UI running at http://localhost:${PORT}`);
  
  // Kiểm tra lib
  checkLib();
  
  // Khởi động miner
  startMinerProcess();
});
