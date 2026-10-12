const { app, BrowserWindow, Tray, Menu, ipcMain, screen, shell, nativeImage, Notification, dialog, systemPreferences, safeStorage } = require('electron')
const { spawn, execFile } = require('node:child_process')
const { promisify } = require('node:util')
const fs = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const { fileURLToPath } = require('node:url')
const { appendNoteEntry, formatStudyEntry, getDailyNotePath } = require('./services/notes.cjs')
const { transcribeAudio } = require('./services/transcription.cjs')

const runFile = promisify(execFile)
const isDev = !app.isPackaged
const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173'
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')
const queuePath = () => path.join(app.getPath('userData'), 'failed-captures')
const defaultSettings = () => ({
  vaultPath: path.join(os.homedir(), 'Library/Application Support/Clicky/JPS'),
  destinationFolder: 'AI Engineering/Daily Learning',
  filenameFormat: 'YYYY-MM-DD.md',
  hotkey: { keyCode: 49, keyLabel: 'Space', modifiers: ['control', 'shift', 'option'] },
  soundEnabled: true,
  apiKeyEncrypted: null,
})

let settings = defaultSettings()
let settingsWindow = null
let overlayWindow = null
let tray = null
let hookProcess = null
let hookBuffer = ''
let activeSession = null
let hookMessage = 'Starting global shortcut…'
let micStatus = 'unknown'
let axStatus = 'unknown'
let inputStatus = 'unknown'
let firstRun = false
let startPending = false
let settingsRendererReady = false
let sessionCounter = 0
let overlayState = { state: 'idle', accessibilityTrusted: true }

function sendToSettings(channel, payload) {
  if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.webContents.send(channel, payload)
}
function sendToOverlay(channel, payload) {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.webContents.send(channel, payload)
}

async function loadSettings() {
  try {
    const stored = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
    settings = { ...defaultSettings(), ...stored, hotkey: { ...defaultSettings().hotkey, ...stored.hotkey } }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Settings could not be read:', error.message)
    settings = defaultSettings()
    firstRun = true
  }
}
async function persistSettings() {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true })
  const temp = `${settingsPath()}.tmp`
  await fs.writeFile(temp, JSON.stringify(settings, null, 2), { mode: 0o600 })
  await fs.rename(temp, settingsPath())
}
function publicSettings() {
  return {
    vaultPath: settings.vaultPath,
    destinationFolder: settings.destinationFolder,
    filenameFormat: settings.filenameFormat,
    hotkey: settings.hotkey,
    soundEnabled: settings.soundEnabled,
    hasApiKey: Boolean(settings.apiKeyEncrypted),
    micStatus,
    accessibilityStatus: axStatus,
    inputMonitoringStatus: inputStatus,
    hotkeyStatus: hookMessage,
    failedCount: 0,
    firstRun,
  }
}
async function readApiKey() {
  if (!settings.apiKeyEncrypted) return ''
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure Keychain storage is unavailable on this Mac.')
  return safeStorage.decryptString(Buffer.from(settings.apiKeyEncrypted, 'base64'))
}
function languageFromSelection(selection) {
  const bundle = (selection.bundleIdentifier || '').toLowerCase()
  const appName = (selection.sourceApplication || '').toLowerCase()
  if (!bundle.includes('vscode') && !bundle.includes('todesktop') && !appName.includes('cursor') && !appName.includes('visual studio code')) return null
  let name = ''
  if (selection.documentURL) {
    try { name = fileURLToPath(selection.documentURL) } catch { name = selection.documentURL }
  }
  if (!name && selection.focusedTitle) {
    name = selection.focusedTitle.split(/\s+[—–-]\s+/)[0].trim()
  }
  const ext = path.extname(name).toLowerCase()
  const languages = {
    '.py': 'python', '.pyi': 'python', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'tsx', '.jsx': 'jsx', '.json': 'json', '.html': 'html', '.htm': 'html',
    '.css': 'css', '.scss': 'scss', '.swift': 'swift', '.go': 'go', '.rs': 'rust', '.java': 'java',
    '.c': 'c', '.h': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cs': 'csharp', '.rb': 'ruby', '.php': 'php',
    '.sql': 'sql', '.sh': 'bash', '.yaml': 'yaml', '.yml': 'yaml', '.md': 'markdown', '.toml': 'toml',
  }
  return languages[ext] || null
}
function notePathForSession(session) {
  return getDailyNotePath(settings, new Date(session.endedAt || Date.now()))
}
function makeNotification(title, body) {
  if (!Notification.isSupported()) return
  new Notification({ title, body, silent: true }).show()
}
function makeSessionId() {
  sessionCounter += 1
  return `${Date.now()}-${sessionCounter}`
}
async function queueDirectory() {
  await fs.mkdir(queuePath(), { recursive: true })
  return queuePath()
}
async function saveQueueItem(item) {
  const directory = await queueDirectory()
  const file = path.join(directory, `${item.id}.json`)
  const temp = `${file}.tmp`
  await fs.writeFile(temp, JSON.stringify(item, null, 2), { mode: 0o600 })
  await fs.rename(temp, file)
  refreshTray()
  return file
}
async function getQueueItems() {
  let names = []
  try { names = await fs.readdir(queuePath()) } catch { return [] }
  const result = []
  for (const name of names.filter(name => name.endsWith('.json'))) {
    try { result.push(JSON.parse(await fs.readFile(path.join(queuePath(), name), 'utf8'))) } catch {}
  }
  return result.sort((a, b) => a.endedAt.localeCompare(b.endedAt))
}
async function removeQueueItem(item) {
  await fs.rm(path.join(queuePath(), `${item.id}.json`), { force: true })
  if (item.audioPath) await fs.rm(item.audioPath, { force: true })
  refreshTray()
}
async function transcribeAndWrite(item) {
  if (!item.transcript) {
    const apiKey = await readApiKey()
    item.transcript = await transcribeAudio(item.audioPath, apiKey)
    await saveQueueItem(item)
  }
  if (!item.markdown) {
    item.markdown = formatStudyEntry({
      selectedText: item.selectedText,
      transcript: item.transcript,
      language: item.language,
      endedAt: item.endedAt,
    })
    await saveQueueItem(item)
  }
  const target = item.targetNotePath || notePathForSession(item)
  const vaultStat = await fs.stat(settings.vaultPath).catch(() => null)
  if (!vaultStat || !vaultStat.isDirectory()) throw new Error('The selected Obsidian vault folder is missing. Choose a valid vault in Settings.')
  item.targetNotePath = target
  await saveQueueItem(item)
  await appendNoteEntry(target, item.markdown)
  await removeQueueItem(item)
  return target
}
async function retryAll() {
  const items = await getQueueItems()
  if (!items.length) {
    makeNotification('Utterflow', 'There are no failed captures to retry.')
    return
  }
  for (const item of items) {
    try {
      await transcribeAndWrite(item)
      makeNotification('Added to today’s study note', item.selectedText ? 'Code + explanation added' : 'Transcript added')
    } catch (error) {
      item.lastError = error.message
      await saveQueueItem(item)
      makeNotification('Utterflow retry failed', error.message)
      break
    }
  }
  refreshTray()
  sendToSettings('queue:updated', await queueSummary())
}
async function queueSummary() {
  const items = await getQueueItems()
  return items.map(item => ({ id: item.id, endedAt: item.endedAt, hasCode: Boolean(item.selectedText), error: item.lastError || 'Ready to retry' }))
}
function refreshTray() {
  if (!tray) return
  getQueueItems().then(items => {
    const status = activeSession ? '● Recording' : 'Ready'
    tray.setToolTip(`Utterflow · ${status}`)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: status, enabled: false },
      { type: 'separator' },
      { label: 'Open today’s note', click: openTodaysNote },
      { label: 'Settings…', click: showSettingsWindow },
      { label: items.length ? `Retry failed note${items.length > 1 ? 's' : ''} (${items.length})` : 'Retry failed note', enabled: items.length > 0, click: retryAll },
      { type: 'separator' },
      { label: 'Quit Utterflow', click: () => app.quit() },
    ]))
  }).catch(() => {})
}
function makeWindowOptions(extra = {}) {
  return {
    show: false,
    backgroundColor: '#f6f4ef',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false },
    ...extra,
  }
}
async function loadView(win, view) {
  if (isDev) await win.loadURL(`${devUrl}/?view=${view}`)
  else await win.loadFile(path.join(__dirname, '../dist/index.html'), { query: { view } })
}
function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) return settingsWindow
  settingsWindow = new BrowserWindow(makeWindowOptions({
    width: 720, height: 760, minWidth: 640, minHeight: 640,
    title: 'Utterflow', titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 16 },
  }))
  settingsWindow.on('close', event => {
    if (!app.isQuitting) { event.preventDefault(); settingsWindow.hide() }
  })
  settingsWindow.webContents.on('did-finish-load', () => {
    sendToSettings('settings:loaded', publicSettings())
    queueSummary().then(items => sendToSettings('queue:updated', items))
  })
  loadView(settingsWindow, 'settings').then(() => { if (firstRun) settingsWindow.show() })
  return settingsWindow
}
function createOverlayWindow() {
  overlayWindow = new BrowserWindow(makeWindowOptions({
    width: 156, height: 160, frame: false, transparent: true, resizable: false, movable: false,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, hasShadow: false,
  }))
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  overlayWindow.webContents.on('did-finish-load', () => overlayWindow.webContents.send('overlay:state', overlayState))
  loadView(overlayWindow, 'overlay')
  overlayWindow.on('closed', () => { overlayWindow = null })
}
async function showOverlay(state = 'listening', accessibilityTrusted = true) {
  if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow()
  const point = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(point)
  const bounds = display.workArea
  const width = 156
  const height = 160
  let x = point.x + 18
  let y = point.y + 22
  if (x + width > bounds.x + bounds.width) x = point.x - width - 18
  if (y + height > bounds.y + bounds.height) y = point.y - height - 18
  x = Math.max(bounds.x, Math.min(x, bounds.x + bounds.width - width))
  y = Math.max(bounds.y, Math.min(y, bounds.y + bounds.height - height))
  overlayWindow.setPosition(Math.round(x), Math.round(y))
  overlayState = { state, accessibilityTrusted }
  overlayWindow.webContents.send('overlay:state', overlayState)
  overlayWindow.showInactive()
  overlayWindow.moveTop()
}
function playStartSound() {
  if (!settings.soundEnabled) return
  const audioPath = isDev ? path.join(__dirname, '../resources/sounds/listen-start.wav') : path.join(process.resourcesPath, 'sounds/listen-start.wav')
  execFile('/usr/bin/afplay', [audioPath], { windowsHide: true }, () => {})
}
function captureEvent(data) {
  if (data.type === 'error') {
    hookMessage = data.message
    inputStatus = 'needed'
    sendToSettings('settings:status', publicSettings())
    refreshTray()
    return
  }
  if (data.type === 'down' && !activeSession && !startPending) {
    startPending = true
    const selectedText = typeof data.selectedText === 'string' && data.selectedText.length > 0 ? data.selectedText : null
    activeSession = {
      id: makeSessionId(), startedAt: new Date().toISOString(), endedAt: null,
      selectedText, sourceApplication: data.sourceApplication || null,
      bundleIdentifier: data.bundleIdentifier || null, focusedTitle: data.focusedTitle || null,
      language: selectedText ? languageFromSelection(data) : null,
      accessibilityTrusted: Boolean(data.accessibilityTrusted),
    }
    hookMessage = 'Listening for the shortcut release'
    refreshTray()
    showOverlay('listening', activeSession.accessibilityTrusted)
    playStartSound()
    const session = { ...activeSession }
    sendToSettings('recording:start', session)
    startPending = false
    return
  }
  if (data.type === 'up' && activeSession) {
    activeSession.endedAt = new Date().toISOString()
    hookMessage = 'Transcribing your explanation…'
    const session = { ...activeSession }
    showOverlay('thinking', session.accessibilityTrusted)
    sendToSettings('recording:stop', session)
    refreshTray()
  }
}
function modifierFlags(modifiers) {
  return modifiers.join(',')
}
function startHook() {
  stopHook()
  if (!settingsRendererReady) {
    hookMessage = 'Settings are still starting…'
    return
  }
  const binary = isDev ? path.join(__dirname, '../resources/native/utterflow-hotkey') : path.join(process.resourcesPath, 'native/utterflow-hotkey')
  const hotkey = settings.hotkey || defaultSettings().hotkey
  const child = spawn(binary, ['--keycode', String(hotkey.keyCode), '--modifiers', modifierFlags(hotkey.modifiers)], { stdio: ['ignore', 'pipe', 'pipe'] })
  hookProcess = child
  hookBuffer = ''
  hookMessage = 'Global shortcut active'
  child.stdout.on('data', chunk => {
    hookBuffer += chunk.toString()
    const lines = hookBuffer.split('\n')
    hookBuffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.trim()) continue
      try { captureEvent(JSON.parse(line)) } catch (error) { console.error('Shortcut event could not be read:', error.message) }
    }
  })
  child.stderr.on('data', chunk => console.error('Shortcut listener:', chunk.toString().trim()))
  child.on('error', error => { hookMessage = `Shortcut listener failed: ${error.message}`; sendToSettings('settings:status', publicSettings()) })
  child.on('exit', (code, signal) => {
    if (hookProcess === child) hookProcess = null
    if (code && code !== 0) {
      hookMessage = 'Enable Input Monitoring in System Settings to use the hold shortcut.'
      inputStatus = 'needed'
      sendToSettings('settings:status', publicSettings())
    }
    if (!app.isQuitting && code === 2) makeNotification('Utterflow needs Input Monitoring', 'Open Settings to enable the hold-to-record shortcut.')
    if (!app.isQuitting && code !== 0 && code !== null) refreshTray()
    if (signal && !app.isQuitting && hookProcess === null) hookMessage = 'Global shortcut paused'
  })
  setTimeout(() => { checkPermissions().then(() => sendToSettings('settings:status', publicSettings())).catch(() => {}) }, 250)
}
function stopHook() {
  if (hookProcess && !hookProcess.killed) hookProcess.kill('SIGTERM')
  hookProcess = null
}
async function checkPermissions() {
  micStatus = process.platform === 'darwin' ? systemPreferences.getMediaAccessStatus('microphone') : 'unknown'
  const helper = isDev ? path.join(__dirname, '../resources/native/utterflow-hotkey') : path.join(process.resourcesPath, 'native/utterflow-hotkey')
  try {
    const { stdout } = await runFile(helper, ['--permissions'], { timeout: 3000 })
    const info = JSON.parse(stdout.trim())
    axStatus = info.accessibility ? 'granted' : 'needed'
    inputStatus = info.inputMonitoring ? 'granted' : 'needed'
  } catch {
    axStatus = 'needed'
    inputStatus = 'needed'
  }
  return { micStatus, axStatus, inputStatus }
}
async function openTodaysNote() {
  try {
    const vaultStat = await fs.stat(settings.vaultPath).catch(() => null)
    if (!vaultStat || !vaultStat.isDirectory()) throw new Error('The selected Obsidian vault folder is missing. Choose a valid vault in Settings.')
    const notePath = getDailyNotePath(settings, new Date())
    await fs.mkdir(path.dirname(notePath), { recursive: true })
    await fs.open(notePath, 'a').then(file => file.close())
    const error = await shell.openPath(notePath)
    if (error) throw new Error(error)
  } catch (error) {
    makeNotification('Utterflow', error.message)
    showSettingsWindow()
  }
}
function showSettingsWindow() {
  firstRun = false
  const win = createSettingsWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send('settings:loaded', publicSettings())
  queueSummary().then(items => win.webContents.send('queue:updated', items))
}
function createTray() {
  const iconPath = isDev ? path.join(__dirname, '../resources/trayTemplate.png') : path.join(process.resourcesPath, 'trayTemplate.png')
  tray = new Tray(nativeImage.createFromPath(iconPath))
  tray.setTitle('')
  tray.on('click', showSettingsWindow)
  refreshTray()
}

app.on('before-quit', () => { app.isQuitting = true; stopHook() })
app.on('window-all-closed', () => {})

ipcMain.handle('settings:get', async () => ({ ...publicSettings(), permissions: await checkPermissions() }))
ipcMain.handle('renderer:ready', async event => {
  settingsRendererReady = true
  const result = { ...publicSettings(), permissions: await checkPermissions() }
  event.sender.send('settings:loaded', result)
  event.sender.send('queue:updated', await queueSummary())
  startHook()
  return result
})
ipcMain.handle('settings:save', async (_, patch) => {
  const next = { ...settings }
  for (const key of ['vaultPath', 'destinationFolder', 'filenameFormat', 'soundEnabled']) {
    if (Object.hasOwn(patch, key)) next[key] = patch[key]
  }
  if (patch.hotkey) next.hotkey = patch.hotkey
  settings = next
  await persistSettings()
  if (patch.hotkey) startHook()
  firstRun = false
  refreshTray()
  const result = publicSettings()
  sendToSettings('settings:status', result)
  return result
})
ipcMain.handle('settings:save-api-key', async (_, rawKey) => {
  const key = String(rawKey || '').trim()
  if (!key) return { ...publicSettings(), hasApiKey: Boolean(settings.apiKeyEncrypted) }
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure Keychain storage is not available, so Utterflow did not save the key.')
  settings.apiKeyEncrypted = safeStorage.encryptString(key).toString('base64')
  await persistSettings()
  return publicSettings()
})
ipcMain.handle('settings:remove-api-key', async () => {
  settings.apiKeyEncrypted = null
  await persistSettings()
  return publicSettings()
})
ipcMain.handle('settings:select-vault', async () => {
  const result = await dialog.showOpenDialog(settingsWindow, { properties: ['openDirectory', 'createDirectory'], title: 'Choose your Obsidian vault' })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('settings:request-mic', async () => {
  const allowed = await systemPreferences.askForMediaAccess('microphone')
  micStatus = allowed ? 'granted' : 'denied'
  return { allowed, settings: publicSettings() }
})
ipcMain.handle('settings:request-input', async () => {
  const helper = isDev ? path.join(__dirname, '../resources/native/utterflow-hotkey') : path.join(process.resourcesPath, 'native/utterflow-hotkey')
  try {
    const result = await runFile(helper, ['--request-input'], { timeout: 3000 })
    inputStatus = result.stdout.trim() === 'granted' ? 'granted' : 'needed'
  } catch { inputStatus = 'needed' }
  if (inputStatus === 'granted') startHook()
  return { ...publicSettings(), permissions: await checkPermissions() }
})
ipcMain.handle('settings:permission-refresh', async () => ({ ...publicSettings(), permissions: await checkPermissions() }))
ipcMain.handle('settings:open-privacy', async (_, category) => {
  const pane = category === 'microphone' ? 'Privacy_Microphone' : category === 'input' ? 'Privacy_ListenEvent' : 'Privacy_Accessibility'
  await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`)
})
ipcMain.handle('settings:pause-hook', async () => stopHook())
ipcMain.handle('settings:resume-hook', async () => startHook())
ipcMain.handle('settings:open-at-login', async (_, enabled) => { app.setLoginItemSettings({ openAtLogin: Boolean(enabled) }) })
ipcMain.handle('settings:test-mic', async () => ({ allowed: micStatus === 'granted' }))
ipcMain.handle('settings:queue', async () => queueSummary())
ipcMain.handle('settings:retry', async () => retryAll())
ipcMain.handle('settings:open-note', async () => openTodaysNote())
ipcMain.handle('settings:reveal-queue', async () => shell.openPath(queuePath()))
ipcMain.handle('settings:quit', async () => app.quit())
ipcMain.handle('audio:completed', async (_, packet) => {
  if (!activeSession) throw new Error('There is no active recording session.')
  const session = activeSession
  activeSession = null
  const audioBytes = Buffer.from(packet.bytes)
  if (!audioBytes.length) {
    makeNotification('No recording saved', 'The audio was empty. Please try the shortcut again.')
    hideOverlay()
    refreshTray()
    return { ok: false, message: 'No audio was captured.' }
  }
  const directory = await queueDirectory()
  const extension = packet.mimeType?.includes('wav') ? 'wav' : 'webm'
  const audioPath = path.join(directory, `${session.id}.${extension}`)
  const item = {
    id: session.id, startedAt: session.startedAt, endedAt: session.endedAt || new Date().toISOString(),
    selectedText: session.selectedText, sourceApplication: session.sourceApplication,
    bundleIdentifier: session.bundleIdentifier, language: session.language, audioPath,
    transcript: null, markdown: null, targetNotePath: null,
  }
  await fs.writeFile(audioPath, audioBytes, { mode: 0o600 })
  await saveQueueItem(item)
  try {
    const notePath = await transcribeAndWrite(item)
    makeNotification('Added to today’s study note', item.selectedText ? 'Code + explanation added' : 'Transcript added')
    hookMessage = 'Global shortcut active'
    sendToOverlay('overlay:state', { state: 'success', accessibilityTrusted: session.accessibilityTrusted })
    sendToSettings('recording:complete', { ok: true, notePath, hasCode: Boolean(item.selectedText) })
    setTimeout(hideOverlay, 1200)
    refreshTray()
    sendToSettings('queue:updated', await queueSummary())
    return { ok: true, notePath }
  } catch (error) {
    item.lastError = error.message
    await saveQueueItem(item)
    makeNotification('Utterflow saved a retry', error.message)
    hookMessage = error.message
    sendToOverlay('overlay:state', { state: 'error', accessibilityTrusted: session.accessibilityTrusted })
    sendToSettings('recording:complete', { ok: false, message: error.message, hasCode: Boolean(item.selectedText) })
    setTimeout(hideOverlay, 3200)
    refreshTray()
    sendToSettings('queue:updated', await queueSummary())
    return { ok: false, message: error.message }
  }
})
ipcMain.handle('audio:failed', async (_, message) => {
  activeSession = null
  hideOverlay()
  hookMessage = message || 'Microphone recording failed.'
  await checkPermissions()
  sendToSettings('settings:status', publicSettings())
  makeNotification('Utterflow could not record', hookMessage)
  refreshTray()
  return { ok: true }
})

function hideOverlay() {
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.hide()
}

app.whenReady().then(async () => {
  await loadSettings()
  createTray()
  createOverlayWindow()
  createSettingsWindow()
  app.on('activate', showSettingsWindow)
}).catch(error => {
  dialog.showErrorBox('Utterflow failed to start', error.message)
})
