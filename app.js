const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const socketIO = require("socket.io");
const fs = require("fs");

// Sử dụng strip-ansi phiên bản cũ hỗ trợ CommonJS
let stripAnsi;
try {
    // Thử require trước (cho phiên bản cũ)
    stripAnsi = require("strip-ansi");
} catch (err) {
    console.warn("⚠️ strip-ansi not available, using fallback");
    // Fallback function nếu không có strip-ansi
    stripAnsi = (str) => {
        if (!str) return "";
        return str.replace(/\x1b\[[0-9;]*m/g, '');
    };
}

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

const minerPath = path.join(__dirname, "miner", "index.js");
const testPath = path.join(__dirname, "miner", "testLib.js");
const configPath = path.join(__dirname, "miner", "config.ini");

let logBuffer = [];
let currentMiner = null;
let isTestRunning = false;
let clients = new Map();

// Giới hạn số lượng log
const MAX_LOG_SIZE = 1000; // Số dòng log tối đa

function broadcastLog(msg) {
    try {
        const clean = stripAnsi ? stripAnsi(msg) : msg;
        const timestamp = new Date().toLocaleTimeString();
        const logEntry = `[${timestamp}] ${clean}`;
        
        // Thêm vào buffer
        logBuffer.push(logEntry);
        
        // Giới hạn buffer
        while (logBuffer.length > MAX_LOG_SIZE) {
            logBuffer.shift();
        }
        
        // Broadcast cho tất cả clients
        io.emit("miner-log", logEntry);
        
        // In ra console
        process.stdout.write(clean);
    } catch (err) {
        console.error("Error broadcasting log:", err);
        io.emit("miner-log", msg);
        logBuffer.push(msg);
    }
}

function stopMiner() {
    return new Promise((resolve) => {
        if (currentMiner) {
            broadcastLog("⏹️ Stopping miner...\n");
            
            const killTimeout = setTimeout(() => {
                if (currentMiner && !currentMiner.killed) {
                    broadcastLog("⚠️ Force killing miner...\n");
                    currentMiner.kill('SIGKILL');
                }
                currentMiner = null;
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
    
    // Kiểm tra config file
    if (!fs.existsSync(configPath)) {
        broadcastLog("❌ config.ini not found in miner folder!\n");
        broadcastLog("💡 Please create config.ini with your username and mining key\n");
        return false;
    }
    
    try {
        broadcastLog("🚀 Starting miner...\n");
        
        currentMiner = spawn("node", [minerPath], {
            cwd: path.join(__dirname, "miner"),
            env: { 
                ...process.env, 
                NODE_ENV: "production",
                FORCE_COLOR: "0" // Tắt màu sắc để log cleaner
            },
            stdio: ['pipe', 'pipe', 'pipe']
        });

        currentMiner.stdout.on("data", (data) => {
            const msg = data.toString();
            broadcastLog(msg);
        });

        currentMiner.stderr.on("data", (data) => {
            const msg = data.toString();
            broadcastLog(msg);
        });

        currentMiner.on("error", (err) => {
            const msg = `❌ Miner process error: ${err.message}\n`;
            broadcastLog(msg);
            console.error(msg);
            currentMiner = null;
        });

        currentMiner.on("exit", (code, signal) => {
            let msg = `Miner exited with code ${code}`;
            if (signal) msg += `, signal ${signal}`;
            msg += "\n";
            broadcastLog(msg);
            console.log(msg);
            currentMiner = null;
            
            // Tự động restart nếu exit không phải do người dùng và có lỗi
            if (code !== 0 && code !== null && code !== 130 && code !== 143) {
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
app.post("/api/stop", async (req, res) => {
    try {
        await stopMiner();
        res.json({ status: "stopped", success: true });
    } catch (err) {
        res.status(500).json({ status: "error", message: err.message });
    }
});

app.post("/api/restart", async (req, res) => {
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

app.get("/api/status", (req, res) => {
    res.json({ 
        running: currentMiner !== null,
        pid: currentMiner ? currentMiner.pid : null,
        testRunning: isTestRunning
    });
});

app.get("/api/logs", (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const logs = logBuffer.slice(-limit);
    res.json({ 
        logs, 
        totalLines: logBuffer.length,
        maxLines: MAX_LOG_SIZE
    });
});

app.post("/api/clear-logs", (req, res) => {
    logBuffer = [];
    broadcastLog("📋 Log cleared\n");
    res.json({ status: "cleared", success: true });
});

app.get("/api/config", (req, res) => {
    try {
        if (fs.existsSync(configPath)) {
            const config = fs.readFileSync(configPath, 'utf-8');
            res.json({ exists: true, content: config });
        } else {
            res.json({ exists: false });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/config", express.text(), (req, res) => {
    try {
        fs.writeFileSync(configPath, req.body, 'utf-8');
        res.json({ success: true, message: "Config saved" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// WebSocket events
io.on("connection", (socket) => {
    const clientId = socket.id;
    clients.set(clientId, socket);
    console.log(`🔌 Client connected: ${clientId} (Total: ${clients.size})`);
    
    // Gửi logs hiện tại
    const recentLogs = logBuffer.slice(-100);
    socket.emit("miner-logs-bulk", recentLogs);
    socket.emit("miner-status", { 
        running: currentMiner !== null,
        pid: currentMiner ? currentMiner.pid : null,
        testRunning: isTestRunning
    });
    
    socket.on("disconnect", () => {
        clients.delete(clientId);
        console.log(`🔌 Client disconnected: ${clientId} (Total: ${clients.size})`);
    });
    
    socket.on("command", async (cmd) => {
        console.log(`Command from ${clientId}: ${cmd}`);
        switch(cmd) {
            case "stop":
                await stopMiner();
                break;
            case "restart":
                await stopMiner();
                setTimeout(() => runMiner(), 1000);
                break;
            case "clear":
                logBuffer = [];
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
        cwd: path.join(__dirname, "miner")
    });
    
    let testOutput = "";
    let hasError = false;
    
    test.stdout.on("data", (data) => {
        const msg = data.toString();
        testOutput += msg;
        broadcastLog(msg);
    });
    
    test.stderr.on("data", (data) => {
        const msg = data.toString();
        testOutput += msg;
        broadcastLog(msg);
        if (msg.includes("Error") || msg.includes("error")) {
            hasError = true;
        }
    });
    
    test.on("exit", (code) => {
        isTestRunning = false;
        
        if (code === 0 && !hasError) {
            broadcastLog("✅ TestLib OK, starting miner...\n\n");
            // Delay để test output hiển thị đầy đủ
            setTimeout(() => {
                runMiner();
            }, 1000);
        } else {
            broadcastLog(`❌ TestLib FAILED (code: ${code}). Miner will not start.\n`);
            broadcastLog("💡 Please check:\n");
            broadcastLog("   1. miner/testLib.js exists\n");
            broadcastLog("   2. All dependencies installed\n");
            broadcastLog("   3. Run 'npm install' in miner folder\n");
            broadcastLog("   4. Check error messages above\n");
            console.error("TestLib failed with code:", code);
            if (testOutput) {
                console.error("Test output:", testOutput);
            }
        }
    });
    
    test.on("error", (err) => {
        isTestRunning = false;
        broadcastLog(`❌ Failed to run test: ${err.message}\n`);
        broadcastLog("💡 Make sure Node.js is installed correctly\n");
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

// Error handling
process.on("uncaughtException", (err) => {
    broadcastLog(`💥 Uncaught Exception: ${err.message}\n`);
    console.error("Uncaught Exception:", err);
    console.error(err.stack);
});

process.on("unhandledRejection", (reason, promise) => {
    broadcastLog(`💥 Unhandled Rejection: ${reason}\n`);
    console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Khởi động server
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`\n✅ ========== DUCO MINER WEB UI ==========`);
    console.log(`   🌐 Local: http://localhost:${PORT}`);
    console.log(`   🌍 Network: http://${getLocalIP()}:${PORT}`);
    console.log(`   📁 Miner path: ${minerPath}`);
    console.log(`   🔧 Test path: ${testPath}`);
    console.log(`   ⚙️  Config path: ${configPath}`);
    console.log(`   💡 To build FastHash manually: npm run build-fast`);
    console.log(`   🚀 Starting test and miner...\n`);
    
    // Chạy test sau khi server đã sẵn sàng
    setTimeout(() => {
        runTest();
    }, 1000);
});

// Helper function để lấy IP
function getLocalIP() {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

module.exports = { app, server, io, stopMiner, runMiner };
