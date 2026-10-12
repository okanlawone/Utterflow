const fs = require('node:fs/promises')
const path = require('node:path')

function formatDailyFilename(template, date = new Date()) {
  const tokens = {
    YYYY: String(date.getFullYear()),
    MM: String(date.getMonth() + 1).padStart(2, '0'),
    DD: String(date.getDate()).padStart(2, '0'),
    HH: String(date.getHours()).padStart(2, '0'),
    mm: String(date.getMinutes()).padStart(2, '0'),
  }
  const filename = template.replace(/YYYY|MM|DD|HH|mm/g, token => tokens[token])
  if (!filename || filename === '.' || filename === '..' || /[\\/]/.test(filename)) {
    throw new Error('The daily filename format must produce a filename, not a path.')
  }
  return filename.endsWith('.md') ? filename : `${filename}.md`
}

function getDailyNotePath({ vaultPath, destinationFolder = '', filenameFormat = 'YYYY-MM-DD.md' }, date = new Date()) {
  if (!vaultPath) throw new Error('Choose an Obsidian vault folder in Settings.')
  const filename = formatDailyFilename(filenameFormat, date)
  const vault = path.resolve(vaultPath)
  const notePath = path.resolve(vault, destinationFolder, filename)
  if (notePath === vault || !notePath.startsWith(`${vault}${path.sep}`)) {
    throw new Error('The destination must stay inside the selected vault.')
  }
  return notePath
}

function localTime(date) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date)
}

function codeFence(code) {
  const longestRun = Math.max(0, ...Array.from(code.matchAll(/`+/g), match => match[0].length))
  return '`'.repeat(Math.max(3, longestRun + 1))
}

function formatStudyEntry({ selectedText, transcript, language, endedAt = new Date() }) {
  const spoken = String(transcript || '').trim()
  if (!spoken) throw new Error('The transcript is empty.')
  const time = localTime(new Date(endedAt))
  if (typeof selectedText === 'string' && selectedText.length > 0) {
    const fence = codeFence(selectedText)
    const lang = /^[a-zA-Z0-9_+.-]+$/.test(language || '') ? language : ''
    const body = selectedText.endsWith('\n') ? selectedText : `${selectedText}\n`
    return `### Code Study — ${time}\n\n${fence}${lang}\n${body}${fence}\n\n**My explanation**\n\n${spoken}\n\n---`
  }
  return `### Study Note — ${time}\n\n${spoken}\n\n---`
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

async function acquireLock(targetPath, timeoutMs = 10000) {
  const lockPath = `${targetPath}.utterflow-lock`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await fs.mkdir(lockPath)
      await fs.writeFile(path.join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, createdAt: Date.now() }))
      return async () => fs.rm(lockPath, { recursive: true, force: true })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      try {
        const owner = JSON.parse(await fs.readFile(path.join(lockPath, 'owner.json'), 'utf8'))
        const age = Date.now() - owner.createdAt
        let alive = true
        try { process.kill(owner.pid, 0) } catch (check) { alive = check.code !== 'ESRCH' }
        if (age > 30000 && !alive) {
          await fs.rm(lockPath, { recursive: true, force: true })
          continue
        }
      } catch (readError) {
        if (readError.code === 'ENOENT') {
          const stat = await fs.stat(lockPath).catch(() => null)
          if (!stat || Date.now() - stat.mtimeMs > 30000) {
            await fs.rm(lockPath, { recursive: true, force: true })
            continue
          }
        } else if (readError instanceof SyntaxError) {
          await fs.rm(lockPath, { recursive: true, force: true })
          continue
        }
      }
      await delay(45 + Math.floor(Math.random() * 35))
    }
  }
  throw new Error('The daily note is busy with another write. Try again in a moment.')
}

async function appendNoteEntry(notePath, entry) {
  await fs.mkdir(path.dirname(notePath), { recursive: true })
  const unlock = await acquireLock(notePath)
  try {
    let existing = ''
    try { existing = await fs.readFile(notePath, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
    const separator = existing.length === 0 ? '' : (existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n')
    const handle = await fs.open(notePath, 'a')
    try {
      await handle.writeFile(`${separator}${entry}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  } finally {
    await unlock()
  }
}

module.exports = { appendNoteEntry, codeFence, formatDailyFilename, formatStudyEntry, getDailyNotePath }
