<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/rogelioRuiz/dust/main/assets/branding/dust_white.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/rogelioRuiz/dust/main/assets/branding/dust_black.png">
    <img alt="dust" src="https://raw.githubusercontent.com/rogelioRuiz/dust/main/assets/branding/dust_black.png" width="200">
  </picture>
</p>

<p align="center">
  <strong>Device Unified Serving Toolkit</strong><br>
  <a href="https://github.com/rogelioRuiz/dust">dust ecosystem</a> · v0.1.8 · Apache 2.0
</p>

<p align="center">
  <a href="https://github.com/rogelioRuiz/dust/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
  <img alt="Version" src="https://img.shields.io/badge/version-0.1.8-informational">
  <img alt="npm" src="https://img.shields.io/badge/npm-dust--serve--capacitor-cb3837">
  <img alt="Capacitor" src="https://img.shields.io/badge/Capacitor-7%20%7C%208-119EFF">
  <a href="https://github.com/rogelioRuiz/dust-serve-capacitor/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/rogelioRuiz/dust-serve-capacitor/actions/workflows/ci.yml/badge.svg?branch=main"></a>
</p>

---

<p align="center">
<strong>dust ecosystem</strong> —
<a href="../capacitor-core/README.md">capacitor-core</a> ·
<a href="../capacitor-llm/README.md">capacitor-llm</a> ·
<a href="../capacitor-onnx/README.md">capacitor-onnx</a> ·
<strong>capacitor-serve</strong> ·
<a href="../capacitor-embeddings/README.md">capacitor-embeddings</a>
<br>
<a href="../dust-core-kotlin/README.md">dust-core-kotlin</a> ·
<a href="../dust-llm-kotlin/README.md">dust-llm-kotlin</a> ·
<a href="../dust-onnx-kotlin/README.md">dust-onnx-kotlin</a> ·
<a href="../dust-embeddings-kotlin/README.md">dust-embeddings-kotlin</a> ·
<a href="../dust-serve-kotlin/README.md">dust-serve-kotlin</a>
<br>
<a href="../dust-core-swift/README.md">dust-core-swift</a> ·
<a href="../dust-llm-swift/README.md">dust-llm-swift</a> ·
<a href="../dust-onnx-swift/README.md">dust-onnx-swift</a> ·
<a href="../dust-embeddings-swift/README.md">dust-embeddings-swift</a> ·
<a href="../dust-serve-swift/README.md">dust-serve-swift</a>
</p>

---

# capacitor-serve

Capacitor plugin for on-device model lifecycle management — registry, resumable downloads with SHA-256 verification, ref-counted session caching, and memory pressure eviction.

## Features

- **Model registry** — register descriptors (id, format, size, URL, hash) from native code or JS
- **Resumable downloads** — background downloads that survive app suspension (iOS: URLSession, Android: WorkManager)
- **SHA-256 verification** — downloaded files are hash-verified before being marked ready
- **Network policy** — enforce WiFi-only downloads with real-time connectivity checks
- **Session caching** — ref-counted model sessions with LRU eviction under memory pressure
- **Inference serialization** — all `predict()` calls on a session are serialized to prevent corruption
- **Accelerator probing** — post-download GPU/NNAPI vs CPU probe with accuracy validation (Android)
- **DustCore integration** — registers as a `ModelServer` in the DustCore service locator for cross-plugin discovery

## Install

```bash
npm install dust-serve-capacitor
npx cap sync
```

Peer dependencies:

```json
{
  "@capacitor/core": "^7.0.0 || ^8.0.0",
  "dust-core-capacitor": ">=0.1.0"
}
```

## Quick Start

```typescript
import { ModelServer } from 'capacitor-serve';

// Listen for download events
await ModelServer.addListener('sizeDisclosure', (e) => {
  console.log(`Model ${e.modelId}: ${e.sizeBytes} bytes`);
});

await ModelServer.addListener('modelProgress', (e) => {
  console.log(`${(e.progress * 100).toFixed(1)}%`);
});

await ModelServer.addListener('modelReady', (e) => {
  console.log(`Model ready at ${e.path}`);
});

await ModelServer.addListener('modelFailed', (e) => {
  console.error(`Failed: ${e.error.code}`);
});

// Enforce WiFi-only downloads
await ModelServer.setNetworkPolicy({ wifiOnly: true });

// Start a download (model must be registered natively first)
await ModelServer.downloadModel({ modelId: 'qwen3-0.6b' });

// Check status
const { status } = await ModelServer.getModelStatus({ modelId: 'qwen3-0.6b' });

// List all models
const { models } = await ModelServer.listModels();
```

Models are registered from native code via `ModelRegistry.register(descriptor)`. The JS API handles downloads, status queries, and event listening.

## API

| Method | Signature | Description |
|--------|-----------|-------------|
| `listModels` | `() => Promise<{ models: ModelDescriptorWithStatus[] }>` | List all registered models with current status |
| `getModelStatus` | `(options: { modelId: string }) => Promise<{ status: ModelStatus }>` | Get status for a specific model (returns `notLoaded` for unknown IDs) |
| `downloadModel` | `(options: { modelId: string }) => Promise<void>` | Start a model download (idempotent — concurrent calls share the same task) |
| `cancelDownload` | `(options: { modelId: string }) => Promise<void>` | Cancel an in-progress download, delete `.part` file |
| `setNetworkPolicy` | `(options: NetworkPolicy) => Promise<void>` | Set WiFi-only download policy |
| `getNetworkPolicy` | `() => Promise<NetworkPolicy>` | Get current network policy |

## Events

| Event | Payload | When |
|-------|---------|------|
| `sizeDisclosure` | `{ modelId, sizeBytes }` | After server responds with content-length, before first progress |
| `modelProgress` | `{ modelId, progress, bytesDownloaded, totalBytes? }` | Every 1 MB (iOS) / 512 KB (Android) during download |
| `modelReady` | `{ modelId, path }` | Download complete + SHA-256 verified |
| `modelFailed` | `{ modelId, error: DustCoreError }` | Download failed, cancelled, or verification mismatch |

## Types

```typescript
import type { ModelDescriptor, ModelStatus, DustCoreError } from 'dust-core-capacitor';

interface ModelDescriptorWithStatus {
  descriptor: ModelDescriptor;
  status: ModelStatus;
}

interface NetworkPolicy {
  wifiOnly: boolean;
}

interface SizeDisclosureEvent {
  modelId: string;
  sizeBytes: number;
}

interface ModelProgressEvent {
  modelId: string;
  progress: number;
  bytesDownloaded: number;
  totalBytes?: number;
}

interface ModelReadyEvent {
  modelId: string;
  path: string;
}

interface ModelFailedEvent {
  modelId: string;
  error: DustCoreError;
}
```

## Architecture

### Dependency graph

```
capacitor-serve          (thin Capacitor bridge)
├── dust-serve-kotlin          (Android business logic, package: io.t6x.dust.serve)
│   └── dust-core-kotlin           (DustCore contracts)
└── dust-serve-swift           (iOS business logic, module: DustServe)
    └── dust-core-swift            (DustCore contracts)
```

The plugin itself contains only the Capacitor bridge layer — two native files (`ServePlugin.kt` + `ServePlugin.swift`) that translate between Capacitor's JS bridge and the standalone platform libraries. All business logic (downloads, sessions, probing, eviction) lives in the standalone libraries with zero Capacitor dependency.

### Status lifecycle

```
notLoaded → downloading(progress) → verifying → ready
                                              → failed(error)
         → loading → ready
                   → failed(error)
```

### Platform differences

| Aspect | iOS | Android |
|--------|-----|---------|
| Background download | URLSession background config | WorkManager CoroutineWorker |
| Progress interval | 1 MB | 512 KB |
| Network monitoring | NWPathMonitor | ConnectivityManager |
| Memory eviction | Critical only (single signal) | Graduated (standard + critical) |
| Accelerator probing | Not implemented | GPU/NNAPI vs CPU probe |
| Min platform | iOS 16.0 | API 26 |

## Project Structure

```
capacitor-serve/
├── package.json                 # npm package, peer deps: @capacitor/core, dust-core-capacitor
├── Package.swift                # SPM manifest (depends on DustServe)
├── DustCapacitorServe.podspec # CocoaPods spec
├── src/
│   ├── definitions.ts           # Plugin interface (6 methods + 4 event listeners)
│   ├── plugin.ts                # Web stub (throws on download operations)
│   └── index.ts                 # Barrel export
├── android/
│   ├── build.gradle             # Depends on :dust-serve-kotlin, :capacitor-core
│   └── src/main/io/t6x/dust/capacitor/serve/ServePlugin.kt   # Capacitor bridge (8.8 KB)
├── ios/
│   └── Sources/ServePlugin/
│       └── ServePlugin.swift          # Capacitor bridge (6.5 KB)
└── tests/
    └── unit/
        ├── definitions.test.ts  # 18 vitest tests (interface structure, events, types)
        └── session-lifecycle.test.ts  # 3 vitest tests (session types)
```

Native business logic and tests live in the standalone libraries:
- **dust-serve-kotlin/** — 17 source files, 6 test files (46 tests)
- **dust-serve-swift/** — 10 source files, 5 test files (37 tests)

## Testing

### TypeScript

```bash
npm test     # 21 vitest tests
```

### Native tests

Native tests live in the standalone libraries:

```bash
# Kotlin (46 tests — registry, download, session, probe)
cd capacitor-core/verification/android-downstream/android
./gradlew :dust-serve-kotlin:testDebugUnitTest

# Swift (37 tests — registry, download, session)
cd dust-serve-swift
swift test
```

### Integration tests

See [INTEGRATION-TESTS.md](INTEGRATION-TESTS.md) for manual device verification (background download resilience, network interruption recovery).

## License

Copyright 2026 Rogelio Ruiz Perez. Licensed under the [Apache License 2.0](LICENSE).

---

<p align="center">
  Part of <a href="../README.md"><strong>dust</strong></a> — Device Unified Serving Toolkit
</p>
