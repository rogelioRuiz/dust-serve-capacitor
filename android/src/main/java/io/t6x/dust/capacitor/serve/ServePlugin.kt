package io.t6x.dust.capacitor.serve

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import androidx.work.WorkManager
import io.t6x.dust.core.*
import io.t6x.dust.serve.*
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

@CapacitorPlugin(name = "Serve")
class ServePlugin : Plugin(), ModelServer {

    private val modelRegistry = ModelRegistry()
    private lateinit var postDownloadOrchestrator: PostDownloadOrchestrator
    private val pendingProbes = java.util.concurrent.CopyOnWriteArrayList<Pair<String, ModelStatus>>()
    private val stateStore = ModelStateStore(
        onStatusChange = { modelId, status ->
            if (::postDownloadOrchestrator.isInitialized) {
                postDownloadOrchestrator.onStatusChange(modelId, status)
            } else {
                pendingProbes.add(modelId to status)
            }
        },
    )
    private val downloadScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private val sessionManager by lazy {
        SessionManager(
            stateStore = stateStore,
            factory = StubModelSessionFactory(),
        )
    }
    private val probeResultStore: ProbeResultStore by lazy {
        SharedPreferencesProbeResultStore(
            context.getSharedPreferences(
                SharedPreferencesProbeResultStore.PREFERENCES_NAME,
                android.content.Context.MODE_PRIVATE,
            ),
        )
    }
    private val probeEngine: ProbeInferenceEngine = StubProbeInferenceEngine()
    private val networkPolicyProvider by lazy { SystemNetworkPolicyProvider(context) }
    private val downloadManager by lazy {
        DownloadManager(
            dataSource = HttpDownloadDataSource(),
            stateStore = stateStore,
            networkPolicyProvider = networkPolicyProvider,
            diskSpaceProvider = SystemDiskSpaceProvider(),
            baseDir = context.filesDir,
            eventEmitter = { eventName, payload -> notifyListeners(eventName, mapToJSObject(payload)) },
        )
    }
    private val downloadCoordinator by lazy {
        WorkManagerDownloadCoordinator(
            workManager = WorkManager.getInstance(context),
            scope = downloadScope,
            stateStore = stateStore,
            baseDir = context.filesDir,
            networkPolicyProvider = networkPolicyProvider,
            isWifiOnlyEnabled = {
                context.getSharedPreferences(
                    SystemNetworkPolicyProvider.PREFERENCES_NAME,
                    android.content.Context.MODE_PRIVATE,
                ).getBoolean(SystemNetworkPolicyProvider.WIFI_ONLY_KEY, false)
            },
            eventEmitter = { eventName, payload -> notifyListeners(eventName, mapToJSObject(payload)) },
        )
    }
    private var memoryCallback: android.content.ComponentCallbacks2? = null

    override fun load() {
        postDownloadOrchestrator = PostDownloadOrchestrator(
            probe = AcceleratorProbe(engine = probeEngine, store = probeResultStore),
            benchmark = DeviceBenchmark(engine = probeEngine, store = probeResultStore),
            descriptorProvider = { id -> modelRegistry.getDescriptor(id) },
            baseDir = context.filesDir,
            scope = downloadScope,
        )
        val pending = pendingProbes.toList()
        pendingProbes.clear()
        for ((modelId, status) in pending) {
            postDownloadOrchestrator.onStatusChange(modelId, status)
        }
        DustCoreRegistry.getInstance().registerModelServer(this)
        downloadScope.launch {
            val activeIds = downloadCoordinator.reconnectActiveDownloads { id ->
                modelRegistry.getDescriptor(id)
            }
            downloadManager.cleanupStalePartFiles(activeModelIds = activeIds)
        }
        memoryCallback = object : android.content.ComponentCallbacks2 {
            @Suppress("DEPRECATION")
            override fun onTrimMemory(level: Int) {
                val pressureLevel = when {
                    level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL ->
                        MemoryPressureLevel.CRITICAL
                    level >= android.content.ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW ->
                        MemoryPressureLevel.STANDARD
                    else -> return
                }

                downloadScope.launch {
                    sessionManager.evictUnderPressure(pressureLevel)
                }
            }

            override fun onConfigurationChanged(newConfig: android.content.res.Configuration) {}

            override fun onLowMemory() {}
        }
        context.applicationContext.registerComponentCallbacks(memoryCallback)
    }

    override fun handleOnDestroy() {
        super.handleOnDestroy()
        downloadScope.cancel()
        memoryCallback?.let { callback: android.content.ComponentCallbacks2 ->
            context.applicationContext.unregisterComponentCallbacks(callback)
        }
        memoryCallback = null
    }

    // ── Native API (called by task plugins, not JS) ──────────────────────────

    /** Registers a model descriptor and restores Ready state if the model file already exists. */
    fun register(descriptor: ModelDescriptor) {
        modelRegistry.register(descriptor)
        val finalFile = java.io.File(java.io.File(java.io.File(context.filesDir, "models"), descriptor.id), "${descriptor.id}.bin")
        if (finalFile.exists()) {
            stateStore.updateState(descriptor.id) {
                status = ModelStatus.Ready
                filePath = finalFile.absolutePath
            }
        } else if (downloadCoordinator.isActive(descriptor.id)) {
            stateStore.setStatus(descriptor.id, ModelStatus.Downloading(0f))
        } else {
            stateStore.setStatus(descriptor.id, ModelStatus.NotLoaded)
        }
    }

    fun getDeviceTier(): DeviceTier? = probeResultStore.getDeviceTier()

    /** Injects the session factory from a task plugin (e.g. LLMPlugin, ONNXPlugin). */
    fun setSessionFactory(factory: ModelSessionFactory) {
        sessionManager.setFactory(factory)
    }

    // ── JS Bridge ────────────────────────────────────────────────────────────

    @PluginMethod
    fun registerModel(call: PluginCall) {
        val descriptorObj = call.getObject("descriptor")
        val id = descriptorObj?.getString("id")
        val name = descriptorObj?.getString("name")
        val formatStr = descriptorObj?.getString("format")
        val sizeBytes = descriptorObj?.getLong("sizeBytes")
        val version = descriptorObj?.getString("version")

        if (id.isNullOrEmpty() || name.isNullOrEmpty() || formatStr.isNullOrEmpty() || sizeBytes == null || version.isNullOrEmpty()) {
            call.reject("descriptor.id, name, format, sizeBytes, and version are required")
            return
        }
        val format = ModelFormat.fromValue(formatStr)
        if (format == null) {
            call.reject("Unknown format: $formatStr")
            return
        }
        val url = descriptorObj.getString("url")
        val sha256 = descriptorObj.getString("sha256")
        val quantization = descriptorObj.getString("quantization")
        val metaObj = descriptorObj.getJSObject("metadata")
        val metadata: Map<String, String>? = metaObj?.let { obj ->
            val map = mutableMapOf<String, String>()
            obj.keys().forEach { k -> obj.getString(k)?.let { v -> map[k] = v } }
            map.ifEmpty { null }
        }
        val descriptor = ModelDescriptor(
            id = id,
            name = name,
            format = format,
            sizeBytes = sizeBytes,
            version = version,
            url = url,
            sha256 = sha256,
            quantization = quantization,
            metadata = metadata,
        )
        register(descriptor)
        call.resolve()
    }

    // ── ModelServer interface conformance ────────────────────────────────────

    override suspend fun loadModel(descriptor: ModelDescriptor, priority: SessionPriority): ModelSession {
        if (modelRegistry.getDescriptor(descriptor.id) == null) {
            throw DustCoreError.ModelNotFound
        }

        return sessionManager.loadModel(descriptor, priority)
    }

    override suspend fun unloadModel(id: String) {
        sessionManager.unloadModel(id)
    }

    override suspend fun listModels(): List<ModelDescriptor> {
        return modelRegistry.allDescriptors()
    }

    override suspend fun modelStatus(id: String): ModelStatus {
        return stateStore.getStatus(id)
    }

    @PluginMethod
    fun listModels(call: PluginCall) {
        val descriptors = modelRegistry.allDescriptors()
        val models = JSArray()
        for (descriptor in descriptors) {
            val item = JSObject()
            item.put("descriptor", descriptor.toJSObject())
            item.put("status", stateStore.getStatus(descriptor.id).toJSObject())
            models.put(item)
        }
        val result = JSObject()
        result.put("models", models)
        call.resolve(result)
    }

    @PluginMethod
    fun getModelStatus(call: PluginCall) {
        val modelId = call.getString("modelId")
        if (modelId == null) {
            call.reject("modelId is required")
            return
        }
        val state = stateStore.getState(modelId)
        val statusObj = (state?.status ?: ModelStatus.NotLoaded).toJSObject()
        state?.filePath?.let { statusObj.put("path", it) }
        val result = JSObject()
        result.put("status", statusObj)
        call.resolve(result)
    }

    @PluginMethod
    fun downloadModel(call: PluginCall) {
        val modelId = call.getString("modelId")
        if (modelId == null) {
            call.reject("modelId is required")
            return
        }

        val descriptor = modelRegistry.getDescriptor(modelId)
        if (descriptor == null) {
            call.reject("Model not found")
            return
        }

        downloadCoordinator.download(descriptor)
        call.resolve()
    }

    @PluginMethod
    fun cancelDownload(call: PluginCall) {
        val modelId = call.getString("modelId")
        if (modelId == null) {
            call.reject("modelId is required")
            return
        }

        downloadCoordinator.cancelDownload(modelId)
        call.resolve()
    }

    @PluginMethod
    fun setNetworkPolicy(call: PluginCall) {
        val wifiOnly = call.getBoolean("wifiOnly") ?: false
        context.getSharedPreferences(
            SystemNetworkPolicyProvider.PREFERENCES_NAME,
            android.content.Context.MODE_PRIVATE,
        ).edit().putBoolean(SystemNetworkPolicyProvider.WIFI_ONLY_KEY, wifiOnly).apply()
        call.resolve()
    }

    @PluginMethod
    fun getNetworkPolicy(call: PluginCall) {
        val result = JSObject()
        result.put(
            "wifiOnly",
            context.getSharedPreferences(
                SystemNetworkPolicyProvider.PREFERENCES_NAME,
                android.content.Context.MODE_PRIVATE,
            ).getBoolean(SystemNetworkPolicyProvider.WIFI_ONLY_KEY, false),
        )
        call.resolve(result)
    }
}

// ── Serialization helpers ────────────────────────────────────────────────────

fun ModelDescriptor.toJSObject(): JSObject {
    val obj = JSObject()
    obj.put("id", id)
    obj.put("name", name)
    obj.put("format", format.value)
    obj.put("sizeBytes", sizeBytes)
    obj.put("version", version)
    url?.let { obj.put("url", it) }
    sha256?.let { obj.put("sha256", it) }
    quantization?.let { obj.put("quantization", it) }
    metadata?.let { meta ->
        val metaObj = JSObject()
        for ((k, v) in meta) {
            metaObj.put(k, v)
        }
        obj.put("metadata", metaObj)
    }
    return obj
}

fun ModelStatus.toJSObject(): JSObject {
    val obj = JSObject()
    when (this) {
        is ModelStatus.NotLoaded -> obj.put("kind", "notLoaded")
        is ModelStatus.Downloading -> {
            obj.put("kind", "downloading")
            obj.put("progress", progress.toDouble())
        }
        is ModelStatus.Verifying -> obj.put("kind", "verifying")
        is ModelStatus.Loading -> obj.put("kind", "loading")
        is ModelStatus.Ready -> obj.put("kind", "ready")
        is ModelStatus.Failed -> {
            obj.put("kind", "failed")
            obj.put("error", error.toJSObject())
        }
        is ModelStatus.Unloading -> obj.put("kind", "unloading")
    }
    return obj
}

fun mapToJSObject(map: Map<String, Any?>): JSObject {
    val obj = JSObject()
    for ((k, v) in map) {
        when (v) {
            is Map<*, *> -> obj.put(k, mapToJSObject(@Suppress("UNCHECKED_CAST") (v as Map<String, Any?>)))
            else -> obj.put(k, v)
        }
    }
    return obj
}

fun DustCoreError.toJSObject(): JSObject {
    val obj = JSObject()
    when (this) {
        is DustCoreError.ModelNotFound -> obj.put("code", "modelNotFound")
        is DustCoreError.ModelNotReady -> obj.put("code", "modelNotReady")
        is DustCoreError.ModelCorrupted -> obj.put("code", "modelCorrupted")
        is DustCoreError.FormatUnsupported -> obj.put("code", "formatUnsupported")
        is DustCoreError.SessionClosed -> obj.put("code", "sessionClosed")
        is DustCoreError.SessionLimitReached -> obj.put("code", "sessionLimitReached")
        is DustCoreError.InvalidInput -> {
            obj.put("code", "invalidInput")
            detail?.let { obj.put("detail", it) }
        }
        is DustCoreError.InferenceFailed -> {
            obj.put("code", "inferenceFailed")
            detail?.let { obj.put("detail", it) }
        }
        is DustCoreError.MemoryExhausted -> obj.put("code", "memoryExhausted")
        is DustCoreError.DownloadFailed -> {
            obj.put("code", "downloadFailed")
            detail?.let { obj.put("detail", it) }
        }
        is DustCoreError.StorageFull -> {
            obj.put("code", "storageFull")
            detail?.let { obj.put("detail", it) }
        }
        is DustCoreError.NetworkPolicyBlocked -> {
            obj.put("code", "networkPolicyBlocked")
            detail?.let { obj.put("detail", it) }
        }
        is DustCoreError.VerificationFailed -> {
            obj.put("code", "verificationFailed")
            detail?.let { obj.put("detail", it) }
        }
        is DustCoreError.Cancelled -> obj.put("code", "cancelled")
        is DustCoreError.Timeout -> obj.put("code", "timeout")
        is DustCoreError.ServiceNotRegistered -> {
            obj.put("code", "serviceNotRegistered")
            obj.put("serviceName", serviceName)
        }
        is DustCoreError.UnknownError -> {
            obj.put("code", "unknownError")
            errorMessage?.let { obj.put("message", it) }
        }
    }
    return obj
}
