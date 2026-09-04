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

function config(env) {
  const guildId = String(env.DISCORD_TEST_GUILD_ID || '').trim()
  const botToken = String(env.DISCORD_BOT_TOKEN || '').trim()
  const categoryName = String(env.DISCORD_TEST_CATEGORY_NAME || 'Match Ups').trim() || 'Match Ups'
  const staffRoleIds = String(env.DISCORD_TEST_STAFF_ROLE_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(isSnowflake)
  return { guildId, botToken, categoryName, staffRoleIds }
}

function assertConfigured(env) {
  const settings = config(env)
  if (!settings.botToken) throw apiError(503, 'Discord test bot token is not configured in Cloudflare yet.')
  if (!isSnowflake(settings.guildId)) throw apiError(503, 'DISCORD_TEST_GUILD_ID is not configured with the test server ID yet.')
  return settings
}

async function discordRequest(env, path, options = {}) {
  const { botToken } = assertConfigured(env)
  const response = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
      'User-Agent': 'IEL-Test-Matchups/1.0',
      ...(options.headers || {}),
    },
  })

  if (response.status === 204) return null
  const text = await response.text()
  let payload = null
  try { payload = text ? JSON.parse(text) : null } catch { payload = text }
  if (!response.ok) {
    const detail = payload?.message || (typeof payload === 'string' ? payload : '') || `Discord API ${response.status}`
    throw apiError(response.status === 401 ? 502 : response.status, `Discord: ${detail}`)
  }
  return payload
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

function roleName(teamName) {
  return `IEL | ${String(teamName || 'Team').trim()}`.slice(0, 100)
}

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 34) || 'team'
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
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    return
  }
  await db(env, token, 'discord_team_roles', {
    method: 'POST',
    body: JSON.stringify(patch),
  })
}

async function ensureTeamRole(env, token, guildId, team, guildRoles) {
  const saved = (await db(env, token,
    `discord_team_roles?select=role_id&team_id=eq.${encodeURIComponent(team.id)}&environment=eq.${ENVIRONMENT}&limit=1`))?.[0]
  let role = saved?.role_id ? guildRoles.find((item) => String(item.id) === String(saved.role_id)) : null
  if (!role) role = guildRoles.find((item) => String(item.name) === roleName(team.team_name)) || null
  if (!role) {
    role = await discordRequest(env, `/guilds/${guildId}/roles`, {
      method: 'POST',
      body: JSON.stringify({
        name: roleName(team.team_name),
        hoist: false,
        mentionable: true,
        permissions: '0',
      }),
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
    warnings.push(`${team.team_name} has no Discord user IDs saved yet, so its role was created but no members were auto-assigned.`)
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
  let category = guildChannels.find((channel) => Number(channel.type) === 4 && String(channel.name).toLowerCase() === categoryName.toLowerCase()) || null
  if (category) return category

  const overwrites = [
    { id: guildId, type: 0, allow: '0', deny: String(VIEW_CHANNEL) },
    ...staffRoleIds.map((id) => ({ id, type: 0, allow: STAFF_ALLOW, deny: '0' })),
  ]
  category = await discordRequest(env, `/guilds/${guildId}/channels`, {
    method: 'POST',
    body: JSON.stringify({
      name: categoryName,
      type: 4,
      permission_overwrites: overwrites,
    }),
  })
  guildChannels.push(category)
  return category
}

async function existingChannelMapping(env, token, matchId) {
  return (await db(env, token,
    `match_discord_channels?select=id,guild_id,category_id,channel_id,team_a_role_id,team_b_role_id&match_id=eq.${encodeURIComponent(matchId)}&environment=eq.${ENVIRONMENT}&limit=1`))?.[0] || null
}

async function saveChannelMapping(env, token, staffUserId, context, guildId, categoryId, channelId, roleAId, roleBId) {
  await db(env, token, 'match_discord_channels', {
    method: 'POST',
    body: JSON.stringify({
      match_id: context.match.id,
      environment: ENVIRONMENT,
      guild_id: guildId,
      category_id: categoryId,
      channel_id: channelId,
      team_a_role_id: roleAId,
      team_b_role_id: roleBId,
      created_by: staffUserId,
    }),
  })
}

function discordUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`
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
        missing: [
          !settings.botToken ? 'DISCORD_BOT_TOKEN' : '',
          !isSnowflake(settings.guildId) ? 'DISCORD_TEST_GUILD_ID' : '',
        ].filter(Boolean),
      }, 200, cors)
    }
    const [bot, guild] = await Promise.all([
      discordRequest(env, '/users/@me'),
      discordRequest(env, `/guilds/${settings.guildId}`),
    ])
    return json({
      configured: true,
      guildId: settings.guildId,
      guildName: guild?.name || null,
      botId: bot?.id || null,
      botName: bot?.username || null,
      categoryName: settings.categoryName,
      staffRoleIds: settings.staffRoleIds,
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
    if (!/^[0-9a-f-]{36}$/i.test(matchId)) throw apiError(400, 'Choose a valid IEL match.')

    const context = await loadMatchContext(env, staff.token, matchId)
    const saved = await existingChannelMapping(env, staff.token, matchId)
    if (saved?.channel_id) {
      try {
        const existing = await discordRequest(env, `/channels/${saved.channel_id}`)
        if (existing?.id) {
          return json({
            ok: true,
            created: false,
            channelId: saved.channel_id,
            channelUrl: discordUrl(settings.guildId, saved.channel_id),
            message: 'This test matchup channel already exists.',
            warnings: [],
          }, 200, cors)
        }
      } catch (error) {
        if (error.status !== 404) throw error
        await db(env, staff.token, `match_discord_channels?id=eq.${encodeURIComponent(saved.id)}`, { method: 'DELETE' })
      }
    }

    const [guildRoles, guildChannels] = await Promise.all([
      discordRequest(env, `/guilds/${settings.guildId}/roles`),
      discordRequest(env, `/guilds/${settings.guildId}/channels`),
    ])
    const category = await ensureCategory(env, settings.guildId, guildChannels, settings.staffRoleIds, settings.categoryName)
    const roleA = await ensureTeamRole(env, staff.token, settings.guildId, context.teamA, guildRoles)
    const roleB = await ensureTeamRole(env, staff.token, settings.guildId, context.teamB, guildRoles)

    const [assignmentA, assignmentB] = await Promise.all([
      assignTeamMembers(env, staff.token, settings.guildId, context.teamA, roleA.id),
      assignTeamMembers(env, staff.token, settings.guildId, context.teamB, roleB.id),
    ])

    const overwrites = [
      { id: settings.guildId, type: 0, allow: '0', deny: String(VIEW_CHANNEL) },
      { id: roleA.id, type: 0, allow: MEMBER_ALLOW, deny: '0' },
      { id: roleB.id, type: 0, allow: MEMBER_ALLOW, deny: '0' },
      ...settings.staffRoleIds.map((id) => ({ id, type: 0, allow: STAFF_ALLOW, deny: '0' })),
    ]

    const channelName = `w${context.match.week}-${slug(context.teamA.team_name)}-vs-${slug(context.teamB.team_name)}`.slice(0, 100)
    const channel = await discordRequest(env, `/guilds/${settings.guildId}/channels`, {
      method: 'POST',
      body: JSON.stringify({
        name: channelName,
        type: 0,
        parent_id: category.id,
        topic: `IEL TEST • ${context.match.match_code} • Week ${context.match.week} • ${context.teamA.team_name} vs ${context.teamB.team_name}`.slice(0, 1024),
        permission_overwrites: overwrites,
      }),
    })

    await saveChannelMapping(env, staff.token, staff.user.id, context, settings.guildId, category.id, channel.id, roleA.id, roleB.id)

    const scheduled = context.match.scheduled_at ? `\nScheduled: <t:${Math.floor(new Date(context.match.scheduled_at).getTime() / 1000)}:F>` : ''
    await discordRequest(env, `/channels/${channel.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: `## IEL TEST MATCHUP\n<@&${roleA.id}> **${context.teamA.team_name}** vs <@&${roleB.id}> **${context.teamB.team_name}**\nMatch: **${context.match.match_code}** • Week ${context.match.week} • Best of ${context.match.best_of || 5}${scheduled}\n\nUse this private channel for matchup scheduling and league communication. This channel was generated by the IEL test integration.`,
        allowed_mentions: { roles: [roleA.id, roleB.id] },
      }),
    })

    const warnings = [...assignmentA.warnings, ...assignmentB.warnings]
    return json({
      ok: true,
      created: true,
      channelId: channel.id,
      channelUrl: discordUrl(settings.guildId, channel.id),
      categoryId: category.id,
      roleA: { id: roleA.id, name: roleA.name, assigned: assignmentA.assigned },
      roleB: { id: roleB.id, name: roleB.name, assigned: assignmentB.assigned },
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
