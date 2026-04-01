use neon::prelude::*;
use std::time::Duration;
use sha1_smol::Sha1;

// ================= DUCO HASHER =================
fn ducos1_hash(data: &[u8], expected_hash: &[u8], diff: u128, eff: u64) -> u64 {
    let mut hasher = Sha1::from(data);
    let max_nonce = (100 * diff) as u64;
    let mut buffer = itoa::Buffer::new();
    
    if eff != 0 {
        for nonce in 0..=max_nonce {
            let mut temp_hasher = hasher.clone();
            let str = buffer.format(nonce);
            temp_hasher.update(str.as_bytes());
            
            // Sleep every 5000 iterations
            if nonce % 5000 == 0 && eff > 0 {
                std::thread::sleep(Duration::from_millis(eff / 100));
            }
            
            if temp_hasher.digest().bytes() == expected_hash {
                return nonce;
            }
        }
    } else {
        for nonce in 0..=max_nonce {
            let mut temp_hasher = hasher.clone();
            let str = buffer.format(nonce);
            temp_hasher.update(str.as_bytes());
            
            if temp_hasher.digest().bytes() == expected_hash {
                return nonce;
            }
        }
    }
    
    0
}

// ================= NEON BINDINGS =================
fn solve_job(mut cx: FunctionContext) -> JsResult<JsNumber> {
    // Lấy arguments
    let base = cx.argument::<JsString>(0)?.value();
    let target_hex = cx.argument::<JsString>(1)?.value();
    let diff = cx.argument::<JsNumber>(2)?.value() as u32;
    
    // Convert hex string to bytes
    let target_bytes = hex::decode(&target_hex).unwrap_or_default();
    
    // Convert base string to bytes
    let data = base.as_bytes();
    
    // Run mining
    let nonce = ducos1_hash(data, &target_bytes, diff as u128, 0);
    
    Ok(cx.number(nonce as f64))
}

// ================= FULL VERSION VỚI STATS =================
fn solve_job_full(mut cx: FunctionContext) -> JsResult<JsObject> {
    let base = cx.argument::<JsString>(0)?.value();
    let target_hex = cx.argument::<JsString>(1)?.value();
    let diff = cx.argument::<JsNumber>(2)?.value() as u32;
    let eff = cx.argument::<JsNumber>(3)?.value() as u64;
    
    let target_bytes = hex::decode(&target_hex).unwrap_or_default();
    let data = base.as_bytes();
    
    let start = std::time::Instant::now();
    let nonce = ducos1_hash(data, &target_bytes, diff as u128, eff);
    let elapsed = start.elapsed();
    
    let obj = cx.empty_object();
    
    let nonce_val = cx.number(nonce as f64);
    let elapsed_val = cx.number(elapsed.as_secs_f64());
    let hashrate_val = if elapsed.as_secs_f64() > 0.0 {
        cx.number(nonce as f64 / elapsed.as_secs_f64())
    } else {
        cx.number(0.0)
    };
    
    obj.set(&mut cx, "nonce", nonce_val)?;
    obj.set(&mut cx, "elapsedMs", elapsed_val)?;
    obj.set(&mut cx, "hashrate", hashrate_val)?;
    
    Ok(obj)
}

// ================= MODULE REGISTRATION =================
#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("solveJob", solve_job)?;
    cx.export_function("solveJobFull", solve_job_full)?;
    Ok(())
}
