/**
 * dsh-ascii-video-background — Host half.
 *
 * The browser renders the character video. This half only owns the two HTTP
 * routes that move a chosen video into the Harness attachment store and serve
 * it back with byte-range support, so a background survives page reloads and
 * a changing Web GUI port. Video bytes are never interpreted here.
 */

import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Namespace shared by both routes under the Web server's origin. */
const API_ROOT = '/api/ascii-video-background'
const UPLOAD_PATH = `${API_ROOT}/upload`
const MEDIA_PATH = `${API_ROOT}/media`
const DEFAULT_MEDIA_PATH = `${API_ROOT}/default`
const STATE_ROUTE = `${API_ROOT}/state`
/** Bundled sample shipped with the plugin and played on a fresh install. */
const DEFAULT_VIDEO_FILE = fileURLToPath(new URL('./assets/whale-loop.mp4', import.meta.url))
const DEFAULT_VIDEO_BYTES = 22076872
/** A deliberately high but bounded ceiling for one local wallpaper. */
const MAX_BYTES = 512 * 1024 * 1024
/** Metadata is small; refuse anything that could not be a valid state file. */
const MAX_STATE_BYTES = 256 * 1024
const MAX_VIDEOS = 50
/** Stable metadata location; the Web GUI port may change between launches. */
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const STATE_DIR = join(DSH_HOME, 'ascii-video-background')
const STATE_FILE = join(STATE_DIR, 'state.json')
/** Per-process capability injected into the page and required by both routes. */
const ACCESS_TOKEN = randomBytes(32).toString('base64url')
const TOKEN_HEADER = 'x-avb-token'
const TOKEN_GLOBAL = '__DSH_ASCII_VIDEO_BACKGROUND_TOKEN__'
/** Only these media types are echoed back as a video Content-Type. */
const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
  'video/x-m4v',
  'video/x-matroska',
])

const EXTENSION_TYPES = {
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  ogv: 'video/ogg',
  ogg: 'video/ogg',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
}

class UploadError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function accessTokenMatches(value) {
  if (typeof value !== 'string' || value.length !== ACCESS_TOKEN.length) return false
  const expected = Buffer.from(ACCESS_TOKEN)
  const actual = Buffer.from(value)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function nodeForbidden(res) {
  res.writeHead(403, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end('Forbidden')
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function decodeName(raw) {
  if (typeof raw !== 'string' || raw === '') return 'video'
  let value
  try {
    value = decodeURIComponent(raw)
  } catch {
    value = raw
  }
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .trim()
    .slice(0, 160)
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? 'video' : cleaned
}

function mediaTypeOf(declaredRaw, name) {
  const declared = String(declaredRaw ?? '').split(';')[0].trim().toLowerCase()
  if (VIDEO_TYPES.has(declared)) return declared
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return EXTENSION_TYPES[extension] ?? 'application/octet-stream'
}

function mediaTypeOfPayload(raw) {
  return typeof raw === 'string' && VIDEO_TYPES.has(raw) ? raw : 'application/octet-stream'
}

function normalizeRef(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const { attachmentId, name, bytes } = raw
  if (typeof attachmentId !== 'string' || attachmentId === '') return null
  if (typeof name !== 'string') return null
  if (!Number.isSafeInteger(bytes) || bytes < 0) return null
  return { attachmentId, name, bytes }
}

const STATE_THEMES = new Set(['original', 'miku', 'amber', 'mono'])
const STATE_FITS = new Set(['cover', 'contain'])
const STATE_FPS = new Set([12, 24, 30, 60])

function clampNumber(value, minimum, maximum, fallback) {
  const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.max(minimum, Math.min(maximum, number))
}

function normalizeVideo(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (typeof raw.id !== 'string' || raw.id === '') return null
  if (typeof raw.name !== 'string' || raw.name.trim() === '') return null
  if (raw.builtin === true) {
    return {
      id: raw.id,
      name: raw.name.slice(0, 240),
      type: typeof raw.type === 'string' ? raw.type : 'video/mp4',
      bytes: Number.isSafeInteger(raw.bytes) && raw.bytes >= 0 ? raw.bytes : DEFAULT_VIDEO_BYTES,
      addedAt: typeof raw.addedAt === 'number' && Number.isFinite(raw.addedAt) ? raw.addedAt : 0,
      builtin: true,
    }
  }
  const ref = normalizeRef(raw.ref)
  if (ref === null) return null
  return {
    id: raw.id,
    name: raw.name.slice(0, 240),
    type: typeof raw.type === 'string' ? raw.type : 'application/octet-stream',
    bytes: ref.bytes,
    addedAt: typeof raw.addedAt === 'number' && Number.isFinite(raw.addedAt) ? raw.addedAt : Date.now(),
    ref,
  }
}

function normalizeState(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const videos = Array.isArray(raw.videos)
    ? raw.videos.map(normalizeVideo).filter((video) => video !== null).slice(0, MAX_VIDEOS)
    : []
  const activeId = videos.some((video) => video.id === raw.activeId) ? raw.activeId : null
  return {
    version: 1,
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    activeId,
    cellSize: clampNumber(raw.cellSize, 4, 14, 9),
    opacity: clampNumber(raw.opacity, 0.1, 1, 0.55),
    theme: STATE_THEMES.has(raw.theme) ? raw.theme : 'original',
    fit: STATE_FITS.has(raw.fit) ? raw.fit : 'cover',
    fps: STATE_FPS.has(raw.fps) ? raw.fps : 24,
    videos,
  }
}

async function readStateFile() {
  let text
  try {
    text = await readFile(STATE_FILE, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  return normalizeState(JSON.parse(text))
}

let stateWriteQueue = Promise.resolve()

function writeStateFile(state) {
  stateWriteQueue = stateWriteQueue
    .catch(() => {})
    .then(async () => {
      await mkdir(STATE_DIR, { recursive: true, mode: 0o700 })
      const payload = `${JSON.stringify(state, null, 2)}\n`
      const temporary = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temporary, payload, { encoding: 'utf8', mode: 0o600 })
      try {
        await rename(temporary, STATE_FILE)
      } catch {
        // Some Windows filesystems refuse rename-over-existing; the state is
        // tiny and a direct replace is still atomic enough for one writer.
        await writeFile(STATE_FILE, payload, { encoding: 'utf8', mode: 0o600 })
        await unlink(temporary).catch(() => {})
      }
    })
    .catch((error) => {
      console.error('[ascii-video-background] state write failed', error)
      throw error
    })
  return stateWriteQueue
}

async function readSmallBody(req, maxBytes) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += value.byteLength
    if (total > maxBytes) throw new UploadError('too-large')
    if (value.byteLength > 0) chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function handleState(req, res) {
  if (!accessTokenMatches(req.headers[TOKEN_HEADER])) {
    nodeForbidden(res)
    req.resume()
    return
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    try {
      const state = await readStateFile()
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        res.end()
        return
      }
      nodeJson(res, 200, { ok: true, state })
    } catch (error) {
      console.error('[ascii-video-background] state read failed', error)
      nodeJson(res, 500, { ok: false, error: 'state-read-failed' })
    }
    return
  }
  if (req.method !== 'PUT' && req.method !== 'POST') {
    res.writeHead(405, { allow: 'GET, HEAD, PUT', 'content-type': 'text/plain; charset=utf-8' })
    res.end('Method Not Allowed')
    return
  }
  try {
    const text = await readSmallBody(req, MAX_STATE_BYTES)
    const parsed = JSON.parse(text)
    const state = normalizeState(parsed?.state ?? parsed)
    if (state === null) {
      nodeJson(res, 400, { ok: false, error: 'invalid-state' })
      return
    }
    await writeStateFile(state)
    nodeJson(res, 200, { ok: true, state })
  } catch (error) {
    if (error instanceof UploadError) {
      nodeJson(res, 413, { ok: false, error: 'too-large' })
      return
    }
    console.error('[ascii-video-background] state update failed', error)
    nodeJson(res, 400, { ok: false, error: 'invalid-state' })
  }
}

async function* boundedNodeBody(req, maxBytes) {
  let total = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += value.byteLength
    if (total > maxBytes) throw new UploadError('too-large')
    if (value.byteLength > 0) yield value
  }
  if (total === 0) throw new UploadError('empty-upload')
}

function nodeJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

/**
 * Resource routes only answer GET and HEAD, so the upload is a handler route
 * over the raw Node request. It never buffers the video: the attachment store
 * consumes the request body as a stream.
 */
async function handleUpload(req, res, attachments) {
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST', 'content-type': 'text/plain; charset=utf-8' })
    res.end('Method Not Allowed')
    return
  }
  if (!accessTokenMatches(req.headers[TOKEN_HEADER])) {
    nodeForbidden(res)
    req.resume()
    return
  }

  const declaredLength = Number(req.headers['content-length'] ?? Number.NaN)
  if (Number.isFinite(declaredLength) && (declaredLength > MAX_BYTES || declaredLength === 0)) {
    nodeJson(res, declaredLength > MAX_BYTES ? 413 : 400, {
      ok: false,
      error: declaredLength > MAX_BYTES ? 'too-large' : 'empty-upload',
    })
    req.resume()
    return
  }

  const name = decodeName(req.headers['x-file-name'])
  const type = mediaTypeOf(req.headers['content-type'], name)

  try {
    const ref = await attachments.saveFileStream({
      data: boundedNodeBody(req, MAX_BYTES),
      name,
    })
    if (res.writableEnded || res.destroyed) return
    nodeJson(res, 200, { ok: true, ref, type })
  } catch (error) {
    if (res.writableEnded || res.destroyed) return
    if (error instanceof UploadError) {
      nodeJson(res, error.code === 'too-large' ? 413 : 400, {
        ok: false,
        error: error.code,
      })
    } else {
      console.error('[ascii-video-background] upload failed', error)
      nodeJson(res, 500, { ok: false, error: 'upload-failed' })
    }
    req.resume()
  }
}

function parseRange(header, size) {
  if (typeof header !== 'string') return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return undefined
  const [, rawStart, rawEnd] = match
  if (rawStart === '' && rawEnd === '') return undefined
  let start
  let end
  if (rawStart === '') {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return undefined
  }
  if (start < 0 || start >= size || end < start) return undefined
  return { start, end: Math.min(end, size - 1) }
}

function baseHeaders(type, size) {
  return {
    'content-type': type,
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'content-length': String(size),
  }
}

function nodeError(res, status, text) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(text)
}

async function serveHostFileNode(path, req, res, type) {
  let info
  try {
    info = await stat(path)
  } catch {
    nodeError(res, 404, 'Not Found')
    return
  }
  if (!info.isFile()) {
    nodeError(res, 404, 'Not Found')
    return
  }
  const size = info.size
  const headers = baseHeaders(type, size)
  let status = 200
  let options

  const rangeHeader = req.headers.range
  if (typeof rangeHeader === 'string') {
    const range = parseRange(rangeHeader, size)
    if (range === undefined) {
      res.writeHead(416, { 'content-range': `bytes */${size}` })
      res.end()
      return
    }
    if (range !== null) {
      status = 206
      headers['content-length'] = String(range.end - range.start + 1)
      headers['content-range'] = `bytes ${range.start}-${range.end}/${size}`
      options = range
    }
  }

  if (req.method === 'HEAD') {
    res.writeHead(status, headers)
    res.end()
    return
  }

  const stream = createReadStream(path, options)
  stream.on('error', () => {
    if (!res.headersSent) nodeError(res, 404, 'Not Found')
    else res.destroy()
  })
  res.writeHead(status, headers)
  stream.pipe(res)
}

async function serveAttachmentBufferNode(ref, attachments, res, type) {
  const parts = []
  let total = 0
  try {
    for await (const chunk of attachments.readFileStream(ref)) {
      if (!(chunk instanceof Uint8Array)) continue
      total += chunk.byteLength
      if (total > MAX_BYTES) {
        nodeError(res, 413, 'Too Large')
        return
      }
      parts.push(Buffer.from(chunk))
    }
  } catch (error) {
    console.error('[ascii-video-background] file read failed', error)
    nodeError(res, 404, 'Not Found')
    return
  }
  if (parts.length === 0 && ref.bytes > 0) {
    nodeError(res, 404, 'Not Found')
    return
  }
  const data = Buffer.concat(parts)
  res.writeHead(200, baseHeaders(type, data.byteLength))
  res.end(data)
}

/**
 * The media route is a Node handler, not a resource: a bare <video> element
 * cannot attach the Host's authorization header, and resource routes are
 * behind the page's cookie gate. The unguessable token in the URL is the
 * capability, exactly as it is for the upload route.
 */
async function handleFileNode(req, res, attachments) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' })
    res.end('Method Not Allowed')
    return
  }

  let requestUrl
  try {
    requestUrl = new URL(req.url, 'http://localhost')
  } catch {
    nodeError(res, 400, 'Bad Request')
    return
  }
  if (!accessTokenMatches(requestUrl.searchParams.get('token'))) {
    nodeError(res, 403, 'Forbidden')
    return
  }

  const token = requestUrl.searchParams.get('media')
  if (token === null || token === '') {
    nodeError(res, 404, 'Not Found')
    return
  }

  let payload
  try {
    payload = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'))
  } catch {
    nodeError(res, 400, 'Bad Request')
    return
  }
  const ref = normalizeRef(payload?.ref)
  if (ref === null) {
    nodeError(res, 400, 'Bad Request')
    return
  }
  const type = mediaTypeOfPayload(payload?.type)

  let hostPath
  try {
    hostPath = attachments.fileHostPath(ref)
  } catch {
    hostPath = undefined
  }
  if (typeof hostPath === 'string' && hostPath !== '') {
    await serveHostFileNode(hostPath, req, res, type)
    return
  }
  if (req.method === 'HEAD') {
    res.writeHead(200, baseHeaders(type, ref.bytes))
    res.end()
    return
  }
  await serveAttachmentBufferNode(ref, attachments, res, type)
}

/** Serve the bundled starter video; it needs no attachment record. */
async function handleDefaultMedia(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' })
    res.end('Method Not Allowed')
    return
  }
  // The starter clip is public repo content, so it deliberately needs no
  // capability token. This keeps a fresh install playing even before the
  // page has obtained its Host API token.
  await serveHostFileNode(DEFAULT_VIDEO_FILE, req, res, 'video/mp4')
}

/**
 * Register the two routes with the Web server. Route disposal follows this
 * plugin's fiber, so unloading or updating the plugin cannot leave a handler
 * pointing at stale state.
 */
export function apply(ctx) {
  const { attachments, webServer } = ctx

  // The custom API routes are reachable before the SPA's cookie gate, so a
  // per-process capability is injected into the page and required by both of
  // them. This keeps another local web origin from writing uploads or reading
  // the attachment store through these routes.
  const injection = `<script>window[${JSON.stringify(TOKEN_GLOBAL)}]=${JSON.stringify(ACCESS_TOKEN)}</script>`
  ctx.effect(
    () =>
      webServer.tapIndex((html) =>
        html.includes('</head>') ? html.replace('</head>', `${injection}</head>`) : `${injection}${html}`,
      ),
    'ascii-video-background: access token',
  )

  ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: `${API_ROOT}/token`,
        // This is a read-only capability value. The response carries no CORS
        // grant, so another web origin cannot read it; the upload route still
        // requires it as a header. Keeping this route free of Fetch Metadata
        // assumptions makes it work in the Desktop renderer as well as a tab.
        resource: () => json(200, { token: ACCESS_TOKEN }),
      }),
    'ascii-video-background: token route',
  )

  ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: STATE_ROUTE,
        handler: (req, res) => handleState(req, res),
      }),
    'ascii-video-background: state route',
  )

  ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: UPLOAD_PATH,
        handler: (req, res) => handleUpload(req, res, attachments),
      }),
    'ascii-video-background: upload route',
  )

  ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: MEDIA_PATH,
        handler: (req, res) => handleFileNode(req, res, attachments),
      }),
    'ascii-video-background: media route',
  )

  ctx.effect(
    () =>
      webServer.register({
        kind: 'exact',
        path: DEFAULT_MEDIA_PATH,
        handler: (req, res) => handleDefaultMedia(req, res),
      }),
    'ascii-video-background: default media route',
  )
}

export const inject = ['webServer', 'attachments']

export const name = 'dsh-ascii-video-background'
