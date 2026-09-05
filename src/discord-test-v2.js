const DISCORD_API = 'https://discord.com/api/v10'
const DEFAULT_SUPABASE_URL = 'https://qbgmqakdxissnsjazjws.supabase.co'
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_B0rOVxLsBbdB06KBtLO1aw_w_DN3UwI'
const DEFAULT_ORIGINS = new Set([
  'https://honoringbills.github.io',
  'https://inevitableeliteleague.com',
  'https://www.inevitableeliteleague.com',
])
const ENVIRONMENT = 'test'
const VIEW_CHANNEL = 1024n
const SEND_MESSAGES = 2048n
const MANAGE_MESSAGES = 8192n
const EMBED_LINKS = 16384n
const ATTACH_FILES = 32768n
const READ_MESSAGE_HISTORY = 65536n
const MEMBER_ALLOW = String(VIEW_CHANNEL | SEND_MESSAGES | EMBED_LINKS | ATTACH_FILES | READ_MESSAGE_HISTORY)
const STAFF_ALLOW = String(VIEW_CHANNEL | SEND_MESSAGES | MANAGE_MESSAGES | EMBED_LINKS | ATTACH_FILES | READ_MESSAGE_HISTORY)
const IEL_VETO_COLOR = 0xd9ab45
const IEL_VETO_PREFIX = 'iel_veto'

// Mirrors Blacksite's current competitive BO5 pools and veto order.
const VETO_POOLS = Object.freeze({
  hp: Object.freeze(['Sake', 'Frequency', 'Den', 'Scar', 'Gridlock', 'Hacienda', 'Colossus']),
  snd: Object.freeze(['Den', 'Gridlock', 'Raid', 'Fringe', 'Sake', 'Hacienda']),
  ovl: Object.freeze(['Den', 'Exposure', 'Scar', 'Gridlock']),
})
const VETO_STEPS = Object.freeze([
  Object.freeze({ team: 'A', action: 'ban', mode: 'hp' }),
  Object.freeze({ team: 'B', action: 'ban', mode: 'hp' }),
  Object.freeze({ team: 'A', action: 'pick', mode: 'hp', slot: 'map1' }),
  Object.freeze({ team: 'B', action: 'pick', mode: 'hp', slot: 'map4' }),
  Object.freeze({ team: 'B', action: 'ban', mode: 'snd' }),
  Object.freeze({ team: 'A', action: 'ban', mode: 'snd' }),
  Object.freeze({ team: 'B', action: 'pick', mode: 'snd', slot: 'map2' }),
  Object.freeze({ team: 'A', action: 'pick', mode: 'snd', slot: 'map5' }),
  Object.freeze({ team: 'A', action: 'ban', mode: 'ovl' }),
  Object.freeze({ team: 'B', action: 'ban', mode: 'ovl' }),
  Object.freeze({ team: 'A', action: 'pick', mode: 'ovl', slot: 'map3' }),
])
const MODE_LABELS = Object.freeze({ hp: 'Hardpoint', snd: 'Search & Destroy', ovl: 'Overload' })

let applicationKeyCache = { value: '', expiresAt: 0 }

function supabaseUrl(env) {
  return String(env.SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/$/, '')
}
function supabaseKey(env) {
  return String(env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY)
}
function allowedOrigins(env) {
  const set = new Set(DEFAULT_ORIGINS)
  String(env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean).forEach((origin) => set.add(origin))
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
async function getStaff(request, env) {
  const token = bearerToken(request)
  if (!token) throw apiError(401, 'Sign in to IEL Staff Command first.')
  const userResponse = await fetch(`${supabaseUrl(env)}/auth/v1/user`, {
    headers: { apikey: supabaseKey(env), Authorization: `Bearer ${token}` },
  })
  if (!userResponse.ok) throw apiError(401, 'Your IEL login is invalid or expired.')
  const user = await userResponse.json()
  const staffRows = await db(env, token, `staff_members?select=user_id,display_name,role,is_active&user_id=eq.${encodeURIComponent(user.id)}&limit=1`)
  const staff = staffRows?.[0]
  if (!staff?.is_active) throw apiError(403, 'Active IEL staff access is required.')
  return { user, staff, token }
}
function isSnowflake(value) {
  return /^\d{15,22}$/.test(String(value || '').trim())
}
function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
}
function config(env) {
  const guildId = String(env.DISCORD_TEST_GUILD_ID || '').trim()
  const botToken = String(env.DISCORD_BOT_TOKEN || '').trim()
  const categoryName = String(env.DISCORD_TEST_CATEGORY_NAME || 'Match Ups').trim() || 'Match Ups'
  const staffRoleIds = String(env.DISCORD_TEST_STAFF_ROLE_IDS || '')
    .split(',').map((value) => value.trim()).filter(isSnowflake)
  return { guildId, botToken, categoryName, staffRoleIds }
}
function assertConfigured(env) {
  const settings = config(env)
  if (!settings.botToken) throw apiError(503, 'Discord test bot token is not configured in Cloudflare yet.')
  if (!isSnowflake(settings.guildId)) throw apiError(503, 'DISCORD_TEST_GUILD_ID is not configured with the test server ID yet.')
  return settings
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
        'User-Agent': 'IEL-Test-Matchups/2.0',
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

async function loadMatchContext(env, token, matchId) {
  const match = (await db(env, token,
    `matches?select=id,match_code,week,round_number,division,best_of,scheduled_at,status,team_a_id,team_b_id&id=eq.${encodeURIComponent(matchId)}&limit=1`))?.[0]
  if (!match) throw apiError(404, 'IEL match not found.')
  const teams = await db(env, token,
    `teams?select=id,team_name,division&id=in.(${match.team_a_id},${match.team_b_id})`)
  const teamMap = new Map((teams || []).map((team) => [String(team.id), team]))
  const teamA = teamMap.get(String(match.team_a_id))
  const teamB = teamMap.get(String(match.team_b_id))
  if (!teamA || !teamB) throw apiError(404, 'IEL could not load both teams for this matchup.')
  return { match, teamA, teamB }
}
function teamRoleName(teamName) {
  return String(teamName || 'Team').trim().slice(0, 100)
}
function normalizedRoleName(value) {
  return String(value || '').trim().toLocaleLowerCase('en-US')
}
function findExactTeamRole(guildRoles, teamName) {
  const expected = normalizedRoleName(teamRoleName(teamName))
  return (guildRoles || []).find((role) => !role.managed && normalizedRoleName(role.name) === expected) || null
}
function slug(value) {
  return String(value || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 34) || 'team'
}
async function saveRoleMapping(env, token, teamId, guildId, roleId) {
  const existing = (await db(env, token,
    `discord_team_roles?select=id&team_id=eq.${encodeURIComponent(teamId)}&environment=eq.${ENVIRONMENT}&limit=1`))?.[0]
  const patch = {
    team_id: teamId,
    environment: ENVIRONMENT,
    guild_id: guildId,
    role_id: roleId,
    updated_at: new Date().toISOString(),
  }
  if (existing?.id) {
    await db(env, token, `discord_team_roles?id=eq.${encodeURIComponent(existing.id)}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    })
    return
  }
  await db(env, token, 'discord_team_roles', { method: 'POST', body: JSON.stringify(patch) })
}
async function ensureTeamRole(env, token, guildId, team, guildRoles) {
  const expectedName = teamRoleName(team.team_name)
  const saved = (await db(env, token,
    `discord_team_roles?select=role_id&team_id=eq.${encodeURIComponent(team.id)}&environment=eq.${ENVIRONMENT}&limit=1`))?.[0]
  const savedRole = saved?.role_id ? (guildRoles || []).find((role) => String(role.id) === String(saved.role_id)) : null

  // The Discord role named exactly after the registered team is authoritative.
  // A stale IEL | Team mapping is deliberately ignored and replaced below.
  let role = findExactTeamRole(guildRoles, expectedName)
  if (!role && savedRole && normalizedRoleName(savedRole.name) === normalizedRoleName(expectedName)) role = savedRole
  if (!role) {
    role = await discordRequest(env, `/guilds/${guildId}/roles`, {
      method: 'POST',
      body: JSON.stringify({ name: expectedName, hoist: false, mentionable: true, permissions: '0' }),
    })
    guildRoles.push(role)
  }
  await saveRoleMapping(env, token, team.id, guildId, role.id)
  return role
}
async function assignTeamMembers(env, token, guildId, team, roleId) {
  const rows = await db(env, token,
    `team_members?select=gamertag,discord_user_id&team_id=eq.${encodeURIComponent(team.id)}&is_active=eq.true&order=roster_order.asc`)
  const warnings = []
  const members = (rows || []).filter((member) => isSnowflake(member.discord_user_id))
  if (!members.length) {
    warnings.push(`${team.team_name} has no Discord user IDs saved yet, so the existing team role was used but no members were auto-assigned.`)
    return { assigned: 0, warnings }
  }
  let assigned = 0
  for (const member of members) {
    try {
      await discordRequest(env, `/guilds/${guildId}/members/${member.discord_user_id}/roles/${roleId}`, { method: 'PUT' })
      assigned += 1
    } catch (error) {
      warnings.push(`${member.gamertag || member.discord_user_id} could not be assigned to ${team.team_name}: ${error.message}`)
    }
  }
  return { assigned, warnings }
}
async function ensureCategory(env, guildId, guildChannels, staffRoleIds, categoryName) {
  let category = (guildChannels || []).find((channel) => Number(channel.type) === 4 && normalizedRoleName(channel.name) === normalizedRoleName(categoryName)) || null
  if (category) return category
  category = await discordRequest(env, `/guilds/${guildId}/channels`, {
    method: 'POST',
    body: JSON.stringify({
      name: categoryName,
      type: 4,
      permission_overwrites: [
        { id: guildId, type: 0, allow: '0', deny: String(VIEW_CHANNEL) },
        ...staffRoleIds.map((id) => ({ id, type: 0, allow: STAFF_ALLOW, deny: '0' })),
      ],
    }),
  })
  guildChannels.push(category)
  return category
}
function channelOverwrites(guildId, roleAId, roleBId, staffRoleIds) {
  return [
    { id: guildId, type: 0, allow: '0', deny: String(VIEW_CHANNEL) },
    { id: roleAId, type: 0, allow: MEMBER_ALLOW, deny: '0' },
    { id: roleBId, type: 0, allow: MEMBER_ALLOW, deny: '0' },
    ...staffRoleIds.map((id) => ({ id, type: 0, allow: STAFF_ALLOW, deny: '0' })),
  ]
}
async function existingChannelMapping(env, token, matchId) {
  return (await db(env, token,
    `match_discord_channels?select=id,guild_id,category_id,channel_id,team_a_role_id,team_b_role_id&match_id=eq.${encodeURIComponent(matchId)}&environment=eq.${ENVIRONMENT}&limit=1`))?.[0] || null
}
async function saveChannelMapping(env, token, staffUserId, context, guildId, categoryId, channelId, roleAId, roleBId, existing = null) {
  const payload = {
    match_id: context.match.id,
    environment: ENVIRONMENT,
    guild_id: guildId,
    category_id: categoryId,
    channel_id: channelId,
    team_a_role_id: roleAId,
    team_b_role_id: roleBId,
    created_by: staffUserId,
  }
  if (existing?.id) {
    await db(env, token, `match_discord_channels?id=eq.${encodeURIComponent(existing.id)}`, {
      method: 'PATCH', body: JSON.stringify(payload),
    })
    return
  }
  await db(env, token, 'match_discord_channels', { method: 'POST', body: JSON.stringify(payload) })
}
function discordUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`
}
function expectedInteractionEndpoint(request) {
  return new URL('/discord/interactions', request.url).toString()
}
function explicitMentions(roleIds = []) {
  return { parse: [], roles: [...new Set(roleIds.filter(Boolean).map(String))], users: [], replied_user: false }
}

function matchupWelcomePayload(context, roleA, roleB) {
  const scheduled = context.match.scheduled_at
    ? `<t:${Math.floor(new Date(context.match.scheduled_at).getTime() / 1000)}:F>`
    : 'Not confirmed yet'
  return {
    content: `<@&${roleA.id}> <@&${roleB.id}>`,
    allowed_mentions: explicitMentions([roleA.id, roleB.id]),
    embeds: [{
      author: { name: 'INEVITABLE ELITE LEAGUE // MATCH OPERATIONS' },
      title: `WEEK ${context.match.week} // ${context.teamA.team_name} vs ${context.teamB.team_name}`,
      description: `Private IEL match control is online for **${context.teamA.team_name}** and **${context.teamB.team_name}**. Complete the live map veto in the panel directly below.`,
      color: IEL_VETO_COLOR,
      fields: [
        { name: 'MATCH', value: context.match.match_code || context.match.id, inline: true },
        { name: 'FORMAT', value: `Best of ${context.match.best_of || 5}`, inline: true },
        { name: 'SCHEDULED', value: scheduled, inline: true },
      ],
      footer: { text: 'IEL CONTROL // TEST MATCHUP' },
      timestamp: new Date().toISOString(),
    }],
  }
}
async function recentChannelMessages(env, channelId) {
  const rows = await discordRequest(env, `/channels/${channelId}/messages?limit=50`)
  return Array.isArray(rows) ? rows : []
}
function isWelcomeMessage(message) {
  const author = message?.embeds?.[0]?.author?.name || ''
  return author === 'INEVITABLE ELITE LEAGUE // MATCH OPERATIONS' || String(message?.content || '').startsWith('## IEL TEST MATCHUP')
}
async function ensureMatchupWelcome(env, channelId, context, roleA, roleB, messages = null) {
  const rows = messages || await recentChannelMessages(env, channelId)
  const existing = rows.find(isWelcomeMessage)
  const payload = matchupWelcomePayload(context, roleA, roleB)
  if (existing?.id) {
    await discordRequest(env, `/channels/${channelId}/messages/${existing.id}`, {
      method: 'PATCH', body: JSON.stringify(payload),
    })
    return existing.id
  }
  const message = await discordRequest(env, `/channels/${channelId}/messages`, {
    method: 'POST', body: JSON.stringify(payload),
  })
  return message?.id || null
}

function decodeVetoActions(codes) {
  const source = String(codes || '')
  if (source.length > VETO_STEPS.length) return null
  const actions = []
  const used = { hp: new Set(), snd: new Set(), ovl: new Set() }
  for (let index = 0; index < source.length; index += 1) {
    const step = VETO_STEPS[index]
    const pool = VETO_POOLS[step.mode]
    const mapIndex = Number.parseInt(source[index], 36)
    const mapName = Number.isInteger(mapIndex) ? pool[mapIndex] : null
    if (!mapName || used[step.mode].has(mapName)) return null
    used[step.mode].add(mapName)
    actions.push({ stepIndex: index, ...step, mapName })
  }
  return actions
}
function availableMaps(actions, mode) {
  const used = new Set((actions || []).filter((action) => action.mode === mode).map((action) => action.mapName))
  return VETO_POOLS[mode].filter((mapName) => !used.has(mapName))
}
function finalMapset(actions) {
  const mapset = {}
  for (const action of actions || []) {
    if (action.action === 'pick' && action.slot) mapset[action.slot] = { map: action.mapName, mode: action.mode }
  }
  return mapset
}
function mapsetLines(actions) {
  const mapset = finalMapset(actions)
  return [1, 2, 3, 4, 5].map((number) => {
    const entry = mapset[`map${number}`]
    return entry ? `**Map ${number}:** ${entry.map} — ${MODE_LABELS[entry.mode]}` : `**Map ${number}:** Pending`
  }).join('\n')
}
function vetoHistory(actions, context) {
  if (!actions?.length) return ''
  return actions.map((action) => {
    const teamName = action.team === 'A' ? context.teamAName : context.teamBName
    const verb = action.action === 'ban' ? 'banned' : 'picked'
    return `${action.stepIndex + 1}. **${teamName}** ${verb} **${action.mapName}** (${MODE_LABELS[action.mode]})`
  }).join('\n').slice(0, 1024)
}
function makeVetoCustomId(matchId, stepIndex, codes) {
  return `${IEL_VETO_PREFIX}:${matchId}:${stepIndex}:${codes || ''}`
}
function parseVetoCustomId(value) {
  const match = String(value || '').match(/^iel_veto:([0-9a-f-]{36}):(\d{1,2}):([0-9a-z]*)$/i)
  if (!match || !isUuid(match[1])) return null
  const stepIndex = Number(match[2])
  const codes = match[3] || ''
  if (!Number.isInteger(stepIndex) || stepIndex !== codes.length || stepIndex < 0 || stepIndex > VETO_STEPS.length) return null
  if (!decodeVetoActions(codes)) return null
  return { matchId: match[1], stepIndex, codes }
}
function messageVetoContext(message, matchId) {
  const embed = message?.embeds?.[0]
  const fields = Array.isArray(embed?.fields) ? embed.fields : []
  const field = (name) => String(fields.find((item) => String(item.name || '').toUpperCase() === name)?.value || '').trim()
  const teamAName = field('TEAM A')
  const teamBName = field('TEAM B')
  const matchCode = field('MATCH') || matchId
  if (!teamAName || !teamBName) return null
  return { matchId, matchCode, teamAName, teamBName }
}
function vetoPayload(context, roleA, roleB, codes = '') {
  const actions = decodeVetoActions(codes) || []
  const stepIndex = actions.length
  const completed = stepIndex >= VETO_STEPS.length
  const fields = [
    { name: 'TEAM A', value: context.teamAName, inline: true },
    { name: 'TEAM B', value: context.teamBName, inline: true },
    { name: 'MATCH', value: context.matchCode || context.matchId, inline: true },
    { name: 'OFFICIAL BEST-OF-FIVE', value: mapsetLines(actions), inline: false },
  ]
  const history = vetoHistory(actions, context)
  if (history) fields.push({ name: 'VETO HISTORY', value: history, inline: false })

  const payload = {
    content: '',
    allowed_mentions: explicitMentions(),
    embeds: [{
      author: { name: 'INEVITABLE ELITE LEAGUE // VETO CONTROL' },
      title: completed ? 'IEL CONTROL // OFFICIAL MAPSET' : 'IEL CONTROL // LIVE MAP VETO',
      description: completed
        ? `**${context.teamAName}** vs **${context.teamBName}**\n\nThe veto is locked. This is the official IEL best-of-five mapset.`
        : `**${context.teamAName}** vs **${context.teamBName}**\n\nTeam A opens the veto. Complete each step from this live panel; only the team whose turn is shown can submit.`,
      color: IEL_VETO_COLOR,
      fields,
      footer: { text: `IEL VETO // ${context.matchId}` },
      timestamp: new Date().toISOString(),
    }],
    components: [],
  }

  if (completed) {
    payload.content = `<@&${roleA.id}> <@&${roleB.id}> — **MAPSET FINALIZED.**`
    payload.allowed_mentions = explicitMentions([roleA.id, roleB.id])
    return payload
  }

  const step = VETO_STEPS[stepIndex]
  const role = step.team === 'A' ? roleA : roleB
  const teamName = step.team === 'A' ? context.teamAName : context.teamBName
  const actionWord = step.action === 'ban' ? 'BAN' : 'PICK'
  const slotText = step.slot ? ` for ${step.slot.replace('map', 'Map ')}` : ''
  const options = availableMaps(actions, step.mode)
  payload.content = `<@&${role.id}> — it is **${teamName}**'s turn.`
  payload.allowed_mentions = explicitMentions([role.id])
  payload.embeds[0].fields.unshift({
    name: `STEP ${stepIndex + 1} OF ${VETO_STEPS.length}`,
    value: `**${teamName}** must ${actionWord} one **${MODE_LABELS[step.mode]}** map${slotText}.`,
    inline: false,
  })
  payload.components = [{
    type: 1,
    components: [{
      type: 3,
      custom_id: makeVetoCustomId(context.matchId, stepIndex, codes),
      placeholder: `${teamName}: ${actionWord} a ${MODE_LABELS[step.mode]} map`.slice(0, 100),
      min_values: 1,
      max_values: 1,
      options: options.map((mapName) => ({
        label: mapName.slice(0, 100),
        value: mapName,
        description: `${actionWord} ${mapName}`.slice(0, 100),
      })),
    }],
  }]
  return payload
}
function isVetoMessage(message, matchId) {
  const footer = String(message?.embeds?.[0]?.footer?.text || '')
  if (footer === `IEL VETO // ${matchId}`) return true
  return (message?.components || []).some((row) => (row?.components || []).some((component) => String(component?.custom_id || '').startsWith(`${IEL_VETO_PREFIX}:${matchId}:`)))
}
async function ensureVetoMessage(env, channelId, context, roleA, roleB, messages = null) {
  const rows = messages || await recentChannelMessages(env, channelId)
  const existing = rows.find((message) => isVetoMessage(message, context.match.id))
  if (existing?.id) return { messageId: existing.id, created: false }
  const payload = vetoPayload({
    matchId: context.match.id,
    matchCode: context.match.match_code || context.match.id,
    teamAName: context.teamA.team_name,
    teamBName: context.teamB.team_name,
  }, roleA, roleB, '')
  const message = await discordRequest(env, `/channels/${channelId}/messages`, {
    method: 'POST', body: JSON.stringify(payload),
  })
  return { messageId: message?.id || null, created: true }
}
function currentVetoCustomId(message) {
  for (const row of message?.components || []) {
    for (const component of row?.components || []) {
      if (String(component?.custom_id || '').startsWith(`${IEL_VETO_PREFIX}:`)) return String(component.custom_id)
    }
  }
  return ''
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim()
  if (!/^[0-9a-f]+$/i.test(clean) || clean.length % 2) return null
  const bytes = new Uint8Array(clean.length / 2)
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16)
  return bytes
}
async function applicationPublicKey(env) {
  if (applicationKeyCache.value && applicationKeyCache.expiresAt > Date.now()) return applicationKeyCache.value
  const application = await discordRequest(env, '/oauth2/applications/@me')
  const key = String(application?.verify_key || '').trim().toLowerCase()
  if (!key) throw apiError(502, 'Discord application verify key could not be loaded.')
  applicationKeyCache = { value: key, expiresAt: Date.now() + 10 * 60 * 1000 }
  return key
}
async function verifyInteractionRequest(request, env) {
  const signatureHex = String(request.headers.get('X-Signature-Ed25519') || '').trim()
  const timestamp = String(request.headers.get('X-Signature-Timestamp') || '').trim()
  if (!signatureHex || !timestamp) return { valid: false, bodyText: '' }
  const timestampSeconds = Number(timestamp)
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return { valid: false, bodyText: '' }
  const bodyText = await request.clone().text()
  const [publicKeyHex] = await Promise.all([applicationPublicKey(env)])
  const publicKey = hexToBytes(publicKeyHex)
  const signature = hexToBytes(signatureHex)
  if (!publicKey || !signature) return { valid: false, bodyText }
  const key = await crypto.subtle.importKey('raw', publicKey, { name: 'Ed25519' }, false, ['verify'])
  const message = new TextEncoder().encode(timestamp + bodyText)
  const valid = await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, message)
  return { valid, bodyText }
}
function ephemeral(message) {
  return json({ type: 4, data: { content: String(message || 'That veto action could not be completed.').slice(0, 1900), flags: 64 } }, 200, { 'Cache-Control': 'no-store' })
}

async function handleStatus(request, env) {
  const cors = corsHeaders(request, env)
  try {
    await getStaff(request, env)
    const settings = config(env)
    if (!settings.botToken || !isSnowflake(settings.guildId)) {
      return json({
        configured: false,
        guildId: settings.guildId || null,
        categoryName: settings.categoryName,
        missing: [!settings.botToken ? 'DISCORD_BOT_TOKEN' : '', !isSnowflake(settings.guildId) ? 'DISCORD_TEST_GUILD_ID' : ''].filter(Boolean),
      }, 200, cors)
    }
    const [bot, guild, application] = await Promise.all([
      discordRequest(env, '/users/@me'),
      discordRequest(env, `/guilds/${settings.guildId}`),
      discordRequest(env, '/oauth2/applications/@me'),
    ])
    const expectedEndpoint = expectedInteractionEndpoint(request)
    return json({
      configured: true,
      guildId: settings.guildId,
      guildName: guild?.name || null,
      botId: bot?.id || null,
      botName: bot?.username || null,
      categoryName: settings.categoryName,
      staffRoleIds: settings.staffRoleIds,
      interactionEndpoint: application?.interactions_endpoint_url || null,
      expectedInteractionEndpoint: expectedEndpoint,
      interactionEndpointReady: String(application?.interactions_endpoint_url || '').replace(/\/$/, '') === expectedEndpoint.replace(/\/$/, ''),
    }, 200, cors)
  } catch (error) {
    return json({ error: error.message || 'Discord test status failed.' }, error.status || 500, cors)
  }
}

async function handleMatchup(request, env) {
  const cors = corsHeaders(request, env)
  try {
    const staff = await getStaff(request, env)
    const settings = assertConfigured(env)
    const body = await request.json().catch(() => ({}))
    const matchId = String(body.matchId || '')
    if (!isUuid(matchId)) throw apiError(400, 'Choose a valid IEL match.')

    const context = await loadMatchContext(env, staff.token, matchId)
    const [guildRoles, guildChannels, application] = await Promise.all([
      discordRequest(env, `/guilds/${settings.guildId}/roles`),
      discordRequest(env, `/guilds/${settings.guildId}/channels`),
      discordRequest(env, '/oauth2/applications/@me'),
    ])
    const category = await ensureCategory(env, settings.guildId, guildChannels, settings.staffRoleIds, settings.categoryName)
    const roleA = await ensureTeamRole(env, staff.token, settings.guildId, context.teamA, guildRoles)
    const roleB = await ensureTeamRole(env, staff.token, settings.guildId, context.teamB, guildRoles)
    const [assignmentA, assignmentB] = await Promise.all([
      assignTeamMembers(env, staff.token, settings.guildId, context.teamA, roleA.id),
      assignTeamMembers(env, staff.token, settings.guildId, context.teamB, roleB.id),
    ])
    const overwrites = channelOverwrites(settings.guildId, roleA.id, roleB.id, settings.staffRoleIds)
    const saved = await existingChannelMapping(env, staff.token, matchId)
    let channel = null
    let created = false

    if (saved?.channel_id) {
      try {
        channel = await discordRequest(env, `/channels/${saved.channel_id}`)
      } catch (error) {
        if (error.status !== 404) throw error
        await db(env, staff.token, `match_discord_channels?id=eq.${encodeURIComponent(saved.id)}`, { method: 'DELETE' })
      }
    }

    if (channel?.id) {
      channel = await discordRequest(env, `/channels/${channel.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ parent_id: category.id, permission_overwrites: overwrites }),
      })
      await saveChannelMapping(env, staff.token, staff.user.id, context, settings.guildId, category.id, channel.id, roleA.id, roleB.id, saved)
    } else {
      const channelName = `w${context.match.week}-${slug(context.teamA.team_name)}-vs-${slug(context.teamB.team_name)}`.slice(0, 100)
      channel = await discordRequest(env, `/guilds/${settings.guildId}/channels`, {
        method: 'POST',
        body: JSON.stringify({
          name: channelName,
          type: 0,
          parent_id: category.id,
          topic: `IEL TEST • ${context.match.match_code} • Week ${context.match.week} • ${context.teamA.team_name} vs ${context.teamB.team_name}`.slice(0, 1024),
          permission_overwrites: overwrites,
        }),
      })
      created = true
      await saveChannelMapping(env, staff.token, staff.user.id, context, settings.guildId, category.id, channel.id, roleA.id, roleB.id, null)
    }

    const messages = await recentChannelMessages(env, channel.id)
    await ensureMatchupWelcome(env, channel.id, context, roleA, roleB, messages)
    const veto = await ensureVetoMessage(env, channel.id, context, roleA, roleB, messages)

    const warnings = [...assignmentA.warnings, ...assignmentB.warnings]
    if (Number(context.match.best_of || 5) !== 5) warnings.push('The test veto currently mirrors Blacksite’s BO5 veto sequence; this match is configured with a different series length.')
    const expectedEndpoint = expectedInteractionEndpoint(request)
    if (String(application?.interactions_endpoint_url || '').replace(/\/$/, '') !== expectedEndpoint.replace(/\/$/, '')) {
      warnings.push(`Set this Discord application's Interactions Endpoint URL to ${expectedEndpoint} before testing the veto dropdown.`)
    }

    return json({
      ok: true,
      created,
      channelId: channel.id,
      channelUrl: discordUrl(settings.guildId, channel.id),
      categoryId: category.id,
      roleA: { id: roleA.id, name: roleA.name, assigned: assignmentA.assigned },
      roleB: { id: roleB.id, name: roleB.name, assigned: assignmentB.assigned },
      vetoMessageId: veto.messageId,
      vetoCreated: veto.created,
      interactionEndpointReady: !warnings.some((warning) => warning.includes('Interactions Endpoint URL')),
      expectedInteractionEndpoint: expectedEndpoint,
      warnings,
    }, 200, cors)
  } catch (error) {
    return json({ error: error.message || 'IEL could not create the Discord test matchup.' }, error.status || 500, cors)
  }
}

export async function handleDiscordTestRequest(request, env) {
  const cors = corsHeaders(request, env)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname === '/api/staff/discord/test/status') return handleStatus(request, env)
  if (request.method === 'POST' && url.pathname === '/api/staff/discord/test/matchup') return handleMatchup(request, env)
  return json({ error: 'IEL Discord test route not found.' }, 404, cors)
}

export async function handleDiscordInteractionRequest(request, env) {
  if (request.method === 'GET') {
    return json({
      ok: true,
      endpoint: '/discord/interactions',
      method: 'POST',
      message: 'Discord sends signed component interactions to this endpoint.',
    }, 200, { 'Cache-Control': 'no-store' })
  }
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let verification
  try {
    verification = await verifyInteractionRequest(request, env)
  } catch (error) {
    console.error('[IEL VETO] interaction verification error', error)
    return new Response('Invalid request signature', { status: 401 })
  }
  if (!verification.valid) return new Response('Invalid request signature', { status: 401 })

  let interaction
  try { interaction = JSON.parse(verification.bodyText) } catch { return new Response('Invalid interaction payload', { status: 400 }) }
  if (interaction.type === 1) return json({ type: 1 }, 200, { 'Cache-Control': 'no-store' })
  if (interaction.type !== 3) return ephemeral('This IEL interaction is no longer active.')

  const parsed = parseVetoCustomId(interaction?.data?.custom_id)
  if (!parsed) return ephemeral('This IEL veto menu is no longer active.')
  const settings = assertConfigured(env)
  if (String(interaction.guild_id || '') !== String(settings.guildId)) return ephemeral('This veto belongs to the IEL test server.')

  try {
    const currentMessage = await discordRequest(env, `/channels/${interaction.channel_id}/messages/${interaction.message.id}`)
    if (currentVetoCustomId(currentMessage) !== String(interaction.data.custom_id || '')) {
      return ephemeral('That veto menu is stale. Use the newest dropdown in the channel.')
    }

    const context = messageVetoContext(currentMessage, parsed.matchId)
    if (!context) return ephemeral('IEL could not read the matchup teams from this veto panel.')
    const actions = decodeVetoActions(parsed.codes)
    const step = VETO_STEPS[parsed.stepIndex]
    if (!actions || !step) return ephemeral('This veto step is no longer active.')

    const guildRoles = await discordRequest(env, `/guilds/${settings.guildId}/roles`)
    const roleA = findExactTeamRole(guildRoles, context.teamAName)
    const roleB = findExactTeamRole(guildRoles, context.teamBName)
    if (!roleA || !roleB) return ephemeral('One of the registered team roles no longer exists. Staff must repair the matchup channel.')

    const memberRoles = new Set((interaction.member?.roles || []).map(String))
    const hasA = memberRoles.has(String(roleA.id))
    const hasB = memberRoles.has(String(roleB.id))
    const staffOverride = settings.staffRoleIds.some((roleId) => memberRoles.has(String(roleId)))
    if (!staffOverride && hasA && hasB) return ephemeral('Your account has both matchup team roles. IEL Staff must correct the roles before you submit a veto action.')
    const requiredRole = step.team === 'A' ? roleA : roleB
    const teamName = step.team === 'A' ? context.teamAName : context.teamBName
    if (!staffOverride && !memberRoles.has(String(requiredRole.id))) return ephemeral(`It is ${teamName}'s turn. Only that team's Discord role can submit this step.`)

    const selectedMap = String(interaction.data?.values?.[0] || '').trim()
    const options = availableMaps(actions, step.mode)
    if (!options.includes(selectedMap)) return ephemeral('That map is no longer available. Use the current veto menu.')
    const poolIndex = VETO_POOLS[step.mode].indexOf(selectedMap)
    if (poolIndex < 0) return ephemeral('That map was not recognized in the active IEL map pool.')

    const nextCodes = `${parsed.codes}${poolIndex.toString(36)}`
    const nextPayload = vetoPayload(context, roleA, roleB, nextCodes)
    return json({ type: 7, data: nextPayload }, 200, { 'Cache-Control': 'no-store' })
  } catch (error) {
    console.error('[IEL VETO] interaction failed', error)
    return ephemeral(`IEL could not process that veto action: ${String(error.message || error).slice(0, 1500)}`)
  }
}
