import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: true,
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
