use neon::prelude::*;
use sha1_smol::Sha1;
use std::time::Duration;
use std::sync::Mutex;

// ================= DUCO HASHER CLASS =================
struct DUCOHasher {
    hasher: Sha1,
}

impl DUCOHasher {
    fn new(data: &[u8]) -> Self {
        Self {
            hasher: Sha1::from(data),
        }
    }
    
    fn ducos1(&mut self, expected_hash: &[u8], diff: u128, eff: u64) -> u128 {
        let mut buffer = itoa::Buffer::new();
        let max_nonce = 100 * diff;
        
        for nonce in 0..=max_nonce {
            let mut temp_hasher = self.hasher.clone();
            let str = buffer.format(nonce);
            temp_hasher.update(str.as_bytes());
            
            if temp_hasher.digest().bytes() == expected_hash {
                self.hasher.reset();
                return nonce;
            }
            
            // Intensity control: sleep every 5000 nonces
            if eff != 0 && nonce % 5000 == 0 {
                let sleep_ms = (eff as u64) / 100;
                if sleep_ms > 0 {
                    std::thread::sleep(Duration::from_millis(sleep_ms));
                }
            }
        }
        0
    }
}

// ================= NEON BINDINGS =================
fn create_hasher(mut cx: FunctionContext) -> JsResult<JsObject> {
    let data = cx.argument::<JsString>(0)?.value(&mut cx);
    let data_bytes = data.as_bytes();
    
    let hasher = DUCOHasher::new(data_bytes);
    let boxed = cx.boxed(hasher);
    
    // Create wrapper object with methods
    let obj = cx.empty_object();
    obj.set(&mut cx, "_inner", boxed)?;
    
    Ok(obj)
}

fn ducos1(mut cx: FunctionContext) -> JsResult<JsNumber> {
    // Get the hasher object
    let this = cx.this();
    let inner = this.get(&mut cx, "_inner")?;
    let mut hasher = cx.borrow_mut(&inner)?;
    
    // Get arguments
    let expected_hash_hex = cx.argument::<JsString>(0)?.value(&mut cx);
    let diff = cx.argument::<JsNumber>(1)?.value(&mut cx) as u128;
    let eff = cx.argument::<JsNumber>(2)?.value(&mut cx) as u64;
    
    // Convert hex string to bytes
    let expected_hash_bytes = hex::decode(expected_hash_hex).unwrap();
    
    let nonce = hasher.ducos1(&expected_hash_bytes, diff, eff);
    
    Ok(cx.number(nonce as f64))
}

#[neon::main]
fn main(mut cx: ModuleContext) -> NeonResult<()> {
    // Export a factory function that creates a hasher
    cx.export_function("createHasher", create_hasher)?;
    
    // Export the DUCOS1 function that takes a hasher object
    cx.export_function("ducos1", ducos1)?;
    
    Ok(())
}
