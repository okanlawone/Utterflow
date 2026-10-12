# Utterflow

A small macOS menu bar app for turning a held shortcut into an Obsidian study note:

**Highlight code → hold → explain → release → note appended.**

At shortcut-down, Utterflow reads the selected text through macOS Accessibility APIs before it starts recording. It does not use screenshots, OCR, or the clipboard. At shortcut-up, it sends only the microphone recording to Deepgram and appends the transcript with the captured code (if any) to the local daily Markdown note.

## Run locally

Requirements: macOS 13 or newer, Xcode Command Line Tools, and Node.js 20 or newer.

```sh
npm install
npm run dev
```

The first launch opens Settings. Choose your Obsidian vault, review the destination folder and shortcut, add your Deepgram API key, and grant the permissions below. Utterflow uses your Mac's local time to choose the daily filename. `YYYY-MM-DD.md` is the default pattern.

To build an Apple Silicon disk image:

```sh
npm run dist
```

The DMG is written to `release/`. The app is unsigned; macOS may ask you to confirm opening it. A developer certificate is needed for a signed/notarized release.

## Permissions

- **Microphone:** needed only to record while the shortcut is held. Use **Allow** in Settings to grant access before your first capture.
- **Input Monitoring:** needed to detect the press and release globally. The app captures only the configured shortcut and suppresses its key event so it does not type into the editor.
- **Accessibility:** needed to read the selected text from the frontmost app at shortcut-down. The same permission status is shown in Settings. Without it, speech capture still works, but selected code is not included.

No Screen Recording permission is used or requested.

## Configure the vault and shortcut

Settings lets you choose a vault folder, a destination folder inside it, the daily filename format, a press-and-hold shortcut, and whether to play the short start cue. Missing destination folders are created inside the selected vault; an existing daily note is appended to. Utterflow uses an interprocess lock while appending and syncs the write before showing success.

The default shortcut is **Control + Option + Shift + Space**. To change it, click **Change shortcut**, press a key with at least one modifier, then click **Save settings**. The capture order is fixed: inspect frontmost app, read selected text, then start the microphone.

Deepgram API keys are encrypted with Electron's macOS secure storage, backed by Keychain. Utterflow uses Deepgram's prerecorded transcription endpoint with Nova-3. The key is never included in logs or the Git repository.

## Recording and recovery

The app records only between shortcut-down and shortcut-up. The small Persona indicator and start cue appear beside the pointer. The app stays in the menu bar when the Settings window closes.

If transcription or the Obsidian write fails, Utterflow keeps the audio and capture metadata in its application support folder and shows **Retry failed note** in the menu bar menu. After transcription succeeds but a note write fails, the completed Markdown entry is queued so retry does not need another STT request. Successful captures are removed from the retry queue after the note is synced.

## Project layout

- `electron/main.cjs` — menu bar app, native shortcut events, recording pipeline, settings and notifications
- `macos/HotkeyCapture.swift` — event tap and selection read via Accessibility APIs
- `electron/services/notes.cjs` — daily filenames, Markdown formatting and locked append
- `electron/services/transcription.cjs` — Deepgram adapter
- `src/` — settings window and cursor-side Persona overlay

Run the requested unit tests with `npm test`.
