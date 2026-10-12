const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { appendNoteEntry, formatDailyFilename, formatStudyEntry, getDailyNotePath } = require('../electron/services/notes.cjs')
const { transcribeAudio } = require('../electron/services/transcription.cjs')

const tempRoot = path.join(__dirname, '../tmp/tests')
async function freshDir(t) {
  const dir = path.join(tempRoot, `${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await fs.mkdir(dir, { recursive: true })
  t.after(() => fs.rm(dir, { recursive: true, force: true }))
  return dir
}

test('daily filename uses the local calendar date and rolls over at midnight', () => {
  const beforeMidnight = new Date(2026, 9, 12, 23, 59, 59)
  const afterMidnight = new Date(2026, 9, 13, 0, 0, 1)
  assert.equal(formatDailyFilename('YYYY-MM-DD.md', beforeMidnight), '2026-10-12.md')
  assert.equal(formatDailyFilename('YYYY-MM-DD.md', afterMidnight), '2026-10-13.md')
  assert.equal(formatDailyFilename('YYYYMMDD', afterMidnight), '20261013.md')
})

test('daily note path stays inside the chosen vault and destination', () => {
  const date = new Date(2026, 9, 12, 12)
  assert.equal(getDailyNotePath({ vaultPath: '/vault', destinationFolder: 'AI Engineering/Daily Learning', filenameFormat: 'YYYY-MM-DD.md' }, date), path.join('/vault', 'AI Engineering/Daily Learning', '2026-10-12.md'))
  assert.throws(() => getDailyNotePath({ vaultPath: '/vault', destinationFolder: '../outside', filenameFormat: 'YYYY-MM-DD.md' }, date), /inside the selected vault/)
  assert.throws(() => formatDailyFilename('../YYYY-MM-DD.md', date), /not a path/)
})

test('creates today’s note, then appends without replacing existing text', async t => {
  const dir = await freshDir(t)
  const note = path.join(dir, '2026-10-12.md')
  await appendNoteEntry(note, '### First\n\nOne\n\n---')
  await appendNoteEntry(note, '### Second\n\nTwo\n\n---')
  const body = await fs.readFile(note, 'utf8')
  assert.match(body, /^### First/)
  assert.match(body, /### First[\s\S]*### Second/)
  assert.equal((body.match(/### First/g) || []).length, 1)
  assert.equal((body.match(/### Second/g) || []).length, 1)
})

test('serializes simultaneous appends to the same daily note', async t => {
  const dir = await freshDir(t)
  const note = path.join(dir, 'today.md')
  await Promise.all(Array.from({ length: 24 }, (_, index) => appendNoteEntry(note, `### Entry ${index}\n\nText ${index}\n\n---`)))
  const body = await fs.readFile(note, 'utf8')
  for (let index = 0; index < 24; index += 1) assert.equal((body.match(new RegExp(`### Entry ${index}(?:\\n|$)`, 'g')) || []).length, 1)
})

test('formats a no-selection capture as transcript only', () => {
  const entry = formatStudyEntry({ selectedText: null, transcript: 'Return gives a value back.', endedAt: new Date(2026, 9, 12, 2, 14) })
  assert.match(entry, /^### Study Note — /)
  assert.match(entry, /Return gives a value back\./)
  assert.doesNotMatch(entry, /```|My explanation/)
})

test('keeps selected code whitespace, indentation, punctuation, and embedded backticks', () => {
  const selectedText = '  const marker = "```";\n\tif (ok) {\n    return ["yes", value];\n  }\n'
  const entry = formatStudyEntry({ selectedText, transcript: 'I think this builds the label.', language: 'typescript', endedAt: new Date(2026, 9, 12, 2, 14) })
  const opening = entry.indexOf('````typescript\n') + '````typescript\n'.length
  const closing = entry.indexOf('````\n\n**My explanation**', opening)
  assert.notEqual(closing, -1, 'uses a longer-than-triple fence around code containing triple backticks')
  assert.equal(entry.slice(opening, closing), selectedText)
})

test('uses a plain fenced block when language is not reliable', () => {
  const entry = formatStudyEntry({ selectedText: 'x = "[1]"\n', transcript: 'This assigns a string.', endedAt: new Date() })
  assert.match(entry, /\n```\n/)
})

test('rejects an empty transcript', () => {
  assert.throws(() => formatStudyEntry({ selectedText: null, transcript: '   ' }), /transcript is empty/)
})

test('does not overwrite a file when a destination write fails', async t => {
  const dir = await freshDir(t)
  const blockingFile = path.join(dir, 'not-a-folder')
  await fs.writeFile(blockingFile, 'keep this')
  await assert.rejects(appendNoteEntry(path.join(blockingFile, 'note.md'), 'entry'))
  assert.equal(await fs.readFile(blockingFile, 'utf8'), 'keep this')
})

test('a failed STT request leaves the local recording intact for retry', async t => {
  const dir = await freshDir(t)
  const audio = path.join(dir, 'capture.webm')
  await fs.writeFile(audio, Buffer.from([1, 2, 3, 4]))
  await assert.rejects(transcribeAudio(audio, 'test-key', async () => { throw new Error('offline') }), /saved for retry/)
  assert.deepEqual(await fs.readFile(audio), Buffer.from([1, 2, 3, 4]))
})
