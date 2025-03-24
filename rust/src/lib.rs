// dcrypt_wasm/src/lib.rs
use wasm_bindgen::prelude::*;
use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit, Nonce};
use sha2::{Digest, Sha256};
use js_sys::Array;
use serde_wasm_bindgen;

mod snippet;
use snippet::{get_ip_content, get_ip_metadata, get_chunk_data, create_chunk, Metadata};

// Set up console_error_panic_hook for better error reporting
#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn compute_chunk_size(file_size: u64, min_chunks: usize) -> usize {
    // Base chunk sizes
    const SMALL_FILE_THRESHOLD: u64 = 1024 * 1024; // 1 MB
    const LARGE_FILE_THRESHOLD: u64 = 10 * 1024 * 1024; // 10 MB
    const SMALL_CHUNK_SIZE: usize = 64 * 1024; // 64 KB
    const MEDIUM_CHUNK_SIZE: usize = 256 * 1024; // 256 KB
    const LARGE_CHUNK_SIZE: usize = 1024 * 1024; // 1 MB
    const MAX_CHUNKS: usize = 100;

    // Determine base chunk size based on file size
    let base_chunk_size = if file_size < SMALL_FILE_THRESHOLD {
        SMALL_CHUNK_SIZE
    } else if file_size < LARGE_FILE_THRESHOLD {
        MEDIUM_CHUNK_SIZE
    } else {
        LARGE_CHUNK_SIZE
    };

    // Calculate the number of chunks with the base chunk size
    let mut num_chunks = (file_size as usize + base_chunk_size - 1) / base_chunk_size;

    // Ensure at least min_chunks (e.g., number of nodes)
    if num_chunks < min_chunks {
        num_chunks = min_chunks;
    }

    // Cap the number of chunks to avoid excessive overhead
    if num_chunks > MAX_CHUNKS {
        num_chunks = MAX_CHUNKS;
    }

    // Recalculate chunk size to achieve the desired number of chunks
    let adjusted_chunk_size = (file_size as usize + num_chunks - 1) / num_chunks;
    // Ensure chunk size is at least 1 KB to avoid tiny chunks
    adjusted_chunk_size.max(1024)
}

#[wasm_bindgen]
pub fn chunk_encrypt(ip: JsValue, key: Vec<u8>, min_chunks: usize) -> Result<Array, JsValue> {
    let metadata: Metadata = serde_wasm_bindgen::from_value(get_ip_metadata(ip.clone())?)?;
    let chunk_size = compute_chunk_size(metadata.file_size, min_chunks);
    let mut chunks = Vec::new();
    let content_bytes = get_ip_content(ip.clone())?;
    let cipher = Aes256Gcm::new_from_slice(&key).map_err(|e| JsValue::from_str(&format!("Encryption error: {:?}", e)))?;

    for (i, chunk_data) in content_bytes.chunks(chunk_size).enumerate() {
        let nonce = Nonce::from_slice(&[0; 12]); // In production, use a unique nonce per chunk
        let encrypted_data = cipher.encrypt(nonce, chunk_data)
            .map_err(|e| JsValue::from_str(&format!("Encryption failed: {:?}", e)))?;
        let mut hasher = Sha256::new();
        hasher.update(&encrypted_data);
        let chunk_hash = hasher.finalize().to_vec();
        // Pass the file_type from metadata to create_chunk
        chunks.push(create_chunk(chunk_hash, encrypted_data, i, metadata.file_type.clone()));
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
    let nonce = Nonce::from_slice(&[0; 12]); // Must match the nonce used during encryption
    cipher.decrypt(nonce, get_chunk_data(chunk)?.as_ref())
        .map_err(|e| JsValue::from_str(&format!("Decryption failed: {:?}", e)))
}

#[wasm_bindgen]
pub fn compute_full_hash(content: Vec<u8>) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(&content);
    hasher.finalize().to_vec()
}