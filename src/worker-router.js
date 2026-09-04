import app from './worker-entry.js'
import { handleDiscordTestRequest } from './discord-test.js'

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/staff/discord/test/')) {
      return handleDiscordTestRequest(request, env)
    }
    return app.fetch(request, env, ctx)
  },
}
