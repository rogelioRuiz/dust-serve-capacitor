import { describe, expect, it } from 'vitest'
import type { PluginListenerHandle } from '@capacitor/core'
import { ModelFormat } from '@dust/capacitor-core'
import type { DustCoreError, ModelDescriptor, ModelStatus } from '@dust/capacitor-core'
import type {
  ModelDescriptorWithStatus,
  ModelFailedEvent,
  ModelProgressEvent,
  ModelReadyEvent,
  ServePlugin,
  SizeDisclosureEvent,
} from '../../src/definitions'

const addListenerStub = (async (_eventName: string, _listenerFunc: (event: any) => void): Promise<PluginListenerHandle> => ({
  remove: async () => {},
})) as ServePlugin['addListener']

const networkPolicyStub = {
  setNetworkPolicy: async () => {},
  getNetworkPolicy: async () => ({ wifiOnly: false }),
} satisfies Pick<ServePlugin, 'setNetworkPolicy' | 'getNetworkPolicy'>

// ─── S1-T7: ServePlugin interface is structurally valid ─────────────────

describe('ServePlugin interface (S1-T7)', () => {
  it('listModels returns descriptors with statuses', async () => {
    const mock: ServePlugin = {
      listModels: async () => ({
        models: [
          {
            descriptor: {
              id: 'qwen3-0.6b',
              name: 'Qwen3 0.6B',
              format: ModelFormat.GGUF,
              sizeBytes: 350_000_000,
              version: '1.0.0',
              quantization: 'Q4_K_M',
            },
            status: { kind: 'notLoaded' },
          },
          {
            descriptor: {
              id: 'gemma-3n-e2b',
              name: 'Gemma 3n E2B',
              format: ModelFormat.GGUF,
              sizeBytes: 1_200_000_000,
              version: '1.0.0',
              quantization: 'Q4_K_M',
            },
            status: { kind: 'downloading', progress: 0.42 },
          },
        ],
      }),
      getModelStatus: async () => ({ status: { kind: 'notLoaded' } }),
      downloadModel: async () => {},
      cancelDownload: async () => {},
      ...networkPolicyStub,
      addListener: addListenerStub,
    }

    const result = await mock.listModels()
    expect(result.models).toHaveLength(2)
    expect(result.models[0].descriptor.id).toBe('qwen3-0.6b')
    expect(result.models[0].status.kind).toBe('notLoaded')
    expect(result.models[1].descriptor.id).toBe('gemma-3n-e2b')
    expect(result.models[1].status.kind).toBe('downloading')
  })

  it('getModelStatus returns status for given modelId', async () => {
    const mock: ServePlugin = {
      listModels: async () => ({ models: [] }),
      getModelStatus: async (options) => {
        expect(options.modelId).toBe('qwen3-0.6b')
        return { status: { kind: 'ready' } }
      },
      downloadModel: async () => {},
      cancelDownload: async () => {},
      ...networkPolicyStub,
      addListener: addListenerStub,
    }

    const result = await mock.getModelStatus({ modelId: 'qwen3-0.6b' })
    expect(result.status.kind).toBe('ready')
  })
})

// ─── S1-T2: Unknown model returns notLoaded (TS structural) ──────────────────

describe('Unknown model status (S1-T2)', () => {
  it('returns notLoaded for unknown model — not null, not error', async () => {
    const mock: ServePlugin = {
      listModels: async () => ({ models: [] }),
      getModelStatus: async () => ({ status: { kind: 'notLoaded' } }),
      downloadModel: async () => {},
      cancelDownload: async () => {},
      ...networkPolicyStub,
      addListener: addListenerStub,
    }

    const result = await mock.getModelStatus({ modelId: 'ghost' })
    expect(result.status).toBeDefined()
    expect(result.status.kind).toBe('notLoaded')
  })
})

// ─── ModelDescriptorWithStatus accepts all ModelStatus variants ───────────────

describe('ModelDescriptorWithStatus with all status variants', () => {
  const baseDescriptor: ModelDescriptor = {
    id: 'test-model',
    name: 'Test Model',
    format: ModelFormat.GGUF,
    sizeBytes: 500_000_000,
    version: '1.0.0',
  }

  const allStatuses: ModelStatus[] = [
    { kind: 'notLoaded' },
    { kind: 'downloading', progress: 0.5 },
    { kind: 'verifying' },
    { kind: 'loading' },
    { kind: 'ready' },
    { kind: 'failed', error: { code: 'downloadFailed', detail: 'network error' } },
    { kind: 'unloading' },
  ]

  for (const status of allStatuses) {
    it(`compiles with status kind: ${status.kind}`, () => {
      const item: ModelDescriptorWithStatus = {
        descriptor: baseDescriptor,
        status,
      }
      expect(item.descriptor.id).toBe('test-model')
      expect(item.status.kind).toBe(status.kind)
    })
  }
})

// ─── S1-T1: Register and retrieve descriptor — structural TS check ───────────

describe('ModelDescriptor fields (S1-T1 structural)', () => {
  it('all fields accessible on ModelDescriptor', () => {
    const d: ModelDescriptor = {
      id: 'qwen3-4b',
      name: 'Qwen3 4B SOTA',
      format: ModelFormat.GGUF,
      sizeBytes: 2_500_000_000,
      version: '2507',
      url: 'https://example.com/models/qwen3-4b.bin',
      sha256: 'deadbeef',
      quantization: 'Q4_K_M',
      metadata: { source: 'huggingface', family: 'qwen3' },
    }

    expect(d.id).toBe('qwen3-4b')
    expect(d.name).toBe('Qwen3 4B SOTA')
    expect(d.format).toBe('gguf')
    expect(d.sizeBytes).toBe(2_500_000_000)
    expect(d.version).toBe('2507')
    expect(d.url).toBe('https://example.com/models/qwen3-4b.bin')
    expect(d.sha256).toBe('deadbeef')
    expect(d.quantization).toBe('Q4_K_M')
    expect(d.metadata?.source).toBe('huggingface')
    expect(d.metadata?.family).toBe('qwen3')
  })

  it('optional fields can be undefined', () => {
    const d: ModelDescriptor = {
      id: 'minimal',
      name: 'Minimal',
      format: ModelFormat.ONNX,
      sizeBytes: 100,
      version: '1.0',
    }
    expect(d.url).toBeUndefined()
    expect(d.sha256).toBeUndefined()
    expect(d.quantization).toBeUndefined()
    expect(d.metadata).toBeUndefined()
  })
})

// ─── S1-T3: listModels returns all registered (structural) ───────────────────

describe('listModels returns all (S1-T3 structural)', () => {
  it('returns exactly 3 entries when 3 are provided', async () => {
    const models: ModelDescriptorWithStatus[] = [
      { descriptor: { id: 'a', name: 'A', format: ModelFormat.GGUF, sizeBytes: 100, version: '1' }, status: { kind: 'notLoaded' } },
      { descriptor: { id: 'b', name: 'B', format: ModelFormat.GGUF, sizeBytes: 200, version: '1' }, status: { kind: 'ready' } },
      { descriptor: { id: 'c', name: 'C', format: ModelFormat.GGUF, sizeBytes: 300, version: '1' }, status: { kind: 'loading' } },
    ]

    const mock: ServePlugin = {
      listModels: async () => ({ models }),
      getModelStatus: async () => ({ status: { kind: 'notLoaded' } }),
      downloadModel: async () => {},
      cancelDownload: async () => {},
      ...networkPolicyStub,
      addListener: addListenerStub,
    }

    const result = await mock.listModels()
    expect(result.models).toHaveLength(3)
    const ids = result.models.map((m) => m.descriptor.id)
    expect(ids).toContain('a')
    expect(ids).toContain('b')
    expect(ids).toContain('c')
  })
})

describe('S2 API additions', () => {
  it('downloadModel accepts modelId', async () => {
    const mock: ServePlugin = {
      listModels: async () => ({ models: [] }),
      getModelStatus: async () => ({ status: { kind: 'notLoaded' } }),
      downloadModel: async (options) => {
        expect(options.modelId).toBe('model-a')
      },
      cancelDownload: async () => {},
      ...networkPolicyStub,
      addListener: addListenerStub,
    }

    await expect(mock.downloadModel({ modelId: 'model-a' })).resolves.toBeUndefined()
  })

  it('cancelDownload exists and accepts modelId', async () => {
    const mock: ServePlugin = {
      listModels: async () => ({ models: [] }),
      getModelStatus: async () => ({ status: { kind: 'notLoaded' } }),
      downloadModel: async () => {},
      cancelDownload: async (options) => {
        expect(options.modelId).toBe('model-a')
      },
      ...networkPolicyStub,
      addListener: addListenerStub,
    }

    await expect(mock.cancelDownload({ modelId: 'model-a' })).resolves.toBeUndefined()
  })

  it('event listener overloads compile', async () => {
    const mock: ServePlugin = {
      listModels: async () => ({ models: [] }),
      getModelStatus: async () => ({ status: { kind: 'notLoaded' } }),
      downloadModel: async () => {},
      cancelDownload: async () => {},
      ...networkPolicyStub,
      addListener: addListenerStub,
    }

    const handles = await Promise.all([
      mock.addListener('sizeDisclosure', (event: SizeDisclosureEvent) => {
        expect(typeof event.sizeBytes).toBe('number')
      }),
      mock.addListener('modelProgress', (event: ModelProgressEvent) => {
        expect(typeof event.progress).toBe('number')
      }),
      mock.addListener('modelReady', (event: ModelReadyEvent) => {
        expect(typeof event.path).toBe('string')
      }),
      mock.addListener('modelFailed', (event: ModelFailedEvent) => {
        expect(event.error.code).toBeDefined()
      }),
    ])

    expect(handles).toHaveLength(4)
  })

  it('storageFull, verificationFailed, and networkPolicyBlocked errors compile', () => {
    const errors: DustCoreError[] = [
      { code: 'storageFull', detail: 'disk full' },
      { code: 'verificationFailed', detail: 'hash mismatch' },
      { code: 'networkPolicyBlocked', detail: 'wifi only' },
    ]

    expect(errors[0].code).toBe('storageFull')
    expect(errors[1].code).toBe('verificationFailed')
    expect(errors[2].code).toBe('networkPolicyBlocked')
  })

  it('setNetworkPolicy and getNetworkPolicy compile', async () => {
    const mock: ServePlugin = {
      listModels: async () => ({ models: [] }),
      getModelStatus: async () => ({ status: { kind: 'notLoaded' } }),
      downloadModel: async () => {},
      cancelDownload: async () => {},
      setNetworkPolicy: async (options) => {
        expect(options.wifiOnly).toBe(true)
      },
      getNetworkPolicy: async () => ({ wifiOnly: true }),
      addListener: addListenerStub,
    }

    await expect(mock.setNetworkPolicy({ wifiOnly: true })).resolves.toBeUndefined()
    await expect(mock.getNetworkPolicy()).resolves.toEqual({ wifiOnly: true })
  })
})
