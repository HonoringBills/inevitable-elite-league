import app from './worker.js'

const SCOREBOARD_ORIGIN = 'https://qbgmqakdxissnsjazjws.supabase.co'
const SCOREBOARD_PATH_PREFIX = '/storage/v1/object/public/scoreboards/'
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

function apiError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

function isAllowedScoreboardUrl(value) {
  try {
    const url = new URL(String(value || ''))
    return url.origin === SCOREBOARD_ORIGIN && url.pathname.startsWith(SCOREBOARD_PATH_PREFIX)
  } catch {
    return false
  }
}

function bytesToBase64(bytes) {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

async function scoreboardDataUrl(httpUrl) {
  if (!isAllowedScoreboardUrl(httpUrl)) {
    throw apiError(400, 'Qwen image input must come from the IEL scoreboards bucket.')
  }

  const response = await fetch(httpUrl, {
    headers: { Accept: 'image/png,image/jpeg,image/webp' },
    cf: { cacheTtl: 60, cacheEverything: true },
  })

  if (!response.ok) {
    throw apiError(502, `IEL could not fetch the scoreboard image (${response.status}).`)
  }

  const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    throw apiError(400, `Unsupported scoreboard image type: ${contentType || 'unknown'}.`)
  }

  const declaredLength = Number(response.headers.get('content-length') || 0)
  if (declaredLength > MAX_IMAGE_BYTES) {
    throw apiError(413, 'Scoreboard image exceeds the 12 MB IEL limit.')
  }

  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw apiError(413, 'Scoreboard image exceeds the 12 MB IEL limit.')
  }

  return `data:${contentType};base64,${bytesToBase64(new Uint8Array(buffer))}`
}

async function hydrateVisionContent(content) {
  if (!Array.isArray(content)) return content

  const hydrated = []
  for (const part of content) {
    if (part?.type === 'image_url' && typeof part?.image_url?.url === 'string') {
      const source = part.image_url.url
      if (source.startsWith('data:image/')) {
        hydrated.push(part)
      } else {
        hydrated.push({
          ...part,
          image_url: {
            ...part.image_url,
            url: await scoreboardDataUrl(source),
          },
        })
      }
    } else {
      hydrated.push(part)
    }
  }
  return hydrated
}

async function hydrateVisionInput(input) {
  if (!input || !Array.isArray(input.messages)) return input

  const messages = []
  for (const message of input.messages) {
    messages.push({
      ...message,
      content: await hydrateVisionContent(message.content),
    })
  }

  return { ...input, messages }
}

function wrappedEnv(env) {
  if (!env.AI?.run) return env

  return {
    ...env,
    AI: {
      run: async (model, input, options) => {
        const hydrated = await hydrateVisionInput(input)
        return env.AI.run(model, hydrated, options)
      },
    },
  }
}

export default {
  async fetch(request, env, ctx) {
    return app.fetch(request, wrappedEnv(env), ctx)
  },
}
