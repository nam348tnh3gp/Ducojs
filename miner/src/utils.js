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
    const addonPath = path.join(__dirname, '../../libducohasher');
    // Kiểm tra file tồn tại trước khi require
    if (fs.existsSync(addonPath) || fs.existsSync(addonPath + '/native/index.node')) {
        fastHashModule = require(addonPath);
        hasFastHash = true;
        console.log('✅ [FASTHASH] Rust native addon loaded successfully');
    } else {
        console.log('⚠️ [FASTHASH] libducohasher not found, using pure JS');
    }
} catch (e) {
    console.log('⚠️ [FASTHASH] Cannot load native addon: ' + e.message);
    console.log('   💡 To enable FastHash, build it with: npm run build-fast');
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
        const poolPath = path.join(__dirname, "../../pools.json");
        
        if (fs.existsSync(poolPath)) {
            try {
                const raw = fs.readFileSync(poolPath, "utf-8");
                const data = JSON.parse(raw);
                resolve(data);
            } catch (err) {
                reject("❌ Error reading pools.json: " + err.message);
            }
        } else {
            reject("⚠️ pools.json not found");
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
 * @param {string} last_h - Last hash from pool
 * @param {string} exp_h - Expected hash to find
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
    if (hasFastHash && fastHashModule && fastHashModule.ducos1) {
        try {
            const result = fastHashModule.ducos1(last_h, exp_h, diff, intensity, startTime);
            return {
                nonce: result.nonce,
                hashrate: result.hashrate,
                elapsed: result.elapsed,
                hashes: result.nonce || maxNonce
            };
        } catch (err) {
            console.log(`⚠️ FastHash error: ${err.message}, falling back to JS`);
            // Fallback to JS if Rust fails
        }
    }
    
    // ===== JS FALLBACK PATH =====
    for (let nonce = 0; nonce <= maxNonce; nonce++) {
        const hash = _sha1(hashlib, last_h + nonce);
        hashes++;
        
        if (hash === exp_h) {
            const elapsed = (Date.now() - startTime) / 1000;
            const hashrate = elapsed > 0 ? hashes / elapsed : 0;
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
