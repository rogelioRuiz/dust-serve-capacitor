import Foundation
import Capacitor
import DustCore
import DustServe
import UIKit

@objc(ServePlugin)
public class ServePlugin: CAPPlugin, CAPBridgedPlugin, DustModelServer {
    public let identifier = "ServePlugin"
    public let jsName = "Serve"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "listModels", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getModelStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "downloadModel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "cancelDownload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setNetworkPolicy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getNetworkPolicy", returnType: CAPPluginReturnPromise),
    ]

    private let modelRegistry = ModelRegistry()
    private let stateStore = ModelStateStore()
    private let userDefaults = UserDefaults.standard
    private lazy var sessionManager = SessionManager(
        stateStore: stateStore,
        factory: StubModelSessionFactory()
    )
    private lazy var baseDirectory: URL = FileManager.default.urls(
        for: .applicationSupportDirectory,
        in: .userDomainMask
    ).first ?? FileManager.default.temporaryDirectory
    private lazy var networkPolicyProvider = SystemNetworkPolicyProvider(userDefaults: userDefaults)
    private lazy var backgroundDownloadEngine = BackgroundDownloadEngine(
        resumeDataDirectory: baseDirectory.appendingPathComponent("modelserver-resume", isDirectory: true)
    )
    private lazy var downloadManager = makeDownloadManager(
        dataSource: backgroundDownloadEngine,
        networkPolicyProvider: networkPolicyProvider,
        diskSpaceProvider: SystemDiskSpaceProvider()
    )

    // MARK: - Lifecycle

    public override func load() {
        DustCoreRegistry.shared.register(modelServer: self)
        _ = downloadManager
        downloadManager.cleanupStalePartFiles()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleMemoryWarning),
            name: UIApplication.didReceiveMemoryWarningNotification,
            object: nil
        )
    }

    // MARK: - Native API (called by task plugins, not JS)

    /// Registers a model descriptor and initialises its state to `.notLoaded`.
    public func register(descriptor: DustModelDescriptor) {
        modelRegistry.register(descriptor: descriptor)
        stateStore.setStatus(.notLoaded, for: descriptor.id)
    }

    // MARK: - DustModelServer conformance

    public func loadModel(
        descriptor: DustModelDescriptor,
        priority: DustSessionPriority
    ) async throws -> any DustModelSession {
        guard modelRegistry.descriptor(for: descriptor.id) != nil else {
            throw DustCoreError.modelNotFound
        }

        return try await sessionManager.loadModel(descriptor: descriptor, priority: priority)
    }

    public func unloadModel(id: String) async throws {
        try await sessionManager.unloadModel(id: id)
    }

    public func listModels() async throws -> [DustModelDescriptor] {
        modelRegistry.allDescriptors()
    }

    public func modelStatus(id: String) async throws -> DustModelStatus {
        stateStore.status(for: id)
    }

    // MARK: - JS Bridge

    @objc func listModels(_ call: CAPPluginCall) {
        let descriptors = modelRegistry.allDescriptors()
        let models: [[String: Any]] = descriptors.map { descriptor in
            let status = stateStore.status(for: descriptor.id)
            return [
                "descriptor": descriptor.toJSObject(),
                "status": status.toJSObject(),
            ]
        }
        call.resolve(["models": models])
    }

    @objc func getModelStatus(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else {
            call.reject("modelId is required")
            return
        }
        let status = stateStore.status(for: modelId)
        call.resolve(["status": status.toJSObject()])
    }

    @objc func downloadModel(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else {
            call.reject("modelId is required")
            return
        }

        guard let descriptor = modelRegistry.descriptor(for: modelId) else {
            call.reject("Model not found")
            return
        }

        _ = downloadManager.download(descriptor)
        call.resolve()
    }

    @objc func cancelDownload(_ call: CAPPluginCall) {
        guard let modelId = call.getString("modelId") else {
            call.reject("modelId is required")
            return
        }

        downloadManager.cancelDownload(modelId: modelId)
        call.resolve()
    }

    @objc func setNetworkPolicy(_ call: CAPPluginCall) {
        let wifiOnly = call.getBool("wifiOnly") ?? false
        userDefaults.set(wifiOnly, forKey: SystemNetworkPolicyProvider.wifiOnlyDefaultsKey)
        call.resolve()
    }

    @objc func getNetworkPolicy(_ call: CAPPluginCall) {
        call.resolve([
            "wifiOnly": userDefaults.bool(forKey: SystemNetworkPolicyProvider.wifiOnlyDefaultsKey),
        ])
    }

    public func handleBackgroundSession(completionHandler: @escaping () -> Void) {
        backgroundDownloadEngine.handleBackgroundSession(completionHandler: completionHandler)
    }

    // Deliberate deviation from Android: iOS uses .critical for all memory warnings.
    // Android's onTrimMemory provides graduated levels (RUNNING_LOW → .standard,
    // RUNNING_CRITICAL → .critical), but iOS delivers didReceiveMemoryWarningNotification
    // as a single, late-stage signal — by the time it fires, the system is already under
    // significant pressure. Aggressive eviction (all zero-refcount sessions regardless of
    // priority) is the appropriate response here.
    @objc private func handleMemoryWarning() {
        Task {
            await sessionManager.evictUnderPressure(level: .critical)
        }
    }

    internal func makeDownloadManager(
        dataSource: DownloadDataSource,
        networkPolicyProvider: NetworkPolicyProvider,
        diskSpaceProvider: DiskSpaceProvider,
        baseDirectory: URL? = nil
    ) -> DownloadManager {
        let resolvedBaseDirectory = baseDirectory ?? self.baseDirectory

        return DownloadManager(
            dataSource: dataSource,
            stateStore: stateStore,
            networkPolicyProvider: networkPolicyProvider,
            diskSpaceProvider: diskSpaceProvider,
            baseDirectory: resolvedBaseDirectory,
            eventEmitter: { [weak self] eventName, payload in
                DispatchQueue.main.async {
                    self?.notifyListeners(eventName, data: payload)
                }
            }
        )
    }
}

// MARK: - Serialization helpers

extension DustModelDescriptor {
    func toJSObject() -> [String: Any] {
        var obj: [String: Any] = [
            "id": id,
            "name": name,
            "format": format.rawValue,
            "sizeBytes": sizeBytes,
            "version": version,
        ]
        if let url { obj["url"] = url }
        if let sha256 { obj["sha256"] = sha256 }
        if let q = quantization { obj["quantization"] = q }
        if let m = metadata { obj["metadata"] = m }
        return obj
    }
}

extension DustModelStatus {
    func toJSObject() -> [String: Any] {
        switch self {
        case .notLoaded:
            return ["kind": "notLoaded"]
        case .downloading(let progress):
            return ["kind": "downloading", "progress": progress]
        case .verifying:
            return ["kind": "verifying"]
        case .loading:
            return ["kind": "loading"]
        case .ready:
            return ["kind": "ready"]
        case .failed(let error):
            return ["kind": "failed", "error": error.toJSObject()]
        case .unloading:
            return ["kind": "unloading"]
        }
    }
}

extension DustCoreError {
    func toJSObject() -> [String: Any] {
        toDict()
    }
}
