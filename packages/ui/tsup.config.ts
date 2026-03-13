import { defineConfig } from 'tsup';
import pkg from './package.json';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  define: {
    __KIT_VERSION__: JSON.stringify(pkg.version),
  },
  external: [
    'react',
    'react-dom',
    'motion',
    'motion/react',
    'lucide-react',
    'simplex-noise',
    '@unctad-ai/voice-agent-core',
    '@unctad-ai/voice-agent-registries',
  ],
});
