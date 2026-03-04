// Mirror core's ambient declarations for modules that reference
// browser/Vite-specific APIs not available in the server context.

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_API_KEY?: string;
  [key: string]: string | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module 'ten-vad-glue' {
  const createVADModule: (options?: {
    locateFile?: (filename: string) => string;
  }) => Promise<any>;
  export default createVADModule;
}
