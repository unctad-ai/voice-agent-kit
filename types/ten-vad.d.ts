/** Type declaration for the browser-compatible Emscripten glue in @gooney-001/ten-vad-lib */
declare module '@gooney-001/ten-vad-lib/ten_vad.js' {
  const createVADModule: (options?: {
    locateFile?: (filename: string) => string;
  }) => Promise<any>;
  export default createVADModule;
}
