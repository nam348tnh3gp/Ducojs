const { PromiseSocket } = require("promise-socket");
const cluster = require("cluster");
const net = require("net");
const RL = require("readline");
const utils = require("./src/utils.js");
const fs = require('fs');
const ini = require('ini');
const path = require("path");

// config.ini nằm trong cùng thư mục với file này (miner/)
const CONFIG_FILE = path.join(__dirname, "config.ini");

let user = "",
    processes = 0,
    hashlib = "",
    mining_key = "",
    difficulty = "LOW",
    rig_identifier = "NodeRig",  // Thêm tên rig mặc định
    config = {};

const loadConfig = async () => {
    return new Promise((resolve, reject) => {
        if (fs.existsSync(CONFIG_FILE)) {
            fs.readFile(CONFIG_FILE, 'utf-8', (err, data) => {
                if (err) {
                    console.error(`❌ Error reading config file: ${err.message}`);
                    reject(err);
                    return;
                }
                try {
                    config = ini.parse(data);
                    console.log(`✅ Config loaded from: ${CONFIG_FILE}`);
                    resolve(config);
                } catch (parseErr) {
                    console.error(`❌ Error parsing config: ${parseErr.message}`);
                    reject(parseErr);
                }
            });
        } else {
            console.log(`⚠️ Config file not found at ${CONFIG_FILE}, creating default...`);
            let configData = {
                "username": "Tudz1011",
                "mining_key": "101120",
                "hashlib": "js-sha1",
                "threads": 2,
                "difficulty": "LOW",
                "rig_identifier": "NodeRig"  // Thêm rig_identifier vào config mặc định
            };
            config = configData;
            fs.writeFile(CONFIG_FILE, ini.stringify(configData), (err) => {
                if (err) {
                    console.error(`❌ Error creating config file: ${err.message}`);
                    reject(err);
                } else {
                    console.log(`✅ Default config created at ${CONFIG_FILE}`);
                    resolve(config);
                }
            });
        }
    });
};

const printData = (threads) => {
    // Clear console for better display
    console.clear();

    let rows = [];
    let hr = 0, acc = 0, rej = 0;

    for (let i = 0; i < threads.length; i++) {
        if (threads[i]) {
            hr += threads[i].hashes || 0;
            acc += threads[i].accepted || 0;
            rej += threads[i].rejected || 0;

            rows.push({
                Worker: i,
                Hashrate: utils.calculateHashrate(threads[i].hashes || 0),
                Accepted: threads[i].accepted || 0,
                Rejected: threads[i].rejected || 0
            });
        }
    }

    rows.push({
        Worker: "TOTAL",
        Hashrate: utils.calculateHashrate(hr),
        Accepted: acc,
        Rejected: rej
    });

    console.table(rows);

    // Hiển thị thêm thông tin
    console.log(`\n📊 Total Stats:`);
    console.log(`   🔥 Total Hashrate: ${utils.calculateHashrate(hr)}`);
    console.log(`   ✅ Total Accepted: ${acc}`);
    console.log(`   ❌ Total Rejected: ${rej}`);
    console.log(`   📈 Success Rate: ${acc + rej > 0 ? ((acc / (acc + rej)) * 100).toFixed(2) : 0}%`);
};

// ================= MINING LOOP =================
const startMining = async (socket, data, reconnectCallback) => {
    let promiseSocket = new PromiseSocket(socket);
    promiseSocket.setTimeout(15000);
    let isRunning = true;
    let intensity = 95;
    let consecutiveErrors = 0;

    while (isRunning) {
        try {
            // Gửi yêu cầu job - format: JOB,username,difficulty,mining_key,
            // (dấu phẩy cuối cùng cho trường raspi_iot_reading trống)
            socket.write("JOB," + user + "," + difficulty + "," + mining_key + ",\n");

            const jobData = await Promise.race([
                promiseSocket.read(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Job timeout")), 10000))
            ]);

            if (!jobData) {
                console.log(`[${data.workerId}] No job received, reconnecting...`);
                break;
            }

            let job = jobData.toString().split(",");
            if (job.length < 3) {
                console.log(`[${data.workerId}] Invalid job received: ${job}`);
                continue;
            }

            const prev = job[0];
            const toFind = job[1];
            const diff = parseInt(job[2]);
            const startTime = Date.now();

            const result = await utils.mineJob(prev, toFind, diff, intensity, hashlib, null);

            data.hashes += result.hashes;

            if (result.nonce > 0) {
                const elapsed = (Date.now() - startTime) / 1000;
                const hashrate = elapsed > 0 ? data.hashes / elapsed : 0;
                
                // ========== SỬA LỖI: Đúng format result ==========
                // Format: nonce,hashrate,miner_name,rig_identifier,,thread_id
                // (2 dấu phẩy liên tiếp trước thread_id)
                socket.write(`${result.nonce},${hashrate.toFixed(2)},NodeJS-Miner,${rig_identifier},,${data.workerId}\n`);
            } else {
                console.log(`[${data.workerId}] No nonce found for this job`);
                continue;
            }

            const response = await Promise.race([
                promiseSocket.read(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("Response timeout")), 5000))
            ]);

            if (!response) {
                console.log(`[${data.workerId}] No response from pool`);
                break;
            }

            const responseStr = response.toString();
            if (responseStr.includes("GOOD")) {
                data.accepted++;
                consecutiveErrors = 0;
                console.log(`[${data.workerId}] ✅ Share accepted! Total: ${data.accepted}`);
            } else if (responseStr.includes("BLOCK")) {
                console.log(`[${data.workerId}] ⛓️ New block found!`);
                data.accepted++;
                consecutiveErrors = 0;
            } else if (responseStr.includes("BAD")) {
                data.rejected++;
                consecutiveErrors++;
                console.log(`[${data.workerId}] ❌ Share rejected: ${responseStr}`);
            } else {
                console.log(`[${data.workerId}] ℹ️ Pool response: ${responseStr}`);
            }

            // Gửi dữ liệu về master process
            if (process.send) {
                process.send({
                    workerId: data.workerId,
                    hashes: data.hashes,
                    rejected: data.rejected,
                    accepted: data.accepted
                });
            }

            data.hashes = 0;

            // Nếu có quá nhiều lỗi liên tiếp, giảm intensity
            if (consecutiveErrors > 5) {
                intensity = Math.max(50, intensity - 5);
                console.log(`[${data.workerId}] Reduced intensity to ${intensity}% due to errors`);
                consecutiveErrors = 0;
            }

        } catch (err) {
            console.log(`[${data.workerId}] ⚠️ Mining error: ${err.message}`);
            consecutiveErrors++;

            if (consecutiveErrors > 3) {
                console.log(`[${data.workerId}] Too many errors, reconnecting...`);
                break;
            }
        }
    }

    try {
        if (socket && !socket.destroyed) {
            socket.end();
        }
    } catch(e) {}

    if (reconnectCallback) {
        setTimeout(() => reconnectCallback(), 3000);
    }
};

// ================= WORKER CONNECTION HANDLER =================
const startWorker = () => {
    let workerData = {
        workerId: cluster.worker ? cluster.worker.id - 1 : 0,
        hashes: 0,
        rejected: 0,
        accepted: 0
    };

    let currentSocket = null;
    let reconnectTimer = null;
    let isConnecting = false;
    let reconnectAttempts = 0;

    const connectToPool = () => {
        if (isConnecting) return;
        isConnecting = true;

        if (reconnectTimer) clearTimeout(reconnectTimer);

        // Thông báo trạng thái FastHash
        if (utils.hasFastHash) {
            console.log(`[${workerData.workerId}] 🚀 FastHash (Rust) is ACTIVE - mining accelerated!`);
        } else {
            console.log(`[${workerData.workerId}] 📦 FastHash NOT available - using pure JS (slower)`);
            console.log(`[${workerData.workerId}] 💡 To enable FastHash, run: npm run build-fast`);
        }

        utils.getPool().then((poolData) => {
            console.log(`[${workerData.workerId}] 🌐 Connecting to pool: ${poolData.name} (${poolData.ip}:${poolData.port})`);

            const socket = new net.Socket();
            currentSocket = socket;
            socket.setEncoding("utf8");
            socket.setTimeout(30000);

            socket.once("connect", () => {
                console.log(`[${workerData.workerId}] ✅ Connected to pool`);
                reconnectAttempts = 0;
            });

            socket.once("data", (data) => {
                console.log(`[${workerData.workerId}] 📡 Pool MOTD: ${data.trim()}`);
                startMining(socket, workerData, () => {
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
                    const delay = Math.min(30000, 5000 * Math.pow(2, reconnectAttempts));
                    reconnectTimer = setTimeout(() => connectToPool(), delay);
                    reconnectAttempts++;
                }
                isConnecting = false;
            });

            socket.on("error", (err) => {
                console.log(`[${workerData.workerId}] ⚠️ Socket error: ${err.message}`);
                if (!isConnecting) {
                    const delay = Math.min(30000, 5000 * Math.pow(2, reconnectAttempts));
                    reconnectTimer = setTimeout(() => connectToPool(), delay);
                    reconnectAttempts++;
                }
                isConnecting = false;
            });

            socket.connect(poolData.port, poolData.ip);

        }).catch((err) => {
            console.log(`[${workerData.workerId}] ❌ Failed to get pool: ${err}`);
            const delay = Math.min(30000, 10000 * Math.pow(2, reconnectAttempts));
            reconnectTimer = setTimeout(() => {
                isConnecting = false;
                connectToPool();
            }, delay);
            reconnectAttempts++;
        });
    };

    loadConfig().then((cfg) => {
        user = cfg.username;
        processes = parseInt(cfg.threads) || 1;
        hashlib = cfg.hashlib || "js-sha1";
        mining_key = cfg.mining_key || "";
        difficulty = cfg.difficulty || "LOW";
        rig_identifier = cfg.rig_identifier || "NodeRig";  // Đọc rig_identifier từ config

        console.log(`[${workerData.workerId}] Config loaded: ${user}, diff=${difficulty}, hashlib=${hashlib}, rig=${rig_identifier}`);
        connectToPool();
    }).catch((err) => {
        console.log(`[${workerData.workerId}] ❌ Failed to load config: ${err.message}`);
        setTimeout(() => startWorker(), 5000);
    });
};

// ================= MASTER PROCESS =================
if (cluster.isMaster) {
    let threads = [];

    loadConfig().then((cfg) => {
        user = cfg.username;
        processes = parseInt(cfg.threads) || 1;
        hashlib = cfg.hashlib || "js-sha1";
        mining_key = cfg.mining_key || "";
        difficulty = cfg.difficulty || "LOW";
        rig_identifier = cfg.rig_identifier || "NodeRig";

        if (!mining_key || mining_key === "") {
            console.error("❌ Mining key is required! Check config.ini");
            process.exit(1);
        }

        console.log("\n🚀 ========== DUCO MINER STARTING ==========");
        console.log(`   📁 Config path: ${CONFIG_FILE}`);
        console.log(`   👤 Username: ${user}`);
        console.log(`   🔑 Mining Key: ${mining_key.substring(0, 3)}***`);
        console.log(`   🧵 Threads: ${processes}`);
        console.log(`   📊 Difficulty: ${difficulty}`);
        console.log(`   📦 Hashlib: ${hashlib}`);
        console.log(`   🏷️  Rig Identifier: ${rig_identifier}`);
        console.log(`   🚀 FastHash: ${utils.hasFastHash ? '✅ ACTIVE (accelerated)' : '❌ NOT ACTIVE (using JS)'}`);
        console.log("===========================================\n");

        for (let i = 0; i < processes; i++) {
            let worker = cluster.fork();
            console.log(`✅ Worker ${i} (pid-${worker.process.pid}) started`);

            let data = {
                workerId: i,
                hashes: 0,
                rejected: 0,
                accepted: 0
            };
            threads[i] = data;

            worker.on("message", (msg) => {
                if (threads[msg.workerId]) {
                    threads[msg.workerId].hashes = msg.hashes || 0;
                    threads[msg.workerId].rejected = msg.rejected || 0;
                    threads[msg.workerId].accepted = msg.accepted || 0;
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
                            threads[msg.workerId].hashes = msg.hashes || 0;
                            threads[msg.workerId].rejected = msg.rejected || 0;
                            threads[msg.workerId].accepted = msg.accepted || 0;
                        }
                        printData(threads);
                    });
                }, 3000);
            });
        }

        // In stats mỗi 30 giây
        setInterval(() => {
            if (threads.length > 0) {
                printData(threads);
            }
        }, 30000);

    }).catch((err) => {
        console.error(`❌ Failed to start master: ${err.message}`);
        process.exit(1);
    });
} else {
    startWorker();
}
