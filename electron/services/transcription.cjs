const fs = require('node:fs/promises')

async function transcribeAudio(audioPath, apiKey, fetchImpl = fetch) {
  if (!apiKey) throw new Error('Add your Deepgram API key in Settings before recording.')
  const audio = await fs.readFile(audioPath)
  if (audio.length === 0) throw new Error('The recording is empty.')
  const extension = audioPath.toLowerCase().split('.').pop()
  const contentType = ({ webm: 'audio/webm', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', mp3: 'audio/mpeg' })[extension] || 'application/octet-stream'
  let response
  try {
    response = await fetchImpl('https://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true', {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': contentType },
      body: audio,
      signal: AbortSignal.timeout(90000),
    })
  } catch {
    throw new Error('Deepgram could not be reached. The recording has been saved for retry.')
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error('Deepgram rejected the API key. Check it in Settings; the recording has been saved for retry.')
    if (response.status >= 500) throw new Error('Deepgram is temporarily unavailable. The recording has been saved for retry.')
    throw new Error(`Deepgram request failed (${response.status}). The recording has been saved for retry.`)
  }
  const result = await response.json()
  const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim()
  if (!transcript) throw new Error('Deepgram returned an empty transcript. The recording has been saved for retry.')
  return transcript
}

module.exports = { transcribeAudio }
