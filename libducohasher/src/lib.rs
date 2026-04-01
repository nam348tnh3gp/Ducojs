use neon::prelude::*;
use sha1_smol::Sha1;

// Helper function để convert sha1 sang hex
fn sha1_to_hex(input: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(input.as_bytes());
    let result = hasher.digest();
    
    // Digest là [u8; 20], convert trực tiếp
    let mut hex_string = String::with_capacity(40);
    for byte in result.bytes() {
        hex_string.push_str(&format!("{:02x}", byte));
    }
    hex_string
}

// ================= DUCO HASHER =================
fn ducos1_hash(base: &str, target_hex: &str, diff: u32) -> Option<(u64, f64, u128)> {
    let max_nonce = (diff * 100) as u64;
    let start = std::time::Instant::now();
    
    for nonce in 0..=max_nonce {
        let input = format!("{}{}", base, nonce);
        let hash = sha1_to_hex(&input);
        
        if hash == target_hex {
            let elapsed = start.elapsed();
            let elapsed_us = elapsed.as_micros();
            let hashrate = if elapsed_us > 0 {
                (nonce as f64 * 1_000_000.0) / elapsed_us as f64
            } else {
                0.0
            };
            return Some((nonce, hashrate, elapsed_us));
        }
    }
    None
}

// ================= NEON BINDINGS =================
fn solve_job(mut cx: FunctionContext) -> JsResult<JsObject> {
    // Lấy arguments - KHÔNG dùng value() với argument
    let base = cx.argument::<JsString>(0)?.value();
    let target_hex = cx.argument::<JsString>(1)?.value();
    let diff = cx.argument::<JsNumber>(2)?.value() as u32;
    
    let result = ducos1_hash(&base, &target_hex, diff);
    
    let obj = cx.empty_object();
    
    if let Some((nonce, hashrate, elapsed_us)) = result {
        let nonce_val = cx.number(nonce as f64);
        let hashrate_val = cx.number(hashrate);
        let elapsed_val = cx.number(elapsed_us as f64 / 1000.0);
        
        obj.set(&mut cx, "nonce", nonce_val)?;
        obj.set(&mut cx, "hashrate", hashrate_val)?;
        obj.set(&mut cx, "elapsedMs", elapsed_val)?;
    } else {
        // Return object với nonce = 0
        let nonce_val = cx.number(0.0);
        let hashrate_val = cx.number(0.0);
        let elapsed_val = cx.number(0.0);
        
        obj.set(&mut cx, "nonce", nonce_val)?;
        obj.set(&mut cx, "hashrate", hashrate_val)?;
        obj.set(&mut cx, "elapsedMs", elapsed_val)?;
    }
    
    Ok(obj)
}

// ================= MODULE REGISTRATION =================
#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("solveJob", solve_job)?;
    Ok(())
}
