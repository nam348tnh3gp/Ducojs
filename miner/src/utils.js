const fetch = require('node-fetch');
const sha1 = require("js-sha1");
const jsSha1 = require("sha1");
const crypto = require('crypto');
const Benchmark = require("benchmark");
const Rusha = require('rusha');
const Hashes = require('jshashes');
const fs = require("fs");
const path = require("path");

// ================= FASTHASH DETECTION =================
let hasFastHash = false;
let fastHashModule = null;

try {
    // Đường dẫn đến thư mục libducohasher
    const addonPath = path.join(__dirname, '../../libducohasher');
    
    // Kiểm tra các vị trí có thể có file .so
    const possiblePaths = [
        // Linux .so files
        path.join(addonPath, 'target/release/libducohasher.so'),
        path.join(addonPath, 'target/release/liblibducohasher.so'),
        path.join(addonPath, 'libducohasher.so'),
        path.join(addonPath, 'liblibducohasher.so'),
        // Thử đường dẫn tuyệt đối
        '/root/Ducojs/libducohasher/target/release/libducohasher.so',
        '/root/Ducojs/libducohasher/target/release/liblibducohasher.so',
    ];
    
    let foundPath = null;
    for (const p of possiblePaths) {
        try {
            if (fs.existsSync(p)) {
                foundPath = p;
                break;
            }
        } catch (err) {
            // Bỏ qua lỗi khi kiểm tra path
        }
    }
    
    if (foundPath) {
        console.log(`📂 Loading native addon from: ${foundPath}`);
        
        // Tạo module object để dlopen vào
        const module = { exports: {} };
        
        // Dùng process.dlopen để load shared library
        if (process.dlopen) {
            process.dlopen(module, foundPath);
            fastHashModule = module.exports;
            hasFastHash = true;
            console.log('✅ [FASTHASH] Rust native addon loaded successfully via dlopen');
        } else {
            // Fallback cho Node.js cũ hơn
            const dlopen = require('module')._load;
            if (typeof dlopen === 'function') {
                fastHashModule = dlopen(foundPath);
                hasFastHash = true;
                console.log('✅ [FASTHASH] Rust native addon loaded successfully via module._load');
            } else {
                throw new Error('No suitable method to load native addon');
            }
        }
        
        // Kiểm tra các hàm có sẵn
        if (fastHashModule) {
            const exports = Object.keys(fastHashModule);
            console.log('📦 Available exports:', exports);
            
            if (fastHashModule.solveJob) {
                console.log('✅ [FASTHASH] solveJob function available');
            } else if (fastHashModule.solveJobFull) {
                console.log('✅ [FASTHASH] solveJobFull function available');
            } else if (fastHashModule.ducos1_hash) {
                console.log('✅ [FASTHASH] ducos1_hash function available');
            } else {
                console.log('⚠️ [FASTHASH] No mining function found in exports');
                if (typeof fastHashModule === 'function') {
                    console.log('📌 Module itself is a function, will try to call it directly');
                }
            }
        } else {
            console.log('⚠️ [FASTHASH] Module exports is empty');
        }
    } else {
        console.log('⚠️ [FASTHASH] libducohasher not found');
        console.log('   Searched paths:');
        possiblePaths.forEach(p => console.log('   -', p));
        console.log('   💡 To enable FastHash, build it with:');
        console.log('      cd /root/Ducojs/libducohasher && cargo build --release');
    }
} catch (e) {
    console.log('⚠️ [FASTHASH] Cannot load native addon: ' + e.message);
    console.log('   Error details:', e.stack);
    console.log('   💡 To enable FastHash, build it with:');
    console.log('      cd /root/Ducojs/libducohasher && cargo build --release');
    hasFastHash = false;
}

// ================= HELPER FUNCTIONS =================
const calculateHashrate = (hashes) => {
    hashes = parseFloat(hashes);
    let hashrate = hashes.toFixed(2) + " h/s";

    if (hashes / 1000 > 0.5) hashrate = (hashes / 1000).toFixed(2) + " Kh/s";
    if (hashes / 1000000 > 0.5) hashrate = (hashes / 1000000).toFixed(2) + " Mh/s";
    if (hashes / 1000000000 > 0.5) hashrate = (hashes / 1000000000).toFixed(2) + " Gh/s";

    return hashrate;
};

// ================= POOL CONFIG =================
const getPool = async () => {
    return new Promise((resolve, reject) => {
        const poolPath = path.join(__dirname, "../pools.json");
        
        if (fs.existsSync(poolPath)) {
            try {
                const raw = fs.readFileSync(poolPath, "utf-8");
                const data = JSON.parse(raw);
                console.log(`✅ Loaded pools.json from: ${poolPath}`);
                resolve(data);
            } catch (err) {
                reject("❌ Error reading pools.json: " + err.message);
            }
        } else {
            reject("⚠️ pools.json not found at: " + poolPath);
        }
    });
};

// ================= HASH LIBRARY BENCHMARK =================
const testLibs = async () => {
    return new Promise((resolve, reject) => {
        console.log("🔬 Testing hashing libs...");
        const testString = "someKey" + ":someValue".repeat(50);
        console.log(`🧪 Test string length: ${testString.length} chars`);

        const suite = new Benchmark.Suite();

        suite
            .add('js-sha1', function () {
                sha1(testString);
            })
            .add('node crypto', function () {
                crypto.createHash('sha1').update(testString).digest('hex');
            })
            .add('sha1', function () {
                jsSha1(testString);
            })
            .add("rusha", function () {
                Rusha.createHash().update(testString).digest('hex');
            })
            .add("jshashes", function () {
                new Hashes.SHA1().hex(testString);
            })
            .on('cycle', function (event) {
                console.log(String(event.target));
            })
            .on('complete', function () {
                const fastest = this.filter('fastest').map('name');
                const hashlib = Array.isArray(fastest) ? fastest[0] : fastest;
                console.log(`✅ Fastest library: ${hashlib}`);
                resolve(hashlib);
            })
            .run({ 'async': true });
    });
};

// ================= HASH FUNCTION (JS fallback) =================
const _sha1 = (hashlib, str) => {
    if (hashlib === "rusha") return Rusha.createHash().update(str).digest('hex');
    if (hashlib === "sha1") return jsSha1(str);
    if (hashlib === "node crypto") return crypto.createHash('sha1').update(str).digest('hex');
    if (hashlib === "jshashes") return new Hashes.SHA1().hex(str);
    return sha1(str); // default js-sha1
};

// ================= MINING FUNCTION (Unified) =================
/**
 * DUCOS1 mining algorithm
 * @param {string} last_h - Last hash from pool (base)
 * @param {string} exp_h - Expected hash to find (target)
 * @param {number} diff - Difficulty
 * @param {number} intensity - Mining intensity (0-100)
 * @param {string} hashlib - Hash library name (for JS fallback)
 * @param {Function} onProgress - Progress callback (nonce, maxNonce)
 * @returns {Promise<{nonce: number, hashrate: number, elapsed: number, hashes: number}>}
 */
const mineJob = async (last_h, exp_h, diff, intensity, hashlib, onProgress) => {
    const maxNonce = 100 * diff;
    const startTime = Date.now();
    let hashes = 0;
    
    // ===== FASTHASH PATH (Rust native) =====
    if (hasFastHash && fastHashModule) {
        try {
            console.log('🚀 Using Rust native addon for mining');
            let result = null;
            
            // Thử các tên hàm khác nhau
            if (fastHashModule.solveJob && typeof fastHashModule.solveJob === 'function') {
                console.log('📞 Calling solveJob');
                result = fastHashModule.solveJob(last_h, exp_h, diff);
                console.log('🔧 solveJob returned:', result);
            } 
            else if (fastHashModule.solveJobFull && typeof fastHashModule.solveJobFull === 'function') {
                console.log('📞 Calling solveJobFull');
                result = fastHashModule.solveJobFull(last_h, exp_h, diff, 0);
                console.log('🔧 solveJobFull returned:', result);
            }
            else if (fastHashModule.ducos1_hash && typeof fastHashModule.ducos1_hash === 'function') {
                console.log('📞 Calling ducos1_hash');
                result = fastHashModule.ducos1_hash(last_h, exp_h, diff);
                console.log('🔧 ducos1_hash returned:', result);
            }
            else if (typeof fastHashModule === 'function') {
                console.log('📞 Calling module directly');
                result = fastHashModule(last_h, exp_h, diff);
                console.log('🔧 Direct call returned:', result);
            }
            else {
                // Thử gọi với tên export mặc định
                const defaultExport = fastHashModule.default || fastHashModule;
                if (typeof defaultExport === 'function') {
                    console.log('📞 Calling default export');
                    result = defaultExport(last_h, exp_h, diff);
                    console.log('🔧 Default export returned:', result);
                }
            }
            
            if (result !== null && result !== undefined) {
                // Xử lý kết quả trả về
                let nonceFound = 0;
                
                if (typeof result === 'object' && result.nonce !== undefined) {
                    nonceFound = result.nonce;
                } else if (typeof result === 'number') {
                    nonceFound = result;
                } else if (typeof result === 'bigint') {
                    nonceFound = Number(result);
                }
                
                if (nonceFound > 0) {
                    const elapsed = (Date.now() - startTime) / 1000;
                    const hashrate = nonceFound / elapsed;
                    console.log(`✅ Found nonce: ${nonceFound} in ${elapsed.toFixed(2)}s (${calculateHashrate(hashrate)})`);
                    return {
                        nonce: nonceFound,
                        hashrate: hashrate,
                        elapsed: elapsed,
                        hashes: nonceFound
                    };
                }
            }
            
            console.log('⚠️ Rust addon returned invalid result, falling back to JS');
        } catch (err) {
            console.log(`⚠️ FastHash error: ${err.message}`);
            if (err.stack) console.log('Error stack:', err.stack);
            console.log('Falling back to JavaScript implementation');
        }
    }
    
    // ===== JS FALLBACK PATH =====
    console.log('📝 Using JavaScript fallback implementation');
    for (let nonce = 0; nonce <= maxNonce; nonce++) {
        const hash = _sha1(hashlib, last_h + nonce);
        hashes++;
        
        if (hash === exp_h) {
            const elapsed = (Date.now() - startTime) / 1000;
            const hashrate = elapsed > 0 ? hashes / elapsed : 0;
            console.log(`✅ Found nonce: ${nonce} in ${elapsed.toFixed(2)}s (${calculateHashrate(hashrate)})`);
            return { nonce, hashrate, elapsed, hashes };
        }
        
        // Intensity control: sleep to reduce CPU usage
        if (intensity < 100 && nonce % 5000 === 0) {
            const sleepMs = Math.floor((100 - intensity) / 10);
            if (sleepMs > 0) {
                await new Promise(resolve => setTimeout(resolve, sleepMs));
            }
        }
        
        // Progress callback
        if (onProgress && nonce % 10000 === 0) {
            onProgress(nonce, maxNonce);
        }
    }
    
    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`❌ No nonce found after ${maxNonce} attempts`);
    return { nonce: 0, hashrate: 0, elapsed, hashes };
};

// ================= EXPORTS =================
module.exports = {
    calculateHashrate,
    getPool,
    testLibs,
    _sha1,
    hasFastHash,
    mineJob
};
