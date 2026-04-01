use neon::prelude::*;
use sha1_smol::Sha1;
use hex;

// ================= DUCO HASHER =================
fn ducos1_hash(data: &[u8], expected_hash: &[u8], diff: u32) -> u64 {
    let mut hasher = Sha1::from(data);
    let max_nonce = (100 * diff) as u64;
    let mut buffer = itoa::Buffer::new();
    
    for nonce in 0..=max_nonce {
        let mut temp_hasher = hasher.clone();
        let str = buffer.format(nonce);
        temp_hasher.update(str.as_bytes());
        
        if temp_hasher.digest().bytes() == expected_hash {
            return nonce;
        }
    }
    
    0
}

// ================= NEON BINDINGS =================
fn solve_job(mut cx: FunctionContext) -> JsResult<JsNumber> {
    let base = cx.argument::<JsString>(0)?.value(&mut cx);
    let target_hex = cx.argument::<JsString>(1)?.value(&mut cx);
    let diff = cx.argument::<JsNumber>(2)?.value(&mut cx) as u32;
    
    let target_bytes = hex::decode(&target_hex).unwrap_or_default();
    let data = base.as_bytes();
    
    let nonce = ducos1_hash(data, &target_bytes, diff);
    
    Ok(cx.number(nonce as f64))
}

// ================= MODULE REGISTRATION =================
#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    cx.export_function("solveJob", solve_job)?;
    Ok(())
}
