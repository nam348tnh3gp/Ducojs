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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const minerPath = path.join(__dirname, "miner", "index.js");
const testPath = path.join(__dirname, "miner", "testLib.js");
let logBuffer = "";

function broadcastLog(msg) {
  const clean = stripAnsi(msg);
  io.emit("miner-log", clean);
  logBuffer += clean;
  if (logBuffer.length > 10000) logBuffer = logBuffer.slice(-10000);
}

io.on("connection", (socket) => {
  socket.emit("miner-log", logBuffer);
});

function runMiner() {
  const miner = spawn("node", [minerPath]);

  miner.stdout.on("data", (data) => {
    const msg = data.toString();
    broadcastLog(msg);
    process.stdout.write(msg);
  });

  miner.stderr.on("data", (data) => {
    const msg = data.toString();
    broadcastLog(msg);
    process.stderr.write(msg);
  });

  miner.on("exit", (code) => {
    const msg = `Miner exited with code ${code}\n`;
    broadcastLog(msg);
    console.log(msg);
  });
}

const test = spawn("node", [testPath], { cwd: __dirname, stdio: "inherit" });

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
