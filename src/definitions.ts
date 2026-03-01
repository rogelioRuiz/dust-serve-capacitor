import type { PluginListenerHandle } from '@capacitor/core'
import type { DustCoreError, ModelDescriptor, ModelStatus } from '@dust/capacitor-core'

// ─── Composite types ─────────────────────────────────────────────────────────

export interface ModelDescriptorWithStatus {
  descriptor: ModelDescriptor
  status: ModelStatus
}

export interface SizeDisclosureEvent {
  modelId: string
  sizeBytes: number
}

export interface ModelProgressEvent {
  modelId: string
  progress: number
  bytesDownloaded: number
  totalBytes?: number
}

export interface ModelReadyEvent {
  modelId: string
  path: string
}

export interface ModelFailedEvent {
  modelId: string
  error: DustCoreError
}

export interface NetworkPolicy {
  wifiOnly: boolean
}

// ─── Capacitor Plugin Interface (S2 scope) ───────────────────────────────────

export interface ServePlugin {
  listModels(): Promise<{ models: ModelDescriptorWithStatus[] }>
  getModelStatus(options: { modelId: string }): Promise<{ status: ModelStatus }>
  downloadModel(options: { modelId: string }): Promise<void>
  cancelDownload(options: { modelId: string }): Promise<void>
  setNetworkPolicy(options: NetworkPolicy): Promise<void>
  getNetworkPolicy(): Promise<NetworkPolicy>
  addListener(
    eventName: 'sizeDisclosure',
    handler: (event: SizeDisclosureEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'modelProgress',
    handler: (event: ModelProgressEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'modelReady',
    handler: (event: ModelReadyEvent) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    eventName: 'modelFailed',
    handler: (event: ModelFailedEvent) => void,
  ): Promise<PluginListenerHandle>
}
