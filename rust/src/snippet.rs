use serde::{Serialize, Deserialize};
use wasm_bindgen::prelude::*;
use js_sys::Array;
use serde_wasm_bindgen;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Metadata {
    content_type: String,
    tags: Vec<String>,
    version: String,
    chunk_count: usize,
    file_size: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct IntellectualProperty {
    content: Vec<u8>,
    metadata: Metadata,
    is_premium: bool,
    price_dct: u64,
    creator_id: Vec<u8>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Chunk {
    hash: Vec<u8>,
    data: Vec<u8>,
    index: usize,
}

#[wasm_bindgen]
pub fn create_metadata(content_type: String, tags: Array, version: String, file_size: u64) -> JsValue {
    let tags: Vec<String> = tags.iter().map(|s| s.as_string().unwrap()).collect();
    let metadata = Metadata {
        content_type,
        tags,
        version,
        chunk_count: 0,
        file_size,
    };
    serde_wasm_bindgen::to_value(&metadata).unwrap()
}

#[wasm_bindgen]
pub fn create_intellectual_property(content: Vec<u8>, content_type: String, tags: Array, is_premium: bool, price_usd: f64, creator_id: Vec<u8>) -> JsValue {
    let tags: Vec<String> = tags.iter().map(|s| s.as_string().unwrap()).collect();
    let metadata = Metadata {
        content_type,
        tags,
        version: "1.0.0".to_string(),
        chunk_count: 0,
        file_size: content.len() as u64,
    };
    let price_dct = price_usd as u64;
    let ip = IntellectualProperty {
        content,
        metadata,
        is_premium,
        price_dct,
        creator_id,
    };
    serde_wasm_bindgen::to_value(&ip).unwrap()
}

#[wasm_bindgen]
pub fn create_chunk(hash: Vec<u8>, data: Vec<u8>, index: usize) -> JsValue {
    let chunk = Chunk { hash, data, index };
    serde_wasm_bindgen::to_value(&chunk).unwrap()
}

// Getter functions for IntellectualProperty
#[wasm_bindgen]
pub fn get_ip_content(ip: JsValue) -> Result<Vec<u8>, JsValue> {
    let ip: IntellectualProperty = serde_wasm_bindgen::from_value(ip)?;
    Ok(ip.content)
}

#[wasm_bindgen]
pub fn get_ip_metadata(ip: JsValue) -> Result<JsValue, JsValue> {
    let ip: IntellectualProperty = serde_wasm_bindgen::from_value(ip)?;
    Ok(serde_wasm_bindgen::to_value(&ip.metadata)?)
}

#[wasm_bindgen]
pub fn get_ip_is_premium(ip: JsValue) -> Result<bool, JsValue> {
    let ip: IntellectualProperty = serde_wasm_bindgen::from_value(ip)?;
    Ok(ip.is_premium)
}

#[wasm_bindgen]
pub fn get_ip_price_dct(ip: JsValue) -> Result<u64, JsValue> {
    let ip: IntellectualProperty = serde_wasm_bindgen::from_value(ip)?;
    Ok(ip.price_dct)
}

#[wasm_bindgen]
pub fn get_ip_creator_id(ip: JsValue) -> Result<Vec<u8>, JsValue> {
    let ip: IntellectualProperty = serde_wasm_bindgen::from_value(ip)?;
    Ok(ip.creator_id)
}

#[wasm_bindgen]
pub fn get_ip_file_size(ip: JsValue) -> Result<u64, JsValue> {
    let ip: IntellectualProperty = serde_wasm_bindgen::from_value(ip)?;
    Ok(ip.metadata.file_size)
}

// Getter functions for Chunk
#[wasm_bindgen]
pub fn get_chunk_hash(chunk: JsValue) -> Result<Vec<u8>, JsValue> {
    let chunk: Chunk = serde_wasm_bindgen::from_value(chunk)?;
    Ok(chunk.hash)
}

#[wasm_bindgen]
pub fn get_chunk_data(chunk: JsValue) -> Result<Vec<u8>, JsValue> {
    let chunk: Chunk = serde_wasm_bindgen::from_value(chunk)?;
    Ok(chunk.data)
}

#[wasm_bindgen]
pub fn get_chunk_index(chunk: JsValue) -> Result<usize, JsValue> {
    let chunk: Chunk = serde_wasm_bindgen::from_value(chunk)?;
    Ok(chunk.index)
}