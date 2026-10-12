export {}

declare global {
  interface Window {
    utterflow: {
      getSettings: () => Promise<UtterflowSettings>
      rendererReady: () => Promise<UtterflowSettings>
      saveSettings: (patch: Partial<UtterflowSettings>) => Promise<UtterflowSettings>
      saveApiKey: (key: string) => Promise<UtterflowSettings>
      removeApiKey: () => Promise<UtterflowSettings>
      selectVault: () => Promise<string | null>
      requestMicrophone: () => Promise<{ allowed: boolean; settings: UtterflowSettings }>
      requestInputMonitoring: () => Promise<UtterflowSettings>
      refreshPermissions: () => Promise<UtterflowSettings>
      openPrivacy: (category: 'microphone' | 'accessibility' | 'input') => Promise<void>
      pauseHotkey: () => Promise<void>
      resumeHotkey: () => Promise<void>
      getQueue: () => Promise<FailedCapture[]>
      retryFailed: () => Promise<void>
      openToday: () => Promise<void>
      revealQueue: () => Promise<void>
      quit: () => Promise<void>
      audioCompleted: (packet: { bytes: Uint8Array; mimeType: string }) => Promise<{ ok: boolean; message?: string; notePath?: string }>
      audioFailed: (message: string) => Promise<void>
      onRecordingStart: (callback: (data: CaptureSession) => void) => () => void
      onRecordingStop: (callback: (data: CaptureSession) => void) => () => void
      onSettingsLoaded: (callback: (data: UtterflowSettings) => void) => () => void
      onSettingsStatus: (callback: (data: UtterflowSettings) => void) => () => void
      onQueueUpdated: (callback: (data: FailedCapture[]) => void) => () => void
      onRecordingComplete: (callback: (data: RecordingResult) => void) => () => void
      onOverlayState: (callback: (data: OverlayState) => void) => () => void
    }
  }

  interface UtterflowSettings {
    vaultPath: string
    destinationFolder: string
    filenameFormat: string
    hotkey: { keyCode: number; keyLabel: string; modifiers: string[] }
    soundEnabled: boolean
    hasApiKey: boolean
    micStatus: string
    accessibilityStatus: string
    inputMonitoringStatus: string
    hotkeyStatus: string
    failedCount: number
    firstRun: boolean
    permissions?: { micStatus: string; axStatus: string; inputStatus: string }
  }
  interface CaptureSession {
    id: string
    startedAt: string
    selectedText: string | null
    sourceApplication: string | null
    language: string | null
    accessibilityTrusted: boolean
  }
  interface FailedCapture { id: string; endedAt: string; hasCode: boolean; error: string }
  interface RecordingResult { ok: boolean; message?: string; notePath?: string; hasCode?: boolean }
  interface OverlayState { state: 'idle' | 'listening' | 'thinking' | 'success' | 'error'; accessibilityTrusted: boolean }
}
