import { handleDiscordTestRequest } from './discord-test-v2.js'

const DISCORD_API = 'https://discord.com/api/v10'
const DEFAULT_SUPABASE_URL = 'https://qbgmqakdxissnsjazjws.supabase.co'
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_B0rOVxLsBbdB06KBtLO1aw_w_DN3UwI'
const ENVIRONMENT = 'test'
const VIEW_CHANNEL = 1n << 10n
const CONNECT = 1n << 20n
const SPEAK = 1n << 21n
const STREAM = 1n << 9n
const VOICE_ALLOW = String(VIEW_CHANNEL | CONNECT | SPEAK | STREAM)
const VOICE_DENY = String(VIEW_CHANNEL | CONNECT)
const IEL_COLOR = 0xd9ab45

function supabaseUrl(env) {
  return String(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '')
}
function supabaseKey(env) {
  return String(env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY)
}
function bearerToken(request) {
  return String(request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1] || ''
}
function isSnowflake(value) {
  return /^\d{15,22}$/.test(String(value || '').trim())
}
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}
function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  })
}
function apiError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}
function allowedOrigins(env) {
  const set = new Set([
    'https://honoringbills.github.io',
    'https://inevitableeliteleague.com',
    'https://www.inevitableeliteleague.com',
  ])
  String(env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean).forEach((value) => set.add(value))
  return set
}
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || ''
  if (!origin || !allowedOrigins(env).has(origin)) return {}
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  }
}
function config(env) {
  return {
    guildId: String(env.DISCORD_TEST_GUILD_ID || '').trim(),
    botToken: String(env.DISCORD_BOT_TOKEN || '').trim(),
    categoryName: String(env.DISCORD_TEST_CATEGORY_NAME || 'Match Ups').trim() || 'Match Ups',
    staffRoleIds: String(env.DISCORD_TEST_STAFF_ROLE_IDS || '').split(',').map((value) => value.trim()).filter(isSnowflake),
  }
}
function assertConfigured(env) {
  const settings = config(env)
  if (!settings.botToken) throw apiError(503, 'Discord bot token is not configured.')
  if (!isSnowflake(settings.guildId)) throw apiError(503, 'Discord test guild ID is not configured.')
  return settings
}
function authHeaders(env, token, extra = {}) {
  return {
    apikey: supabaseKey(env),
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}
async function db(env, token, path, options = {}) {
  const response = await fetch(`${supabaseUrl(env)}/rest/v1/${path}`, {
    ...options,
    headers: authHeaders(env, token, options.headers || {}),
  })
  const text = response.status === 204 ? '' : await response.text()
  if (!response.ok) throw apiError(response.status, text || `IEL database request failed (${response.status}).`)
  return text ? JSON.parse(text) : null
}
async function requireStaff(request, env) {
  const token = bearerToken(request)
  if (!token) throw apiError(401, 'Sign in to IEL Staff Command first.')
  const response = await fetch(`${supabaseUrl(env)}/auth/v1/user`, {
    headers: { apikey: supabaseKey(env), Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw apiError(401, 'Your IEL login is invalid or expired.')
  const user = await response.json()
  const staff = (await db(env, token, `staff_members?select=user_id,is_active&user_id=eq.${encodeURIComponent(user.id)}&limit=1`))?.[0]
  if (!staff?.is_active) throw apiError(403, 'Active IEL staff access is required.')
  return { token, user }
}
function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
async function discordRequest(env, path, options = {}) {
  const { botToken } = assertConfigured(env)
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(`${DISCORD_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bot ${botToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'IEL-Match-Ops/1.0',
        ...(options.headers || {}),
      },
    })
    if (response.status === 204) return null
    const text = await response.text()
    let payload = null
    try { payload = text ? JSON.parse(text) : null } catch { payload = text }
    if (response.ok) return payload
    if (response.status === 429 && attempt < 4) {
      const retrySeconds = Number(payload?.retry_after || response.headers.get('Retry-After') || 1)
      await wait(Math.min(Math.max(retrySeconds * 1000, 250), 10000))
      continue
    }
    if (response.status >= 500 && attempt < 4) {
      await wait(350 * attempt)
      continue
    }
    const detail = payload?.message || (typeof payload === 'string' ? payload : '') || `Discord API ${response.status}`
    throw apiError(response.status === 401 ? 502 : response.status, `Discord: ${detail}`)
  }
  throw apiError(502, 'Discord request failed after multiple attempts.')
}
function slug(value) {
  return String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 52) || 'team'
}
function normalized(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US')
}
function voiceChannelName(week, teamName) {
  return `w${week}-${slug(teamName)}-vc`.slice(0, 100)
}
function explicitMentions(roleIds = []) {
  return { parse: [], roles: [...new Set(roleIds.filter(Boolean).map(String))], users: [], replied_user: false }
}
function voiceOverwrites(guildId, accessRoleIds, staffRoleIds) {
  const roles = [...new Set([...accessRoleIds, ...staffRoleIds].filter(Boolean).map(String))]
  return [
    { id: guildId, type: 0, allow: '0', deny: VOICE_DENY },
    ...roles.map((id) => ({ id, type: 0, allow: VOICE_ALLOW, deny: '0' })),
  ]
}
async function loadMatch(env, token, matchId) {
  const match = (await db(env, token,
    `matches?select=id,season_id,match_code,week,round_number,division,best_of,scheduled_at,status,team_a_id,team_b_id&id=eq.${encodeURIComponent(matchId)}&limit=1`))?.[0]
  if (!match) throw apiError(404, 'IEL match not found.')
  const teams = await db(env, token,
    `teams?select=id,team_name,division&id=in.(${match.team_a_id},${match.team_b_id})`)
  const byId = new Map((teams || []).map((team) => [String(team.id), team]))
  const teamA = byId.get(String(match.team_a_id))
  const teamB = byId.get(String(match.team_b_id))
  if (!teamA || !teamB) throw apiError(404, 'IEL could not load both teams for this matchup.')
  return { match, teamA, teamB }
}
async function teamRoleMappings(env, token, teamIds) {
  if (!teamIds.length) return new Map()
  const rows = await db(env, token,
    `discord_team_roles?select=team_id,role_id&environment=eq.${ENVIRONMENT}&team_id=in.(${teamIds.join(',')})`)
  return new Map((rows || []).map((row) => [String(row.team_id), String(row.role_id)]))
}
async function recentMessages(env, channelId) {
  const rows = await discordRequest(env, `/channels/${channelId}/messages?limit=50`)
  return Array.isArray(rows) ? rows : []
}
function simpleWelcomePayload(context, roleAId, roleBId, staffRoleIds) {
  const staffRoleId = staffRoleIds[0] || null
  const staffText = staffRoleId ? `<@&${staffRoleId}>` : '**@Staff**'
  return {
    content: `<@&${roleAId}> <@&${roleBId}>`,
    allowed_mentions: explicitMentions([roleAId, roleBId]),
    embeds: [{
      author: { name: 'INEVITABLE ELITE LEAGUE' },
      title: `WEEK ${context.match.week} // MATCH CHANNEL`,
      description: `This is your official match channel.\n\n<@&${roleAId}> is **Team A**\n<@&${roleBId}> is **Team B**\n\nGood luck in **Week ${context.match.week}**! Please complete your **veto** and **match scheduling** below.\n\nNeed any help? Just tag ${staffText}.`,
      color: IEL_COLOR,
      footer: { text: `IEL // ${context.match.match_code || context.match.id}` },
      timestamp: new Date().toISOString(),
    }],
  }
}
async function simplifyWelcome(env, channelId, context, roleAId, roleBId, staffRoleIds) {
  const messages = await recentMessages(env, channelId)
  const existing = messages.find((message) => {
    const author = String(message?.embeds?.[0]?.author?.name || '')
    return author === 'INEVITABLE ELITE LEAGUE // MATCH OPERATIONS' || author === 'INEVITABLE ELITE LEAGUE'
  })
  const payload = simpleWelcomePayload(context, roleAId, roleBId, staffRoleIds)
  if (existing?.id) {
    await discordRequest(env, `/channels/${channelId}/messages/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    })
    return existing.id
  }
  const message = await discordRequest(env, `/channels/${channelId}/messages`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  return message?.id || null
}
function internalMatchupRequest(request, matchId) {
  const url = new URL('/api/staff/discord/test/matchup', request.url)
  const headers = new Headers()
  const authorization = request.headers.get('Authorization')
  const origin = request.headers.get('Origin')
  if (authorization) headers.set('Authorization', authorization)
  if (origin) headers.set('Origin', origin)
  headers.set('Content-Type', 'application/json')
  return new Request(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ matchId }),
  })
}
async function createOrSyncSingleMatchup(request, env, matchId, staff = null) {
  const activeStaff = staff || await requireStaff(request, env)
  const context = await loadMatch(env, activeStaff.token, matchId)
  const response = await handleDiscordTestRequest(internalMatchupRequest(request, matchId), env)
  const payload = await response.clone().json().catch(() => ({}))
  if (!response.ok) throw apiError(response.status, payload.error || `IEL could not create ${context.match.match_code || 'the matchup'}.`)
  const settings = assertConfigured(env)
  await simplifyWelcome(env, payload.channelId, context, payload.roleA?.id, payload.roleB?.id, settings.staffRoleIds)
  return { ...payload, matchId, context }
}
async function ensureCategory(env, guildChannels) {
  const settings = assertConfigured(env)
  let category = (guildChannels || []).find((channel) => Number(channel.type) === 4 && normalized(channel.name) === normalized(settings.categoryName)) || null
  if (category) return category
  category = await discordRequest(env, `/guilds/${settings.guildId}/channels`, {
    method: 'POST',
    body: JSON.stringify({ name: settings.categoryName, type: 4 }),
  })
  guildChannels.push(category)
  return category
}
async function ensureWeeklyVoiceChannels(env, token, syncedResults) {
  const settings = assertConfigured(env)
  const contexts = syncedResults.map((result) => result.context)
  const teamIds = [...new Set(contexts.flatMap((context) => [String(context.teamA.id), String(context.teamB.id)]))]
  const roleMap = await teamRoleMappings(env, token, teamIds)
  const groups = new Map()

  for (const context of contexts) {
    const key = `${context.match.season_id || 'season'}:${context.match.week}`
    if (!groups.has(key)) groups.set(key, { week: context.match.week, contexts: [], teams: new Map(), opponents: new Map() })
    const group = groups.get(key)
    group.contexts.push(context)
    group.teams.set(String(context.teamA.id), context.teamA)
    group.teams.set(String(context.teamB.id), context.teamB)
    if (!group.opponents.has(String(context.teamA.id))) group.opponents.set(String(context.teamA.id), new Set())
    if (!group.opponents.has(String(context.teamB.id))) group.opponents.set(String(context.teamB.id), new Set())
    group.opponents.get(String(context.teamA.id)).add(String(context.teamB.id))
    group.opponents.get(String(context.teamB.id)).add(String(context.teamA.id))
  }

  const guildChannels = await discordRequest(env, `/guilds/${settings.guildId}/channels`)
  const category = await ensureCategory(env, guildChannels)
  const voiceChannels = []

  for (const group of groups.values()) {
    for (const [teamId, team] of group.teams.entries()) {
      const ownRoleId = roleMap.get(teamId)
      if (!ownRoleId) continue
      const opponentRoleIds = [...(group.opponents.get(teamId) || [])].map((opponentId) => roleMap.get(opponentId)).filter(Boolean)
      const accessRoleIds = [ownRoleId, ...opponentRoleIds]
      const name = voiceChannelName(group.week, team.team_name)
      let channel = (guildChannels || []).find((item) => Number(item.type) === 2 && item.parent_id === category.id && normalized(item.name) === normalized(name)) || null
      const patch = {
        name,
        parent_id: category.id,
        permission_overwrites: voiceOverwrites(settings.guildId, accessRoleIds, settings.staffRoleIds),
      }
      if (channel?.id) {
        channel = await discordRequest(env, `/channels/${channel.id}`, { method: 'PATCH', body: JSON.stringify(patch) })
      } else {
        channel = await discordRequest(env, `/guilds/${settings.guildId}/channels`, {
          method: 'POST',
          body: JSON.stringify({ type: 2, ...patch }),
        })
        guildChannels.push(channel)
      }
      voiceChannels.push({
        teamId,
        teamName: team.team_name,
        week: group.week,
        channelId: channel.id,
        channelName: channel.name,
        accessRoleIds,
        opponentTeamIds: [...(group.opponents.get(teamId) || [])],
      })
    }
  }
  return voiceChannels
}
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length)
  let nextIndex = 0
  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      try {
        results[index] = { ok: true, value: await worker(items[index]) }
      } catch (error) {
        results[index] = { ok: false, error, item: items[index] }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => consume()))
  return results
}

async function handleSingle(request, env) {
  const cors = corsHeaders(request, env)
  try {
    const staff = await requireStaff(request, env)
    const body = await request.json().catch(() => ({}))
    const matchId = String(body.matchId || '')
    if (!isUuid(matchId)) throw apiError(400, 'Choose a valid IEL match.')
    const result = await createOrSyncSingleMatchup(request, env, matchId, staff)
    const voiceChannels = await ensureWeeklyVoiceChannels(env, staff.token, [result])
    const { context, ...safe } = result
    return json({ ...safe, voiceChannels }, 200, cors)
  } catch (error) {
    return json({ error: error.message || 'IEL could not create the Discord matchup.' }, error.status || 500, cors)
  }
}
async function handleAll(request, env) {
  const cors = corsHeaders(request, env)
  try {
    const staff = await requireStaff(request, env)
    const body = await request.json().catch(() => ({}))
    const matchIds = [...new Set((Array.isArray(body.matchIds) ? body.matchIds : []).map(String).filter(isUuid))]
    if (!matchIds.length) throw apiError(400, 'No active IEL matches were supplied for Discord generation.')

    const attempts = await runWithConcurrency(matchIds, 2, (matchId) => createOrSyncSingleMatchup(request, env, matchId, staff))
    const successful = attempts.filter((item) => item.ok).map((item) => item.value)
    const failures = attempts.filter((item) => !item.ok).map((item) => ({
      matchId: item.item,
      error: String(item.error?.message || item.error || 'Unknown Discord error'),
    }))
    const voiceChannels = successful.length ? await ensureWeeklyVoiceChannels(env, staff.token, successful) : []
    const results = successful.map(({ context, ...result }) => ({ ...result, matchId: context.match.id, matchCode: context.match.match_code }))
    const warnings = results.flatMap((result) => Array.isArray(result.warnings) ? result.warnings.map((warning) => `${result.matchCode || result.matchId}: ${warning}`) : [])

    return json({
      ok: failures.length === 0,
      processed: matchIds.length,
      synced: successful.length,
      created: results.filter((result) => result.created).length,
      existing: results.filter((result) => !result.created).length,
      results,
      voiceChannels,
      warnings,
      failures,
    }, failures.length ? 207 : 200, cors)
  } catch (error) {
    return json({ error: error.message || 'IEL could not generate all Discord matchups.' }, error.status || 500, cors)
  }
}

async function deleteDiscordChannelIfPresent(env, channelId) {
  if (!channelId) return false
  try {
    await discordRequest(env, `/channels/${channelId}`, { method: 'DELETE' })
    return true
  } catch (error) {
    if (error.status === 404) return false
    throw error
  }
}
async function teamWeekFinished(env, token, match, teamId) {
  const rows = await db(env, token,
    `matches?select=id,status,team_a_id,team_b_id&season_id=eq.${encodeURIComponent(match.season_id)}&week=eq.${encodeURIComponent(match.week)}&or=(team_a_id.eq.${teamId},team_b_id.eq.${teamId})`)
  const active = (rows || []).filter((row) => row.team_a_id && row.team_b_id)
  return Boolean(active.length && active.every((row) => ['complete', 'cancelled', 'bye'].includes(String(row.status || '').toLowerCase())))
}
async function cleanupTeamVoiceIfFinished(env, token, match, team) {
  if (!(await teamWeekFinished(env, token, match, team.id))) return null
  const settings = assertConfigured(env)
  const channels = await discordRequest(env, `/guilds/${settings.guildId}/channels`)
  const name = voiceChannelName(match.week, team.team_name)
  const channel = (channels || []).find((item) => Number(item.type) === 2 && normalized(item.name) === normalized(name))
  if (!channel?.id) return null
  await deleteDiscordChannelIfPresent(env, channel.id)
  return channel.id
}
export async function cleanupCompletedMatchDiscord(request, env, matchId) {
  if (!isUuid(matchId)) return { deletedMatchChannel: false, deletedVoiceChannels: [] }
  const staff = await requireStaff(request, env)
  const context = await loadMatch(env, staff.token, matchId)
  if (String(context.match.status || '').toLowerCase() !== 'complete') return { deletedMatchChannel: false, deletedVoiceChannels: [] }

  const mapping = (await db(env, staff.token,
    `match_discord_channels?select=id,channel_id&match_id=eq.${encodeURIComponent(matchId)}&environment=eq.${ENVIRONMENT}&limit=1`))?.[0]
  let deletedMatchChannel = false
  if (mapping?.channel_id) deletedMatchChannel = await deleteDiscordChannelIfPresent(env, mapping.channel_id)
  if (mapping?.id) {
    await db(env, staff.token, `match_discord_channels?id=eq.${encodeURIComponent(mapping.id)}`, { method: 'DELETE' }).catch(() => null)
  }

  const deletedVoiceChannels = []
  for (const team of [context.teamA, context.teamB]) {
    try {
      const deleted = await cleanupTeamVoiceIfFinished(env, staff.token, context.match, team)
      if (deleted) deletedVoiceChannels.push(deleted)
    } catch (error) {
      console.warn('[IEL DISCORD] weekly voice cleanup failed', team.team_name, error)
    }
  }
  return { deletedMatchChannel, deletedVoiceChannels }
}

export async function handleDiscordMatchOpsRequest(request, env) {
  const cors = corsHeaders(request, env)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const url = new URL(request.url)
  if (request.method === 'POST' && url.pathname === '/api/staff/discord/test/matchup') return handleSingle(request, env)
  if (request.method === 'POST' && url.pathname === '/api/staff/discord/test/all') return handleAll(request, env)
  return handleDiscordTestRequest(request, env)
}
