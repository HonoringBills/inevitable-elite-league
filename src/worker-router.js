import app from './worker-entry.js'
import { handleDiscordInteractionRequest, handleDiscordTestRequest } from './discord-test-v2.js'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname === '/discord/interactions') {
      return handleDiscordInteractionRequest(request, env)
    }
    if (url.pathname.startsWith('/api/staff/discord/test/')) {
      return handleDiscordTestRequest(request, env)
    }
    return app.fetch(request, env, ctx)
  },
}
