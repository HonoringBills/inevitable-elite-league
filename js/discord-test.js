import { state, supabase, toast } from './core.js'

let initialized = false
let observer = null
const busy = new Set()
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

function matchButton(card) {
  return card.querySelector('[data-staff-action="report-match"][data-id], [data-staff-action="reopen-match"][data-id]')
}

function decorateSchedule() {
  document.querySelectorAll('.match-card').forEach((card) => {
    const source = matchButton(card)
    const actions = source?.closest('.admin-actions')
    const matchId = String(source?.dataset.id || '')
    if (!actions || !matchId || actions.querySelector(`[data-discord-test-match="${CSS.escape(matchId)}"]`)) return

    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'button button-teal compact'
    button.dataset.discordTestMatch = matchId
    button.textContent = channelUrls.has(matchId) ? 'Open Test Matchup' : 'Create Test Matchup'
    actions.appendChild(button)
  })
}

async function createOrOpenMatchup(button) {
  const matchId = String(button.dataset.discordTestMatch || '')
  if (!matchId || busy.has(matchId)) return
  const existingUrl = channelUrls.get(matchId)
  if (existingUrl) {
    window.open(existingUrl, '_blank', 'noopener,noreferrer')
    return
  }

  busy.add(matchId)
  button.disabled = true
  button.textContent = 'Creating Discord...'
  try {
    const result = await apiRequest('/api/staff/discord/test/matchup', {
      method: 'POST',
      body: JSON.stringify({ matchId }),
    })
    if (result.channelUrl) channelUrls.set(matchId, result.channelUrl)
    button.textContent = 'Open Test Matchup'
    button.disabled = false

    const warnings = Array.isArray(result.warnings) ? result.warnings : []
    const verb = result.created ? 'created' : 'already exists'
    toast(`Discord test matchup ${verb}.${warnings.length ? ` ${warnings.length} role-assignment warning${warnings.length === 1 ? '' : 's'}.` : ''}`, warnings.length ? 'error' : 'success')
    if (warnings.length) console.warn('[IEL Discord Test]', warnings)
  } catch (error) {
    button.disabled = false
    button.textContent = 'Create Test Matchup'
    toast(error.message || 'IEL could not create the Discord test matchup.', 'error')
  } finally {
    busy.delete(matchId)
  }
}

function handleClick(event) {
  const button = event.target.closest('[data-discord-test-match]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  createOrOpenMatchup(button).catch((error) => toast(error.message, 'error'))
}

export function initDiscordTestMatchups() {
  if (!initialized) {
    initialized = true
    document.addEventListener('click', handleClick)
    const app = document.getElementById('app')
    if (app) {
      observer = new MutationObserver(() => queueMicrotask(decorateSchedule))
      observer.observe(app, { childList: true, subtree: true })
    }
  }
  decorateSchedule()
}
