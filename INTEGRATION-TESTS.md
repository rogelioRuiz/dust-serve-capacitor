# Integration Test Checklist

Pre-release device verification for background download resilience. These tests cover functionality implemented in `dust-serve-kotlin` (WorkManager) and `dust-serve-swift` (URLSession background config), exercised through the `capacitor-serve` bridge on a real device.

Each item must be confirmed on a real device (or representative simulator with background capabilities) before any public release. Do not mark an item as passing until on-device results confirm it.

## S3 — Background Download, Kill/Resume, Network Resume

### S3-T1: iOS background download survives app suspension

- [ ] **Verified on device**

**Steps:**
1. Start a large model download (>100 MB recommended)
2. Wait for progress to reach ~30%
3. Suspend the app (press Home / swipe up)
4. Wait 30+ seconds
5. Return to the app

**Expected:** Download continued in the background. Progress is >= what it was at suspension. `modelReady` event fires once download completes.

**What to check:**
- `BackgroundDownloadEngine` uses `URLSessionConfiguration.background(withIdentifier:)`
- `URLSessionDownloadDelegate.urlSession(_:downloadTask:didFinishDownloadingTo:)` fires even if app was suspended
- Final file passes SHA-256 verification

---

### S3-T2: Android WorkManager download survives process kill

- [ ] **Verified on device**

**Steps:**
1. Start a large model download (>100 MB recommended)
2. Wait for progress to reach ~30%
3. Force-kill the app process (`adb shell am force-stop <package>`)
4. Relaunch the app

**Expected:** WorkManager re-enqueues the download automatically. Download resumes (does not restart from zero if server supports Range headers). `modelProgress` events resume and `modelReady` fires on completion.

**What to check:**
- `WorkManagerDownloadCoordinator` enqueues with `ExistingWorkPolicy.KEEP`
- `ModelDownloadWorker` sends `Range: bytes=<offset>-` header on resume
- HTTP 206 Partial Content is handled correctly (appends to `.part` file)
- Final file passes SHA-256 verification

---

### S3-T3: Network interruption mid-download resumes from last byte

- [ ] **Verified on device** (iOS)
- [ ] **Verified on device** (Android)

**Steps:**
1. Start a large model download
2. Wait for progress to reach ~30%
3. Toggle airplane mode ON for 10 seconds
4. Toggle airplane mode OFF

**Expected:** Download resumes from the last received byte, not from zero. Total downloaded bytes is monotonically increasing (no reset). `modelReady` fires on completion.

**What to check:**
- iOS: `BackgroundDownloadEngine` stores resume data via `urlSession(_:task:didCompleteWithError:)` using `NSURLSessionDownloadTaskResumeData`
- Android: `ModelDownloadWorker` checks `.part` file length and sets `Range` header on retry
- Server must support HTTP Range requests (return 206). If server returns 200 instead of 206, both platforms correctly restart from zero (not a failure, just no resume)
