import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, FolderOpen, Headphones, Keyboard, Mic, RotateCw, Settings2, ShieldCheck, Volume2, X } from 'lucide-react'
import './App.css'

const emptySettings: UtterflowSettings = {
  vaultPath: '', destinationFolder: 'AI Engineering/Daily Learning', filenameFormat: 'YYYY-MM-DD.md',
  hotkey: { keyCode: 49, keyLabel: 'Space', modifiers: ['control', 'shift', 'option'] },
  soundEnabled: true, hasApiKey: false, micStatus: 'unknown', accessibilityStatus: 'unknown',
  inputMonitoringStatus: 'unknown', hotkeyStatus: 'Starting global shortcut…', failedCount: 0, firstRun: true,
}

const keyCodes: Record<string, number> = {
  KeyA: 0, KeyS: 1, KeyD: 2, KeyF: 3, KeyH: 4, KeyG: 5, KeyZ: 6, KeyX: 7, KeyC: 8, KeyV: 9, KeyB: 11,
  KeyQ: 12, KeyW: 13, KeyE: 14, KeyR: 15, KeyY: 16, KeyT: 17, Digit1: 18, Digit2: 19, Digit3: 20,
  Digit4: 21, Digit6: 22, Digit5: 23, Equal: 24, Digit9: 25, Digit7: 26, Minus: 27, Digit8: 28, Digit0: 29,
  BracketRight: 30, KeyO: 31, KeyU: 32, BracketLeft: 33, KeyI: 34, KeyP: 35, KeyL: 37, KeyJ: 38, Quote: 39,
  KeyK: 40, Semicolon: 41, Backslash: 42, Comma: 43, Slash: 44, KeyN: 45, KeyM: 46, Period: 47,
  Tab: 48, Space: 49, Backquote: 50, Backspace: 51, Escape: 53, F1: 122, F2: 120, F3: 99, F4: 118,
  F5: 96, F6: 97, F7: 98, F8: 100, F9: 101, F10: 109, F11: 103, F12: 111,
}
const modifierOrder = ['control', 'option', 'shift', 'command']
const modifierSymbols: Record<string, string> = { control: '⌃', option: '⌥', shift: '⇧', command: '⌘' }

function shortcutLabel(hotkey: UtterflowSettings['hotkey']) {
  return [...hotkey.modifiers].sort((a, b) => modifierOrder.indexOf(a) - modifierOrder.indexOf(b)).map(key => modifierSymbols[key] || key).concat(hotkey.keyLabel).join(' ')
}
function friendlyStatus(status: string) {
  if (status === 'granted' || status === 'authorized') return 'Ready'
  if (status === 'denied' || status === 'restricted') return 'Blocked'
  if (status === 'needed') return 'Needs access'
  return 'Check access'
}
function languageLabel(language: string | null) { return language ? language.toUpperCase() : 'CODE' }

const loadPersona = () => import('./components/ai-elements/persona').then(({ Persona }) => ({ default: Persona }))
const Persona = lazy(loadPersona)

function App() {
  const overlay = new URLSearchParams(window.location.search).get('view') === 'overlay'
  useEffect(() => { if (overlay === false) void loadPersona().catch(() => {}) }, [overlay])
  return overlay ? <ListeningOverlay /> : <SettingsWindow />
}

function ListeningOverlay() {
  const [state, setState] = useState<OverlayState>({ state: 'idle', accessibilityTrusted: true })
  const [riveFailed, setRiveFailed] = useState(false)
  useEffect(() => window.utterflow.onOverlayState(setState), [])
  const copy = state.state === 'thinking' ? 'Transcribing' : state.state === 'success' ? 'Added to note' : state.state === 'error' ? 'Saved for retry' : 'Listening'
  return (
    <main className="overlay-root" aria-label={copy}>
      <div className={`cursor-pod ${state.state}`}>
        {!riveFailed ? <Suspense fallback={<div className="fallback-orb"><i /><i /><i /></div>}><Persona variant="obsidian" state={state.state === 'thinking' ? 'thinking' : state.state === 'success' ? 'speaking' : 'listening'} onLoadError={() => setRiveFailed(true)} className="persona-canvas" /></Suspense> : <div className="fallback-orb"><i /><i /><i /></div>}
        <div className="overlay-caption"><span className={`status-dot ${state.state}`} /><span>{copy}</span></div>
        {!state.accessibilityTrusted && state.state === 'listening' && <span className="overlay-hint">Access needed for code capture</span>}
      </div>
    </main>
  )
}

function SettingsWindow() {
  const [settings, setSettings] = useState(emptySettings)
  const [loaded, setLoaded] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [armed, setArmed] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')
  const [recordingLabel, setRecordingLabel] = useState('')
  const [failedCaptures, setFailedCaptures] = useState<FailedCapture[]>([])
  const [micBusy, setMicBusy] = useState(false)
  const [showSetup, setShowSetup] = useState(true)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const stopRequestedRef = useRef(false)
  const recordingStartedAtRef = useRef(0)
  const sessionRef = useRef<CaptureSession | null>(null)
  const activeRef = useRef(false)
  const rendererReadyRef = useRef(false)

  const updateSettings = useCallback((patch: Partial<UtterflowSettings>) => {
    setSettings(current => ({ ...current, ...patch, hotkey: patch.hotkey ? patch.hotkey : current.hotkey }))
  }, [])

  const failRecording = useCallback(async (message: string) => {
    activeRef.current = false
    sessionRef.current = null
    stopRequestedRef.current = false
    recorderRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    await window.utterflow.audioFailed(message)
  }, [])

  const finishRecording = useCallback(async (recorder: MediaRecorder) => {
    const session = sessionRef.current
    const stream = streamRef.current
    recorderRef.current = null
    stream?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    activeRef.current = false
    stopRequestedRef.current = false
    setRecordingLabel('Transcribing and adding your note…')
    if (Date.now() - recordingStartedAtRef.current < 250) {
      await failRecording('That hold was too short to capture speech. Try holding the shortcut a little longer.')
      return
    }
    const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
    chunksRef.current = []
    if (!blob.size || !session) {
      await failRecording('No audio was captured. Please try again.')
      return
    }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    await window.utterflow.audioCompleted({ bytes, mimeType: blob.type || 'audio/webm' })
  }, [failRecording])

  const stopRecording = useCallback(() => {
    if (!activeRef.current) return
    stopRequestedRef.current = true
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
  }, [])

  const beginRecording = useCallback(async (session: CaptureSession) => {
    if (activeRef.current) return
    sessionRef.current = session
    activeRef.current = true
    stopRequestedRef.current = false
    setRecordingLabel(session.selectedText ? `Listening · ${languageLabel(session.language)}` : 'Listening · voice note')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable in this app window.')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      if (!activeRef.current) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = event => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onerror = () => { void failRecording('The microphone stopped unexpectedly. Try the shortcut again.') }
      recorder.onstop = () => { void finishRecording(recorder) }
      recorder.start(180)
      recordingStartedAtRef.current = Date.now()
      if (stopRequestedRef.current) recorder.stop()
    } catch (error) {
      await failRecording(error instanceof Error ? error.message : 'Microphone access was blocked.')
    }
  }, [failRecording, finishRecording])

  useEffect(() => {
    const offStart = window.utterflow.onRecordingStart(session => { void beginRecording(session) })
    const offStop = window.utterflow.onRecordingStop(() => stopRecording())
    const offLoaded = window.utterflow.onSettingsLoaded(value => { updateSettings(value); setLoaded(true) })
    const offStatus = window.utterflow.onSettingsStatus(updateSettings)
    const offQueue = window.utterflow.onQueueUpdated(setFailedCaptures)
    const offComplete = window.utterflow.onRecordingComplete(result => {
      setRecordingLabel('')
      setSavedMessage(result.ok ? (result.hasCode ? 'Code + explanation added' : 'Transcript added') : (result.message || 'Saved locally for retry'))
      void window.utterflow.getQueue().then(setFailedCaptures)
      window.setTimeout(() => setSavedMessage(''), 5000)
    })
    if (rendererReadyRef.current === false) {
      rendererReadyRef.current = true
      void window.utterflow.rendererReady().then(value => { updateSettings(value); setLoaded(true) }).catch(() => {
        void window.utterflow.getSettings().then(value => { updateSettings(value); setLoaded(true) }).catch(() => setLoaded(true))
      })
    }
    return () => { offStart(); offStop(); offLoaded(); offStatus(); offQueue(); offComplete() }
  }, [beginRecording, stopRecording, updateSettings])

  useEffect(() => {
    if (!armed) return
    const capture = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); setArmed(false); void window.utterflow.resumeHotkey(); return
      }
      const keyCode = keyCodes[event.code]
      const modifiers = [event.ctrlKey && 'control', event.altKey && 'option', event.shiftKey && 'shift', event.metaKey && 'command'].filter(Boolean) as string[]
      if (keyCode === undefined || modifiers.length === 0 || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
      event.preventDefault(); event.stopPropagation()
      const keyLabel = event.code === 'Space' ? 'Space' : event.code.replace(/^(Key|Digit)/, '')
      setSettings(current => ({ ...current, hotkey: { keyCode, keyLabel, modifiers } }))
      setArmed(false)
    }
    document.addEventListener('keydown', capture, true)
    return () => document.removeEventListener('keydown', capture, true)
  }, [armed])

  const armHotkey = async () => { await window.utterflow.pauseHotkey(); setArmed(true) }
  const cancelHotkey = async () => { setArmed(false); await window.utterflow.resumeHotkey() }

  const save = async () => {
    setSaving(true); setSavedMessage('')
    try {
      const next = await window.utterflow.saveSettings({
        vaultPath: settings.vaultPath.trim(), destinationFolder: settings.destinationFolder.trim(),
        filenameFormat: settings.filenameFormat.trim(), hotkey: settings.hotkey, soundEnabled: settings.soundEnabled,
      })
      if (apiKey.trim()) { await window.utterflow.saveApiKey(apiKey); setApiKey('') }
      updateSettings(next); setSavedMessage('Settings saved'); setLoaded(true)
      window.setTimeout(() => setSavedMessage(''), 4000)
    } catch (error) {
      setSavedMessage(error instanceof Error ? error.message : 'Settings could not be saved')
      if (armed) await window.utterflow.resumeHotkey()
      setArmed(false)
    } finally { setSaving(false) }
  }
  const chooseVault = async () => {
    const selected = await window.utterflow.selectVault()
    if (selected) updateSettings({ vaultPath: selected })
  }
  const allowMic = async () => {
    setMicBusy(true)
    try {
      const result = await window.utterflow.requestMicrophone()
      updateSettings({ micStatus: result.allowed ? 'granted' : 'denied' })
      if (result.allowed) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        stream.getTracks().forEach(track => track.stop())
        setSavedMessage('Microphone is ready')
      }
    } catch (error) { setSavedMessage(error instanceof Error ? error.message : 'Microphone access failed') }
    finally { setMicBusy(false) }
  }
  const requestInput = async () => {
    try {
      const result = await window.utterflow.requestInputMonitoring()
      updateSettings(result)
      if (result.inputMonitoringStatus !== 'granted') await window.utterflow.openPrivacy('input')
    } catch { await window.utterflow.openPrivacy('input') }
  }
  const refreshPermissions = async () => { updateSettings(await window.utterflow.refreshPermissions()) }
  const retryQueue = async () => { await window.utterflow.retryFailed(); setFailedCaptures(await window.utterflow.getQueue()) }

  if (!loaded) return <main className="settings-root loading-screen"><div className="brand-mark">u</div><p>Starting Utterflow…</p></main>

  return (
    <main className="settings-root">
      <div className="window-drag" />
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark">u</div><div><h1>Utterflow</h1><p>Code thoughts, captured while they’re fresh</p></div></div>
        <button className="button quiet open-note" onClick={() => void window.utterflow.openToday()}><FolderOpen size={15} /> Open today’s note</button>
      </header>
      <div className="content-grid">
        <section className="main-column">
          {showSetup && <div className="intro-card"><div className="intro-icon"><Headphones size={19} /></div><div><div className="eyebrow">YOUR QUICK CAPTURE</div><p>Highlight code, hold your shortcut, and talk it through. Utterflow adds the code and your explanation to today’s Obsidian note.</p></div><button className="icon-button close-intro" aria-label="Dismiss introduction" onClick={() => setShowSetup(false)}><X size={15} /></button></div>}

          <section className="panel">
            <div className="section-heading"><span className="section-icon"><FolderOpen size={16} /></span><div><h2>Obsidian destination</h2><p>Choose the vault and daily note location.</p></div></div>
            <label className="field-label" htmlFor="vault">Vault folder</label>
            <div className="input-row"><input id="vault" className="text-input" value={settings.vaultPath} onChange={event => updateSettings({ vaultPath: event.target.value })} placeholder="Choose your Obsidian vault" spellCheck={false} /><button className="button outline browse-button" onClick={() => void chooseVault()}>Browse</button></div>
            <div className="two-fields">
              <div><label className="field-label" htmlFor="destination">Destination folder</label><input id="destination" className="text-input" value={settings.destinationFolder} onChange={event => updateSettings({ destinationFolder: event.target.value })} placeholder="AI Engineering / Daily Learning" spellCheck={false} /></div>
              <div><label className="field-label" htmlFor="filename">Daily filename</label><input id="filename" className="text-input" value={settings.filenameFormat} onChange={event => updateSettings({ filenameFormat: event.target.value })} placeholder="YYYY-MM-DD.md" spellCheck={false} /></div>
            </div>
            <p className="field-hint">Date tokens: <code>YYYY</code> year, <code>MM</code> month, <code>DD</code> day. Missing destination folders are created inside your vault.</p>
          </section>

          <section className="panel">
            <div className="section-heading"><span className="section-icon"><Keyboard size={16} /></span><div><h2>Press-and-hold shortcut</h2><p>Selection is captured on key-down; release to transcribe and save.</p></div></div>
            <div className="shortcut-row"><div><span className="field-label">Current shortcut</span><div className="shortcut-display">{shortcutLabel(settings.hotkey)}</div></div><div className="shortcut-actions">{armed ? <><span className="capture-prompt">Press your new shortcut</span><button className="button quiet" onClick={() => void cancelHotkey()}>Cancel</button></> : <button className="button outline" onClick={() => void armHotkey()}><Settings2 size={14} /> Change shortcut</button>}</div></div>
            <div className="switch-row"><div className="switch-copy"><Volume2 size={15} /><span>Play a soft cue when listening starts</span></div><button className={`switch ${settings.soundEnabled ? 'on' : ''}`} role="switch" aria-checked={settings.soundEnabled} onClick={() => updateSettings({ soundEnabled: !settings.soundEnabled })}><span /></button></div>
            <div className="inline-status"><span className={`status-led ${settings.inputMonitoringStatus === 'granted' ? 'good' : 'pending'}`} />{settings.hotkeyStatus}</div>
          </section>

          <section className="panel">
            <div className="section-heading"><span className="section-icon deepgram-symbol">d</span><div><h2>Speech-to-text</h2><p>Your recording goes to Deepgram after you release the shortcut.</p></div><span className="provider-badge">DEEPGRAM</span></div>
            <label className="field-label" htmlFor="api-key">API key</label>
            <div className="input-row"><input id="api-key" className="text-input secret-input" type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={settings.hasApiKey ? 'Key stored securely in macOS Keychain' : 'Paste your Deepgram API key'} /><span className={`key-state ${settings.hasApiKey ? 'saved' : ''}`}>{settings.hasApiKey ? 'SAVED' : 'NOT SET'}</span></div>
            {settings.hasApiKey && <button className="text-button remove-key" onClick={async () => { await window.utterflow.removeApiKey(); updateSettings({ hasApiKey: false }); setSavedMessage('Deepgram key removed') }}>Remove saved key</button>}
            <p className="field-hint">The key is stored in macOS Keychain. Utterflow sends audio to Deepgram only after you release the shortcut.</p>
          </section>

          <section className="panel permissions-panel">
            <div className="section-heading"><span className="section-icon"><ShieldCheck size={16} /></span><div><h2>macOS permissions</h2><p>Needed for the shortcut, selected code, and microphone.</p></div><button className="text-button refresh-button" onClick={() => void refreshPermissions()}>Refresh</button></div>
            <PermissionRow icon={<Keyboard size={14} />} title="Input Monitoring" detail="Detect the hold shortcut globally." status={friendlyStatus(settings.inputMonitoringStatus)} action={requestInput} actionLabel="Enable" />
            <PermissionRow icon={<Settings2 size={14} />} title="Accessibility" detail="Read highlighted text from the active app." status={friendlyStatus(settings.accessibilityStatus)} action={() => window.utterflow.openPrivacy('accessibility')} actionLabel="Open Settings" />
            <PermissionRow icon={<Mic size={14} />} title="Microphone" detail="Record only while you hold the shortcut." status={friendlyStatus(settings.micStatus)} action={allowMic} actionLabel={micBusy ? 'Checking…' : 'Allow'} disabled={micBusy} />
            <p className="permission-note">Utterflow never takes screenshots or reads your clipboard. If code cannot be accessed, it records speech only and shows the permission status here.</p>
          </section>

          {failedCaptures.length > 0 && <section className="panel retry-panel"><div className="section-heading"><span className="section-icon warning"><CircleAlert size={16} /></span><div><h2>Saved for retry <span className="count-pill">{failedCaptures.length}</span></h2><p>Audio and completed notes stay on this Mac until retry succeeds.</p></div><button className="button outline retry-button" onClick={() => void retryQueue()}><RotateCw size={14} /> Retry</button></div><div className="retry-list">{failedCaptures.slice(0, 3).map(item => <div className="retry-item" key={item.id}><span>{item.hasCode ? 'Code + voice' : 'Voice note'}</span><small>{item.error}</small></div>)}</div><button className="text-button" onClick={() => void window.utterflow.revealQueue()}>Show saved capture files</button></section>}
        </section>

        <aside className="side-column">
          <div className="status-card"><div className="status-card-top"><span className="eyebrow">READY WHEN YOU ARE</span><span className={`status-pulse ${settings.inputMonitoringStatus === 'granted' && settings.micStatus === 'granted' ? 'good' : ''}`} /></div><div className="mini-visual"><div className="mini-glow" /><span>u</span></div><h3>Highlight → hold → explain</h3><p>Keep working in your editor. Utterflow stays beside your cursor while you talk.</p><div className="step-list"><div><span className="step-number">01</span><span>Highlight code in Cursor or VS Code</span></div><div><span className="step-number">02</span><span>Hold <kbd>{shortcutLabel(settings.hotkey)}</kbd> and speak</span></div><div><span className="step-number">03</span><span>Release. Your note is appended.</span></div></div></div>
          <div className="privacy-card"><div className="privacy-heading"><ShieldCheck size={15} /><span>Private by default</span></div><p>Selected code stays on this Mac and is written to your Obsidian note. Only the audio recording is sent to Deepgram after you release the shortcut.</p></div>
        </aside>
      </div>
      <footer className="footer-bar"><span className={`footer-status ${recordingLabel ? 'recording' : ''}`}>{recordingLabel ? <><span className="footer-dot" />{recordingLabel}</> : savedMessage ? <><Check size={13} />{savedMessage}</> : <>Utterflow is ready</>}</span><span className="footer-actions">{failedCaptures.length > 0 && <button className="text-button" onClick={() => void retryQueue()}>Retry {failedCaptures.length}</button>}<button className="button primary save-button" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save settings'}</button></span></footer>
    </main>
  )
}

function PermissionRow({ icon, title, detail, status, action, actionLabel, disabled = false }: { icon: React.ReactNode; title: string; detail: string; status: string; action: () => void | Promise<void>; actionLabel: string; disabled?: boolean }) {
  const good = status === 'Ready'
  return <div className="permission-row"><span className={`permission-icon ${good ? 'good' : ''}`}>{icon}</span><div className="permission-info"><div className="permission-title">{title}<span className={`permission-state ${good ? 'good' : 'pending'}`}>{good ? <Check size={11} /> : null}{status}</span></div><p>{detail}</p></div><button className="text-button permission-action" disabled={disabled || good} onClick={() => void action()}>{good ? 'Enabled' : actionLabel}</button></div>
}

export default App
