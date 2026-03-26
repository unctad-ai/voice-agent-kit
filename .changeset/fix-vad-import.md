---
"@unctad-ai/voice-agent-core": patch
---

fix(core): resolve ten-vad WASM module via real package path instead of Vite alias

Replaces `import('ten-vad-glue')` with `import('@gooney-001/ten-vad-lib/ten_vad.js')` and removes `@vite-ignore`. The bare specifier failed to resolve at runtime in production builds where Vite's esbuild pre-bundler doesn't apply aliases. Moves `@gooney-001/ten-vad-lib` from peerDependencies to dependencies so the kit owns its VAD dependency.
