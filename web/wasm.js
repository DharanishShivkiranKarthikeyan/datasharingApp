// web/wasm.js
export async function loadWasmModule() {
  try {
    const wasmModule = await import('./pkg/dcrypt_wasm.js');
    // The default export is the R function, which needs to be called to initialize the WASM module
    const initializedModule = await wasmModule.default();
    console.log('Initialized WASM module:', initializedModule);
    console.log('WASM module exports:', Object.keys(initializedModule));
    return initializedModule;
  } catch (error) {
    console.error('Failed to load WASM module:', error);
    throw error;
  }
}