import { describe, expect, it } from 'vitest'
import { ModelFormat, SessionPriority } from '@dust/capacitor-core'
import type {
  DustCoreError,
  ModelDescriptor,
  ModelServer,
  ModelSession,
  ModelStatus,
} from '@dust/capacitor-core'

describe('S4 session lifecycle types', () => {
  it('S4-TS1: modelNotReady is a valid DustCoreError', () => {
    const error: DustCoreError = { code: 'modelNotReady' }
    expect(error.code).toBe('modelNotReady')
  })

  it('S4-TS2: ModelServer.loadModel returns ModelSession', async () => {
    const descriptor: ModelDescriptor = {
      id: 'model-a',
      name: 'Model A',
      format: ModelFormat.GGUF,
      sizeBytes: 1_024,
      version: '1.0.0',
    }

    const expectedSession: ModelSession = {
      predict: async () => [],
      status: () => ({ kind: 'ready' }),
      priority: () => SessionPriority.Interactive,
      close: async () => {},
    }

    const modelServer: ModelServer = {
      loadModel: async () => expectedSession,
      unloadModel: async () => {},
      listModels: async () => [],
      modelStatus: async () => ({ kind: 'ready' }),
    }

    const session = await modelServer.loadModel(descriptor, SessionPriority.Interactive)
    expect(session).toBe(expectedSession)
    expect(session.priority()).toBe(SessionPriority.Interactive)
  })

  it('S4-TS3: modelNotReady compiles inside failed ModelStatus', () => {
    const status: ModelStatus = {
      kind: 'failed',
      error: { code: 'modelNotReady' },
    }

    expect(status.kind).toBe('failed')
    if (status.kind === 'failed') {
      expect(status.error.code).toBe('modelNotReady')
    }
  })
})
