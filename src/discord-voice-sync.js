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

function supabaseUrl(env) {
  return String(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '')
}

function supabaseKey(env) {
  return String(env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY)
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

function isSnowflake(value) {
  return /^\d{15,22}$/.test(String(value || '').trim())
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
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
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
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

function bearerToken(request) {
  return String(request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i)?.[1] || ''
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
        'User-Agent': 'IEL-Voice-Sync/1.0',
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

function normalized(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US')
}

function slug(value) {
  return String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 52) || 'team'
}

function voiceChannelName(week, teamName) {
  return `w${week}-${slug(teamName)}-vc`.slice(0, 100)
}

function snowflakeCompare(a, b) {
  try {
    const left = BigInt(String(a?.id || '0'))
    const right = BigInt(String(b?.id || '0'))
    if (left < right) return -1
    if (left > right) return 1
    return 0
  } catch {
    return String(a?.id || '').localeCompare(String(b?.id || ''))
  }
}

function voiceOverwrites(guildId, accessRoleIds, staffAndBotRoleIds) {
  const roles = [...new Set([...accessRoleIds, ...staffAndBotRoleIds].filter(Boolean).map(String))]
  return [
    { id: guildId, type: 0, allow: '0', deny: VOICE_DENY },
    ...roles.map((id) => ({ id, type: 0, allow: VOICE_ALLOW, deny: '0' })),
  ]
}

async function botRoleIds(env, guildId) {
  const bot = await discordRequest(env, '/users/@me')
  if (!isSnowflake(bot?.id)) return []
  const member = await discordRequest(env, `/guilds/${guildId}/members/${bot.id}`)
  return Array.isArray(member?.roles) ? member.roles.map(String).filter(isSnowflake) : []
}

async function loadWeekContexts(env, token, matchIds) {
  const matches = await db(env, token,
    `matches?select=id,season_id,week,status,team_a_id,team_b_id&id=in.(${matchIds.join(',')})`)
  const active = (matches || []).filter((match) => match.team_a_id && match.team_b_id)
  const teamIds = [...new Set(active.flatMap((match) => [String(match.team_a_id), String(match.team_b_id)]))]
  if (!teamIds.length) return { contexts: [], teamIds: [] }
  const teams = await db(env, token, `teams?select=id,team_name&id=in.(${teamIds.join(',')})`)
  const teamMap = new Map((teams || []).map((team) => [String(team.id), team]))
  const contexts = active.map((match) => ({
    match,
    teamA: teamMap.get(String(match.team_a_id)),
    teamB: teamMap.get(String(match.team_b_id)),
  })).filter((context) => context.teamA && context.teamB)
  return { contexts, teamIds }
}

async function roleMappings(env, token, teamIds) {
  if (!teamIds.length) return new Map()
  const rows = await db(env, token,
    `discord_team_roles?select=team_id,role_id&environment=eq.${ENVIRONMENT}&team_id=in.(${teamIds.join(',')})`)
  return new Map((rows || []).map((row) => [String(row.team_id), String(row.role_id)]))
}

function buildGroups(contexts) {
  const groups = new Map()
  for (const context of contexts) {
    const key = `${context.match.season_id || 'season'}:${context.match.week}`
    if (!groups.has(key)) groups.set(key, { week: context.match.week, teams: new Map(), opponents: new Map() })
    const group = groups.get(key)
    const teamAId = String(context.teamA.id)
    const teamBId = String(context.teamB.id)
    group.teams.set(teamAId, context.teamA)
    group.teams.set(teamBId, context.teamB)
    if (!group.opponents.has(teamAId)) group.opponents.set(teamAId, new Set())
    if (!group.opponents.has(teamBId)) group.opponents.set(teamBId, new Set())
    group.opponents.get(teamAId).add(teamBId)
    group.opponents.get(teamBId).add(teamAId)
  }
  return groups
}

export async function handleDiscordVoiceSync(request, env) {
  const cors = corsHeaders(request, env)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405, cors)

  try {
    const staff = await requireStaff(request, env)
    const settings = assertConfigured(env)
    const body = await request.json().catch(() => ({}))
    const matchIds = [...new Set((Array.isArray(body.matchIds) ? body.matchIds : []).map(String).filter(isUuid))]
    if (!matchIds.length) throw apiError(400, 'No active IEL matches were supplied for weekly voice sync.')

    const [{ contexts, teamIds }, botRoles, guildChannels] = await Promise.all([
      loadWeekContexts(env, staff.token, matchIds),
      botRoleIds(env, settings.guildId),
      discordRequest(env, `/guilds/${settings.guildId}/channels`),
    ])
    if (!contexts.length) throw apiError(400, 'IEL could not load any active matchup teams for weekly voice sync.')

    const roleMap = await roleMappings(env, staff.token, teamIds)
    const categories = (guildChannels || [])
      .filter((channel) => Number(channel.type) === 4 && normalized(channel.name) === normalized(settings.categoryName))
      .sort(snowflakeCompare)
    let category = categories[0] || null
    if (!category) {
      category = await discordRequest(env, `/guilds/${settings.guildId}/channels`, {
        method: 'POST',
        body: JSON.stringify({ name: settings.categoryName, type: 4 }),
      })
      guildChannels.push(category)
    }

    const staffAndBotRoles = [...new Set([...settings.staffRoleIds, ...botRoles])]
    const groups = buildGroups(contexts)
    const voiceChannels = []
    const warnings = []

    for (const group of groups.values()) {
      for (const [teamId, team] of group.teams.entries()) {
        const ownRoleId = roleMap.get(teamId)
        if (!ownRoleId) {
          warnings.push(`${team.team_name} has no saved Discord team role mapping, so its weekly VC could not be synced.`)
          continue
        }
        const opponentTeamIds = [...(group.opponents.get(teamId) || [])]
        const opponentRoleIds = opponentTeamIds.map((opponentId) => roleMap.get(opponentId)).filter(Boolean)
        const accessRoleIds = [ownRoleId, ...opponentRoleIds]
        const name = voiceChannelName(group.week, team.team_name)
        let channel = (guildChannels || []).find((item) => Number(item.type) === 2 && normalized(item.name) === normalized(name)) || null
        const patch = {
          name,
          parent_id: category.id,
          permission_overwrites: voiceOverwrites(settings.guildId, accessRoleIds, staffAndBotRoles),
        }
        if (channel?.id) {
          channel = await discordRequest(env, `/channels/${channel.id}`, {
            method: 'PATCH',
            body: JSON.stringify(patch),
          })
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
          opponentTeamIds,
          accessRoleIds,
        })
      }
    }

    return json({
      ok: true,
      processedMatches: contexts.length,
      voiceChannels,
      warnings,
    }, 200, cors)
  } catch (error) {
    return json({ error: error.message || 'IEL could not sync weekly Discord voice channels.' }, error.status || 500, cors)
  }
}
