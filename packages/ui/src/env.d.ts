/**
 * Vite environment variable types.
 * Host apps using Vite will have these available at runtime via import.meta.env.
 * This declaration makes TypeScript aware of the pattern without requiring
 * vite as a dependency of the core package.
 */
interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_API_KEY?: string;
  [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Build-time constant injected by tsup — holds the kit version string */
declare const __KIT_VERSION__: string;

/** Type declaration for ten-vad-glue — Emscripten WASM module loaded at runtime via Vite alias */
declare module 'ten-vad-glue' {
  const createVADModule: (options?: {
    locateFile?: (filename: string) => string;
  }) => Promise<any>;
  export default createVADModule;
}
