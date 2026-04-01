use neon::prelude::*;
use sha1_smol::Sha1;
use hex;

// ================= DUCO HASHER =================
fn ducos1_hash(base: &str, target_hex: &str, diff: u32) -> Option<(u64, f64, u128)> {
    let target = hex::decode(target_hex).unwrap_or_default();
    let max_nonce = (diff * 100) as u64;
    let start = std::time::Instant::now();
    
    for nonce in 0..=max_nonce {
        let input = format!("{}{}", base, nonce);
        let hash = Sha1::from(input).hex();
        
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
    let base = cx.argument::<JsString>(0)?.value(&mut cx);
    let target_hex = cx.argument::<JsString>(1)?.value(&mut cx);
    let diff = cx.argument::<JsNumber>(2)?.value(&mut cx) as u32;
    
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
        // Return empty object with nonce = 0
        let nonce_val = cx.number(0.0);
        let hashrate_val = cx.number(0.0);
        let elapsed_val = cx.number(0.0);
        
        obj.set(&mut cx, "nonce", nonce_val)?;
        obj.set(&mut cx, "hashrate", hashrate_val)?;
        obj.set(&mut cx, "elapsedMs", elapsed_val)?;
    }
    
    Ok(obj)
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("solveJob", solve_job)?;
    Ok(())
}
