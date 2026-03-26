/** Emscripten factory for the TEN-VAD WASM module (browser build) */
declare const createVADModule: (options?: {
  locateFile?: (filename: string) => string;
}) => Promise<any>;
export default createVADModule;
