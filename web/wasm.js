export async function loadWasmModule() {
    try {
      // Replace with the actual path to your WASM file
      const wasmModule = await import('./pkg/dcrypt_wasm.js');
      return wasmModule.default;
    } catch (error) {
      console.error('Failed to load WASM module:', error);
      throw error;
    }
  }