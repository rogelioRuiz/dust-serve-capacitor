import { registerPlugin, WebPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

import type {
  ModelFailedEvent,
  ModelProgressEvent,
  ModelReadyEvent,
  ServePlugin,
  NetworkPolicy,
  SizeDisclosureEvent,
} from './definitions'

class ServeWeb extends WebPlugin implements ServePlugin {
  async listModels(): Promise<{ models: [] }> {
    return { models: [] }
  }

  async getModelStatus(_options: { modelId: string }): Promise<{ status: { kind: 'notLoaded' } }> {
    return { status: { kind: 'notLoaded' } }
  }

  async downloadModel(_options: { modelId: string }): Promise<void> {
    throw this.unimplemented('downloadModel is not supported on web')
  }

  async cancelDownload(_options: { modelId: string }): Promise<void> {
    throw this.unimplemented('cancelDownload is not supported on web')
  }

  async setNetworkPolicy(_options: NetworkPolicy): Promise<void> {
    throw this.unimplemented('setNetworkPolicy is not supported on web')
  }

  async getNetworkPolicy(): Promise<NetworkPolicy> {
    return { wifiOnly: false }
  }

  async addListener(
    eventName: 'sizeDisclosure',
    listenerFunc: (event: SizeDisclosureEvent) => void,
  ): Promise<PluginListenerHandle>
  async addListener(
    eventName: 'modelProgress',
    listenerFunc: (event: ModelProgressEvent) => void,
  ): Promise<PluginListenerHandle>
  async addListener(
    eventName: 'modelReady',
    listenerFunc: (event: ModelReadyEvent) => void,
  ): Promise<PluginListenerHandle>
  async addListener(
    eventName: 'modelFailed',
    listenerFunc: (event: ModelFailedEvent) => void,
  ): Promise<PluginListenerHandle>
  async addListener(eventName: string, listenerFunc: (event: any) => void): Promise<PluginListenerHandle> {
    return super.addListener(eventName, listenerFunc)
  }
}

export const Serve = registerPlugin<ServePlugin>('Serve', {
  web: () => Promise.resolve(new ServeWeb()),
})
