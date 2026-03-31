const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const socketIO = require("socket.io");
const stripAnsi = require("strip-ansi").default;

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

function broadcastLog(msg) {
  const clean = stripAnsi(msg);
  io.emit("miner-log", clean);
  logBuffer += clean;
  if (logBuffer.length > 10000) logBuffer = logBuffer.slice(-10000);
}

function stopMiner() {
  if (currentMiner) {
    broadcastLog("\n⏹️ Stopping miner...\n");
    currentMiner.kill();
    currentMiner = null;
  }
}

function runMiner() {
  if (currentMiner) {
    broadcastLog("⚠️ Miner already running\n");
    return;
  }
  
  currentMiner = spawn("node", [minerPath], {
    cwd: path.join(__dirname, "miner")
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

  currentMiner.on("exit", (code) => {
    const msg = `Miner exited with code ${code}\n`;
    broadcastLog(msg);
    console.log(msg);
    currentMiner = null;
  });
}

// API endpoints
app.post("/stop", (req, res) => {
  stopMiner();
  res.json({ status: "stopped" });
});

app.post("/restart", (req, res) => {
  stopMiner();
  setTimeout(() => {
    runMiner();
  }, 1000);
  res.json({ status: "restarting" });
});

app.get("/status", (req, res) => {
  res.json({ running: currentMiner !== null });
});

app.get("/logs", (req, res) => {
  res.json({ logs: logBuffer });
});

app.post("/clear-logs", (req, res) => {
  logBuffer = "";
  broadcastLog("📋 Log cleared\n");
  res.json({ status: "cleared" });
});

io.on("connection", (socket) => {
  socket.emit("miner-log", logBuffer);
  socket.emit("miner-status", { running: currentMiner !== null });
});

// Run test before starting miner
const test = spawn("node", [testPath], { 
  cwd: path.join(__dirname, "miner"),
  stdio: "inherit" 
});

test.on("exit", (code) => {
  if (code === 0) {
    console.log("✅ TestLib OK, khởi chạy miner...");
    runMiner();
  } else {
    console.error("❌ TestLib FAILED. Không khởi chạy miner.");
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Web UI đang chạy tại http://localhost:${PORT}`);
});
