import { state, supabase, toast } from './core.js'

let initialized = false
let observer = null
let observedWorkspace = null
let decorateQueued = false
let bulkBusy = false
const channelUrls = new Map()

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

function activeMatchButton(card) {
  return card.querySelector('[data-staff-action="report-match"][data-id]')
}

function activeMatchIds() {
  return [...document.querySelectorAll('.match-card [data-staff-action="report-match"][data-id]')]
    .map((button) => String(button.dataset.id || ''))
    .filter(Boolean)
}

function setButtonState(button, { disabled, text }) {
  if (!button) return
  if (button.disabled !== Boolean(disabled)) button.disabled = Boolean(disabled)
  if (button.textContent !== text) button.textContent = text
}

function decorateBulkControl() {
  const generator = document.getElementById('schedule-generator')
  const matchList = document.querySelector('.match-list')
  if (!generator || !matchList) return

  let panel = document.querySelector('[data-discord-bulk-panel]')
  if (!panel) {
    panel = document.createElement('div')
    panel.className = 'card teal'
    panel.dataset.discordBulkPanel = 'true'
    panel.style.marginBottom = '24px'
    panel.innerHTML = `
      <div class="admin-toolbar" style="margin:0;gap:18px;align-items:center">
        <div>
          <span class="card-kicker">Discord Match Operations</span>
          <h3 style="margin:4px 0 8px">Generate All Match Channels</h3>
          <p style="margin:0">Builds every active matchup room, live veto panel, and weekly team voice channel in one pass.</p>
        </div>
        <button class="button button-teal" type="button" data-discord-generate-all>Generate All Discord Matchups</button>
      </div>`
    generator.insertAdjacentElement('afterend', panel)
  }

  const button = panel.querySelector('[data-discord-generate-all]')
  const matchCount = activeMatchIds().length
  if (button && !bulkBusy) {
    setButtonState(button, {
      disabled: matchCount === 0,
      text: matchCount ? `Generate All Discord Matchups (${matchCount})` : 'No Active Matches',
    })
  }
}

function decorateSchedule() {
  document.querySelectorAll('.match-card').forEach((card) => {
    const source = activeMatchButton(card)
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

    if (existing) {
      if (existing.textContent !== 'Open Matchup') existing.textContent = 'Open Matchup'
      return
    }

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'button button-teal compact'
    button.dataset.discordTestMatch = matchId
    button.textContent = 'Open Matchup'
    actions.appendChild(button)
  })
  decorateBulkControl()
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
  // Staff swaps the workspace by replacing its direct children. Watching only
  // that boundary keeps Discord decorators from reacting to their own nested UI.
  observer.observe(workspace, { childList: true, subtree: false })
}

async function openMatchup(button) {
  const matchId = String(button.dataset.discordTestMatch || '')
  const url = channelUrls.get(matchId)
  if (!url) {
    toast('Use Generate All Discord Matchups to build the active match rooms first.', 'error')
    return
  }
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function generateAll(button) {
  if (bulkBusy) return
  const matchIds = activeMatchIds()
  if (!matchIds.length) {
    toast('There are no active matches waiting for Discord channels.', 'error')
    return
  }

  bulkBusy = true
  setButtonState(button, { disabled: true, text: `Generating ${matchIds.length} Matchups...` })
  try {
    const result = await apiRequest('/api/staff/discord/test/all', {
      method: 'POST',
      body: JSON.stringify({ matchIds }),
    })

    for (const item of result.results || []) {
      if (item.matchId && item.channelUrl) channelUrls.set(String(item.matchId), item.channelUrl)
    }
    decorateSchedule()

    const failures = Array.isArray(result.failures) ? result.failures : []
    const warnings = Array.isArray(result.warnings) ? result.warnings : []
    const voiceCount = Array.isArray(result.voiceChannels) ? result.voiceChannels.length : 0
    const message = failures.length
      ? `${result.synced || 0}/${result.processed || matchIds.length} matchups synced. ${failures.length} failed.`
      : `${result.synced || matchIds.length} matchup channels synced and ${voiceCount} weekly team VCs are ready.`
    toast(message, failures.length ? 'error' : 'success')
    if (warnings.length) console.warn('[IEL Discord Matchups] warnings', warnings)
    if (failures.length) console.warn('[IEL Discord Matchups] failures', failures)
  } catch (error) {
    toast(error.message || 'IEL could not generate all Discord matchups.', 'error')
  } finally {
    bulkBusy = false
    decorateSchedule()
  }
}

function handleClick(event) {
  const bulkButton = event.target.closest('[data-discord-generate-all]')
  if (bulkButton) {
    event.preventDefault()
    event.stopPropagation()
    generateAll(bulkButton).catch((error) => toast(error.message, 'error'))
    return
  }

  const button = event.target.closest('[data-discord-test-match]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  openMatchup(button).catch((error) => toast(error.message, 'error'))
}

export function initDiscordTestMatchups() {
  if (!initialized) {
    initialized = true
    document.addEventListener('click', handleClick)
  }
  attachWorkspaceObserver()
  decorateSchedule()
}
