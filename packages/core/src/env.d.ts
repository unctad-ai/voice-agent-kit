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