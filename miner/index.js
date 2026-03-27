const { PromiseSocket } = require("promise-socket");
const cluster = require("cluster");
const net = require("net");
const RL = require("readline");
const utils = require("./src/utils.js");
const fs = require('fs');
const ini = require('ini');
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "config.ini");

let user = "",
    processes = 0,
    hashlib = "",
    mining_key = "",
    difficulty = "LOW",
    config = {};

const loadConfig = async () => {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(CONFIG_FILE)) {
            fs.readFile(CONFIG_FILE, 'utf-8', (err, data) => {
                if (err) throw err;
                config = ini.parse(data);
                resolve(config);
            });
        } else {
            console.log("Config file not found, creating default...");
            let configData = {
                "username": "Tudz1011",
                "mining_key": "101120",
                "hashlib": "js-sha1",
                "threads": 2,
                "difficulty": "LOW"
            };
            config = configData;
            fs.writeFile(CONFIG_FILE, ini.stringify(configData), (err) => {
                if (err) throw err;
                resolve(config);
            });
        }
    });
};

const printData = (threads) => {
    RL.cursorTo(process.stdout, 0, 0);
    RL.clearLine(process.stdout, 0);
    RL.clearScreenDown(process.stdout);

    let rows = [];
    for (const i in threads) {
        rows.push({
            Hashrate: utils.calculateHashrate(threads[i].hashes),
            Accepted: threads[i].accepted,
            Rejected: threads[i].rejected
        });
    }

    let hr = 0, acc = 0, rej = 0;
    for (const i in threads) {
        hr = hr + threads[i].hashes;
        acc = acc + threads[i].accepted;
        rej = rej + threads[i].rejected;
    }

    rows["Total"] = {
        Hashrate: utils.calculateHashrate(hr),
        Accepted: acc,
        Rejected: rej
    };

    console.table(rows);
    rows = [];
};

const findNumber = async (prev, toFind, diff, data, socket, startTime) => {
    for (let i = 0; i < 100 * diff + 1; i++) {
        let hash = utils._sha1(hashlib, (prev + i));
        data.hashes = data.hashes + 1;

        if (hash == toFind) {
            const elapsed = (Date.now() - startTime) / 1000;
            const hashrate = elapsed > 0 ? data.hashes / elapsed : 0;
            socket.write(`${i},${hashrate.toFixed(2)},NodeJS-Miner,${user},${data.workerId}`);
            return true;
        }
    }
    return false;
};

const startMining = async (socket, data, reconnectCallback) => {
    let promiseSocket = new PromiseSocket(socket);
    promiseSocket.setTimeout(15000);
    let startTime = Date.now();
    let isRunning = true;

    while (isRunning) {
        try {
            // Gửi JOB request với difficulty từ config
            socket.write("JOB," + user + "," + difficulty + "," + mining_key);
            
            // Đợi job với timeout
            const jobData = await Promise.race([
                promiseSocket.read(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Job timeout")), 10000))
            ]);
            
            if (!jobData) {
                console.log(`[${data.workerId}] No job received, reconnecting...`);
                break;
            }
            
            let job = jobData.split(",");
            if (job.length < 3) {
                console.log(`[${data.workerId}] Invalid job received: ${job}`);
                continue;
            }

            const prev = job[0];
            const toFind = job[1];
            const diff = parseInt(job[2]);

            startTime = Date.now();
            const found = await findNumber(prev, toFind, diff, data, socket, startTime);
            
            if (!found) {
                console.log(`[${data.workerId}] No nonce found for this job`);
                continue;
            }

            // Đợi phản hồi từ pool với timeout
            const response = await Promise.race([
                promiseSocket.read(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Response timeout")), 5000))
            ]);
            
            if (!response) {
                console.log(`[${data.workerId}] No response from pool`);
                break;
            }

            if (response.includes("GOOD")) {
                data.accepted = data.accepted + 1;
                console.log(`[${data.workerId}] ✅ Share accepted! Total: ${data.accepted}`);
            } else if (response.includes("BLOCK")) {
                console.log(`[${data.workerId}] ⛓️ New block found!`);
                data.accepted = data.accepted + 1;
            } else if (response.includes("BAD")) {
                data.rejected = data.rejected + 1;
                console.log(`[${data.workerId}] ❌ Share rejected: ${response}`);
            } else {
                console.log(`[${data.workerId}] ℹ️ Pool response: ${response}`);
            }

            // Gửi dữ liệu về master process để cập nhật stats
            process.send(data);
            data.hashes = 0;
            
        } catch (err) {
            console.log(`[${data.workerId}] ⚠️ Mining error: ${err.message}`);
            break;
        }
    }
    
    // Đóng socket và gọi reconnect
    try {
        socket.end();
    } catch(e) {}
    
    if (reconnectCallback) {
        setTimeout(() => reconnectCallback(), 3000);
    }
};

// ==================== WORKER CONNECTION HANDLER ====================
const startWorker = () => {
    let workerData = {
        workerId: cluster.worker.id - 1,
        hashes: 0,
        rejected: 0,
        accepted: 0
    };
    
    let currentSocket = null;
    let reconnectTimer = null;
    let isConnecting = false;
    
    const connectToPool = () => {
        if (isConnecting) return;
        isConnecting = true;
        
        if (reconnectTimer) clearTimeout(reconnectTimer);
        
        utils.getPool().then((poolData) => {
            console.log(`[${workerData.workerId}] 🌐 Connecting to pool: ${poolData.name} (${poolData.ip}:${poolData.port})`);
            
            const socket = new net.Socket();
            currentSocket = socket;
            socket.setEncoding("utf8");
            socket.setTimeout(30000);
            
            socket.once("connect", () => {
                console.log(`[${workerData.workerId}] ✅ Connected to pool`);
            });
            
            socket.once("data", (data) => {
                console.log(`[${workerData.workerId}] 📡 Pool MOTD: ${data.trim()}`);
                startMining(socket, workerData, () => {
                    // Reconnect callback
                    if (!isConnecting) {
                        console.log(`[${workerData.workerId}] 🔄 Reconnecting...`);
                        connectToPool();
                    }
                });
                isConnecting = false;
            });
            
            socket.on("end", () => {
                console.log(`[${workerData.workerId}] 🔌 Connection ended by pool`);
                if (!isConnecting) {
                    reconnectTimer = setTimeout(() => connectToPool(), 5000);
                }
                isConnecting = false;
            });
            
            socket.on("error", (err) => {
                console.log(`[${workerData.workerId}] ⚠️ Socket error: ${err.message}`);
                if (!isConnecting) {
                    reconnectTimer = setTimeout(() => connectToPool(), 5000);
                }
                isConnecting = false;
            });
            
            socket.connect(poolData.port, poolData.ip);
            
        }).catch((err) => {
            console.log(`[${workerData.workerId}] ❌ Failed to get pool: ${err}`);
            reconnectTimer = setTimeout(() => {
                isConnecting = false;
                connectToPool();
            }, 10000);
        });
    };
    
    // Load config trước khi kết nối
    loadConfig().then((cfg) => {
        user = cfg.username;
        processes = parseInt(cfg.threads) || 1;
        hashlib = cfg.hashlib || "js-sha1";
        mining_key = cfg.mining_key || "";
        difficulty = cfg.difficulty || "LOW";
        
        console.log(`[${workerData.workerId}] Config loaded: ${user}, diff=${difficulty}`);
        connectToPool();
    }).catch((err) => {
        console.log(`[${workerData.workerId}] ❌ Failed to load config: ${err}`);
        setTimeout(() => startWorker(), 5000);
    });
};

// ==================== MAIN ====================
if (cluster.isMaster) {
    let threads = [];

    loadConfig().then((cfg) => {
        user = cfg.username;
        processes = parseInt(cfg.threads) || 1;
        hashlib = cfg.hashlib || "js-sha1";
        mining_key = cfg.mining_key || "";
        difficulty = cfg.difficulty || "LOW";

        if (!mining_key || mining_key === "") {
            console.error("❌ Mining key is required! Check config.ini");
            process.exit(1);
        }

        console.log("🚀 Miner Started");
        console.log(`   👤 Username: ${user}`);
        console.log(`   🔑 Mining Key: ${mining_key.substring(0, 3)}***`);
        console.log(`   🧵 Threads: ${processes}`);
        console.log(`   📊 Difficulty: ${difficulty}`);
        console.log(`   📦 Hashlib: ${hashlib}\n`);

        for (let i = 0; i < processes; i++) {
            let worker = cluster.fork();
            console.log(`✅ Worker ${i} (pid-${worker.process.pid}) started`);

            let data = {
                workerId: i,
                hashes: 0,
                rejected: 0,
                accepted: 0
            };
            threads.push(data);

            worker.on("message", (msg) => {
                if (threads[msg.workerId]) {
                    threads[msg.workerId].hashes = msg.hashes;
                    threads[msg.workerId].rejected = msg.rejected;
                    threads[msg.workerId].accepted = msg.accepted;
                }
                printData(threads);
            });
            
            worker.on("exit", (code) => {
                console.log(`⚠️ Worker ${i} exited with code ${code}, restarting...`);
                setTimeout(() => {
                    let newWorker = cluster.fork();
                    console.log(`✅ Worker ${i} (pid-${newWorker.process.pid}) restarted`);
                    let newData = {
                        workerId: i,
                        hashes: 0,
                        rejected: 0,
                        accepted: 0
                    };
                    threads[i] = newData;
                    
                    newWorker.on("message", (msg) => {
                        if (threads[msg.workerId]) {
                            threads[msg.workerId].hashes = msg.hashes;
                            threads[msg.workerId].rejected = msg.rejected;
                            threads[msg.workerId].accepted = msg.accepted;
                        }
                        printData(threads);
                    });
                }, 3000);
            });
        }
    });
} else {
    // Worker process
    startWorker();
}
