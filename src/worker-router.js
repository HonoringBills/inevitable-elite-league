import app from './worker-entry.js'
import { handleDiscordInteractionRequest } from './discord-test-v2.js'
import { cleanupCompletedMatchDiscord, handleDiscordMatchOpsRequest } from './discord-match-ops.js'
import { handleDiscordVoiceSync } from './discord-voice-sync.js'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/discord/interactions') {
      return handleDiscordInteractionRequest(request, env)
    }
    if (url.pathname === '/api/staff/discord/test/voice-sync') {
      return handleDiscordVoiceSync(request, env)
    }
    if (url.pathname.startsWith('/api/staff/discord/test/')) {
      return handleDiscordMatchOpsRequest(request, env)
    }
    if (url.pathname === '/api/staff/scoreboards/commit' && request.method === 'POST') {
      const authRequest = request.clone()
      const bodyPromise = request.clone().json().catch(() => ({}))
      const response = await app.fetch(request, env, ctx)
      if (response.ok) {
        try {
          const [payload, body] = await Promise.all([
            response.clone().json().catch(() => ({})),
            bodyPromise,
          ])
          if (payload?.complete && body?.matchId) {
            await cleanupCompletedMatchDiscord(authRequest, env, String(body.matchId))
          }
        } catch (error) {
          // Reporting remains the source of truth even if Discord cleanup is
          // temporarily unavailable. A later bulk sync can repair channels.
          console.warn('[IEL DISCORD] completed-match cleanup failed', error)
        }
      }
      return response
    }
    return app.fetch(request, env, ctx)
  },
}
