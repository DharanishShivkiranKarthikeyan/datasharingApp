mod snippet;

use snippet::{Chunk, get_ip_content, get_ip_metadata, get_chunk_data, create_chunk};
use wasm_bindgen::prelude::*;
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use sha2::{Digest, Sha256};
use js_sys::Array;
use serde_wasm_bindgen;

#[wasm_bindgen]
pub fn chunk_encrypt(ip: JsValue, key: Vec<u8>) -> Result<Array, JsValue> {
    let chunk_size = if serde_wasm_bindgen::from_value::<Metadata>(get_ip_metadata(ip.clone())?)?.file_size > 1024 * 1024 { 1024 * 1024 } else { 2048 };
    let mut chunks = Vec::new();
    let content_bytes = get_ip_content(ip.clone())?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| JsValue::from_str(&format!("Encryption error: {:?}", e)))?;

    for (i, chunk_data) in content_bytes.chunks(chunk_size).enumerate() {
        let nonce = Nonce::from_slice(&[0; 12]);
        let encrypted_data = cipher.encrypt(nonce, chunk_data)
            .map_err(|e| JsValue::from_str(&format!("Encryption failed: {:?}", e)))?;
        let mut hasher = Sha256::new();
        hasher.update(&encrypted_data);
        let chunk_hash = hasher.finalize().to_vec();
        chunks.push(create_chunk(chunk_hash, encrypted_data, i));
    }

    let js_chunks = Array::new();
    for chunk in chunks {
        js_chunks.push(&chunk);
    }
    Ok(js_chunks)
}

#[wasm_bindgen]
pub fn decrypt_chunk(chunk: JsValue, key: Vec<u8>) -> Result<Vec<u8>, JsValue> {
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| JsValue::from_str(&format!("Decryption error: {:?}", e)))?;
    let nonce = Nonce::from_slice(&[0; 12]);
    cipher.decrypt(nonce, get_chunk_data(chunk)?.as_ref())
        .map_err(|e| JsValue::from_str(&format!("Decryption failed: {:?}", e)))
}

#[wasm_bindgen]
pub fn compute_full_hash(content: Vec<u8>) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(&content);
    hasher.finalize().to_vec()
}

#[derive(serde::Serialize, serde::Deserialize)]
struct Metadata {
    file_size: u64,
}