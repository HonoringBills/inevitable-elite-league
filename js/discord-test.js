import { esc, state, statusBadge, supabase, toast } from './core.js'

let initialized = false
let observer = null
let observedWorkspace = null
let decorateQueued = false
let discordBusy = false
let scheduleOperation = 0
let hydratedMappings = false
const channelUrls = new Map()
const restoreWatchIds = new Set()
const completionWatchIds = new Set()

function apiBase() {
  const configured = String(state.site?.ocr_api_url || '').trim().replace(/\/$/, '')
  const host = window.location.hostname.toLowerCase()
  if (!host.endsWith('github.io') && !host.endsWith('chatgpt.site')) return window.location.origin
  return configured
}

async function apiRequest(path, options = {}) {
  const base = apiBase()
  if (!base) throw new Error('IEL Cloudflare backend URL is not configured.')
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  const token = data?.session?.access_token
  if (!token) throw new Error('Your Staff login expired. Sign in again.')

  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `IEL Discord request failed (${response.status}).`)
  return payload
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function isArchived(match) {
  return ['complete', 'cancelled'].includes(String(match?.status || '').toLowerCase())
}

function activeMatchesFor(week, division) {
  return state.matches.filter((match) => {
    if (isArchived(match)) return false
    if (week != null && Number(match.week) !== Number(week)) return false
    if (division && String(match.division || '') !== String(division)) return false
    return true
  })
}

function matchIdFromCard(card) {
  const control = card?.querySelector('[data-staff-action][data-id]')
  return String(control?.dataset.id || '')
}

function setButtonState(button, { disabled, text }) {
  if (!button) return
  if (button.disabled !== Boolean(disabled)) button.disabled = Boolean(disabled)
  if (button.textContent !== text) button.textContent = text
}

function generatorButton() {
  return document.querySelector('#schedule-generator button[type="submit"]')
}

function decorateGenerator() {
  document.querySelector('[data-discord-bulk-panel]')?.remove()
  const generator = document.getElementById('schedule-generator')
  if (!generator) return

  const title = generator.querySelector('h3')
  const copy = generator.querySelector('p')
  const status = generator.querySelector('.form-status')
  const button = generatorButton()

  const titleText = 'Generate Weekly Matchups'
  const copyText = 'Creates the IEL schedule, then automatically builds each private Discord match channel, live veto panel, and weekly team voice access.'
  const statusText = 'One click handles IEL + Discord. Requires 3+ approved teams.'

  if (title && title.textContent !== titleText) title.textContent = titleText
  if (copy && copy.textContent !== copyText) copy.textContent = copyText
  if (status && status.textContent !== statusText) status.textContent = statusText
  if (button && !discordBusy && !button.disabled && button.textContent !== 'Generate Matchups') button.textContent = 'Generate Matchups'
}

function archiveCard(match) {
  const score = String(match.status).toLowerCase() === 'complete'
    ? `${match.team_a_score ?? 0} — ${match.team_b_score ?? 0}`
    : 'Cancelled'
  return `
    <article class="match-card" style="margin-bottom:12px">
      <div class="match-meta">${esc(match.match_code || '')}<br>Week ${Number(match.week) || '—'} · R${Number(match.round_number) || '—'}</div>
      <div class="match-team"><span>${esc(match.team_a_name || 'Team A')}</span></div>
      <div class="match-score">${esc(score)}</div>
      <div class="match-team right"><span>${esc(match.team_b_name || 'Team B')}</span></div>
      <div class="admin-actions">
        ${statusBadge(match.status || 'complete')}
        <button class="button button-ghost compact" type="button" data-staff-action="reopen-match" data-id="${esc(match.id)}">Restore Match</button>
      </div>
    </article>`
}

function decorateArchive() {
  const matchList = document.querySelector('.match-list')
  if (!matchList) return

  const archived = state.matches.filter(isArchived)
  const activeIds = new Set(state.matches.filter((match) => !isArchived(match)).map((match) => String(match.id)))

  for (const card of [...matchList.querySelectorAll('.match-card')]) {
    const matchId = matchIdFromCard(card)
    if (matchId && !activeIds.has(matchId)) card.remove()
  }

  let activeHeading = document.querySelector('[data-active-match-heading]')
  if (!activeHeading) {
    activeHeading = document.createElement('div')
    activeHeading.dataset.activeMatchHeading = 'true'
    activeHeading.className = 'admin-toolbar'
    activeHeading.style.margin = '4px 0 14px'
    matchList.insertAdjacentElement('beforebegin', activeHeading)
  }
  const activeCount = state.matches.filter((match) => !isArchived(match)).length
  const headingHtml = `<div><p class="section-label">Current Queue</p><h3 style="margin:0">Active Matches</h3></div><span class="badge teal">${activeCount} active</span>`
  if (activeHeading.innerHTML !== headingHtml) activeHeading.innerHTML = headingHtml

  if (!matchList.querySelector('.match-card') && !matchList.querySelector('[data-active-empty]')) {
    const empty = document.createElement('div')
    empty.className = 'empty-state'
    empty.dataset.activeEmpty = 'true'
    empty.innerHTML = '<strong>No active matches</strong>Completed and cancelled matches are kept in the archive below.'
    matchList.appendChild(empty)
  }
  if (matchList.querySelector('.match-card')) matchList.querySelector('[data-active-empty]')?.remove()

  let archive = document.querySelector('[data-match-archive]')
  if (!archived.length) {
    archive?.remove()
    return
  }

  if (!archive) {
    archive = document.createElement('details')
    archive.dataset.matchArchive = 'true'
    archive.className = 'card'
    archive.style.marginTop = '28px'
    matchList.insertAdjacentElement('afterend', archive)
  }

  const wasOpen = archive.open
  const ordered = [...archived].sort((a, b) => {
    const weekDiff = Number(b.week || 0) - Number(a.week || 0)
    if (weekDiff) return weekDiff
    return Number(b.round_number || 0) - Number(a.round_number || 0)
  })
  const signature = ordered.map((match) => `${match.id}:${match.status}:${match.team_a_score}:${match.team_b_score}`).join('|')
  if (archive.dataset.archiveSignature !== signature) {
    archive.dataset.archiveSignature = signature
    archive.innerHTML = `
      <summary style="cursor:pointer;font-weight:800;text-transform:uppercase;letter-spacing:.08em">Match Archive (${ordered.length})</summary>
      <p style="margin:14px 0 18px">Completed and cancelled matches stay here for staff review. Restoring a match moves it back to Active and rebuilds its Discord matchup room.</p>
      <div data-archive-list>${ordered.map(archiveCard).join('')}</div>`
    archive.open = wasOpen
  }
}

function decorateOpenButtons() {
  document.querySelectorAll('.match-list .match-card').forEach((card) => {
    const source = card.querySelector('[data-staff-action="report-match"][data-id]')
    const actions = source?.closest('.admin-actions')
    const matchId = String(source?.dataset.id || '')
    const existing = card.querySelector('[data-discord-test-match]')

    if (!actions || !matchId) {
      existing?.remove()
      return
    }

    const channelUrl = channelUrls.get(matchId)
    if (!channelUrl) {
      existing?.remove()
      return
    }

    if (existing) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'button button-teal compact'
    button.dataset.discordTestMatch = matchId
    button.textContent = 'Open Matchup'
    actions.appendChild(button)
  })
}

function decorateSchedule() {
  decorateGenerator()
  decorateArchive()
  decorateOpenButtons()
}

function queueDecorateSchedule() {
  if (decorateQueued) return
  decorateQueued = true
  queueMicrotask(() => {
    decorateQueued = false
    decorateSchedule()
  })
}

function attachWorkspaceObserver() {
  const workspace = document.getElementById('staff-workspace')
  if (!workspace || workspace === observedWorkspace) return
  observer?.disconnect()
  observedWorkspace = workspace
  observer = new MutationObserver(() => queueDecorateSchedule())
  observer.observe(workspace, { childList: true, subtree: false })
}

async function hydrateChannelUrls() {
  if (hydratedMappings) return
  hydratedMappings = true
  const { data, error } = await supabase
    .from('match_discord_channels')
    .select('match_id,guild_id,channel_id')
    .eq('environment', 'test')
  if (error) {
    console.warn('[IEL Discord] channel mapping hydration failed', error)
    return
  }
  for (const row of data || []) {
    if (row.match_id && row.guild_id && row.channel_id) {
      channelUrls.set(String(row.match_id), `https://discord.com/channels/${row.guild_id}/${row.channel_id}`)
    }
  }
  decorateSchedule()
}

async function openMatchup(button) {
  const matchId = String(button.dataset.discordTestMatch || '')
  const url = channelUrls.get(matchId)
  if (!url) {
    toast('IEL does not have a saved Discord matchup channel for this match yet.', 'error')
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function syncDiscordMatches(matchIds, context = {}) {
  const ids = [...new Set((matchIds || []).map(String).filter(Boolean))]
  if (!ids.length || discordBusy) return

  discordBusy = true
  const results = []
  const failures = []
  const warnings = []
  let voiceChannels = []
  let voiceError = ''

  try {
    for (let index = 0; index < ids.length; index += 1) {
      const button = generatorButton()
      setButtonState(button, { disabled: true, text: `Building Discord ${index + 1}/${ids.length}...` })
      const matchId = ids[index]
      try {
        const result = await apiRequest('/api/staff/discord/test/matchup', {
          method: 'POST',
          body: JSON.stringify({ matchId }),
        })
        results.push({ ...result, matchId })
        if (result.channelUrl) channelUrls.set(matchId, result.channelUrl)
        if (Array.isArray(result.warnings)) warnings.push(...result.warnings)
        decorateSchedule()
      } catch (error) {
        failures.push({ matchId, error: String(error.message || error) })
      }
    }

    const voiceIds = activeMatchesFor(context.week, context.division).map((match) => String(match.id))
    if (voiceIds.length) {
      setButtonState(generatorButton(), { disabled: true, text: 'Syncing Weekly Team VCs...' })
      try {
        const voiceResult = await apiRequest('/api/staff/discord/test/voice-sync', {
          method: 'POST',
          body: JSON.stringify({ matchIds: voiceIds }),
        })
        voiceChannels = Array.isArray(voiceResult.voiceChannels) ? voiceResult.voiceChannels : []
        if (Array.isArray(voiceResult.warnings)) warnings.push(...voiceResult.warnings)
      } catch (error) {
        voiceError = String(error.message || error)
      }
    }

    const firstFailure = failures[0]?.error ? ` ${failures[0].error.slice(0, 150)}` : ''
    if (failures.length) {
      toast(`${results.length}/${ids.length} Discord matchup rooms synced. ${failures.length} failed.${firstFailure}`, 'error')
    } else if (voiceError) {
      toast(`${results.length} matchup rooms synced, but weekly VC sync failed: ${voiceError.slice(0, 170)}`, 'error')
    } else {
      const weekLabel = context.week ? `Week ${context.week}` : 'Match'
      toast(`${weekLabel} is ready: ${results.length} matchup rooms and ${voiceChannels.length} weekly team VCs synced.`, 'success')
    }

    if (warnings.length) console.warn('[IEL Discord] warnings', warnings)
    if (failures.length) console.warn('[IEL Discord] failures', failures)
  } finally {
    discordBusy = false
    const button = generatorButton()
    if (button) setButtonState(button, { disabled: false, text: 'Generate Matchups' })
    decorateSchedule()
  }
}

async function watchScheduleGeneration(operationId, context) {
  const deadline = Date.now() + 20000
  while (operationId === scheduleOperation && Date.now() < deadline) {
    const matching = activeMatchesFor(context.week, context.division)
    const newIds = matching.filter((match) => !context.beforeIds.has(String(match.id))).map((match) => String(match.id))
    if (newIds.length) {
      await wait(250)
      await syncDiscordMatches(matching.map((match) => String(match.id)), context)
      return
    }

    const button = generatorButton()
    if (Date.now() - context.startedAt > 800 && button && !button.disabled) {
      // If IEL blocked duplicate generation because this week already exists,
      // the same button becomes a safe Discord repair/sync action.
      if (matching.length) await syncDiscordMatches(matching.map((match) => String(match.id)), context)
      return
    }
    await wait(250)
  }
}

function handleScheduleSubmitCapture(event) {
  const form = event.target
  if (!(form instanceof HTMLFormElement) || form.id !== 'schedule-generator') return
  const fd = new FormData(form)
  const week = Number.parseInt(fd.get('week'), 10)
  const division = String(fd.get('division') || '')
  const beforeIds = new Set(state.matches.map((match) => String(match.id)))
  const operationId = ++scheduleOperation
  const context = { week, division, beforeIds, startedAt: Date.now() }
  const button = form.querySelector('button[type="submit"]')
  if (button && button.textContent !== 'Generating IEL Matchups...') button.textContent = 'Generating IEL Matchups...'
  window.setTimeout(() => {
    watchScheduleGeneration(operationId, context).catch((error) => {
      console.error('[IEL Discord] unified generation failed', error)
      toast(error.message || 'IEL generated the schedule but Discord sync failed.', 'error')
    })
  }, 0)
}

async function watchRestore(matchId) {
  if (restoreWatchIds.has(matchId)) return
  restoreWatchIds.add(matchId)
  try {
    const deadline = Date.now() + 20000
    while (Date.now() < deadline) {
      const match = state.matches.find((item) => String(item.id) === matchId)
      if (match && !isArchived(match)) {
        await syncDiscordMatches([matchId], { week: match.week, division: match.division })
        return
      }
      await wait(300)
    }
  } finally {
    restoreWatchIds.delete(matchId)
  }
}

async function watchCompletion(matchId) {
  if (completionWatchIds.has(matchId)) return
  completionWatchIds.add(matchId)
  try {
    const deadline = Date.now() + 15 * 60 * 1000
    while (Date.now() < deadline) {
      const match = state.matches.find((item) => String(item.id) === matchId)
      if (match && String(match.status || '').toLowerCase() === 'complete') {
        channelUrls.delete(matchId)
        decorateSchedule()
        return
      }
      await wait(1000)
    }
  } finally {
    completionWatchIds.delete(matchId)
  }
}

function handleLifecycleClickCapture(event) {
  const restore = event.target.closest('[data-staff-action="reopen-match"][data-id]')
  if (restore) {
    const matchId = String(restore.dataset.id || '')
    window.setTimeout(() => watchRestore(matchId).catch((error) => console.warn('[IEL Discord] restore sync failed', error)), 0)
    return
  }

  const report = event.target.closest('[data-staff-action="report-match"][data-id]')
  if (report) {
    const matchId = String(report.dataset.id || '')
    window.setTimeout(() => watchCompletion(matchId).catch((error) => console.warn('[IEL Discord] completion watch failed', error)), 0)
  }
}

function handleClick(event) {
  const button = event.target.closest('[data-discord-test-match]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  openMatchup(button).catch((error) => toast(error.message, 'error'))
}

export function initDiscordTestMatchups() {
  if (!initialized) {
    initialized = true
    document.addEventListener('submit', handleScheduleSubmitCapture, true)
    document.addEventListener('click', handleLifecycleClickCapture, true)
    document.addEventListener('click', handleClick)
    hydrateChannelUrls().catch((error) => console.warn('[IEL Discord] mapping load failed', error))
  }
  attachWorkspaceObserver()
  decorateSchedule()
}
