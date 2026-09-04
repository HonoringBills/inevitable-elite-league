import { state, supabase, toast } from './core.js'

let initialized = false
let observer = null
let busy = false

function overlay() {
  return document.getElementById('iel-match-report-overlay')
}

function matchCodeFromOverlay(root) {
  const lines = [...root.querySelectorAll('.iel-report-header > div > p')]
  const detail = String(lines.at(-1)?.textContent || '')
  return detail.split('·')[0].trim()
}

function currentReporterMatch(root) {
  const code = matchCodeFromOverlay(root)
  if (code) {
    const match = state.matches.find((row) => String(row.match_code || '') === code)
    if (match) return match
  }

  const teamIds = [...root.querySelectorAll('[data-ocr-action="winner"][data-team]')]
    .map((button) => String(button.dataset.team || ''))
    .filter(Boolean)
  if (teamIds.length === 2) {
    return state.matches.find((row) => {
      const ids = [String(row.team_a_id), String(row.team_b_id)]
      return teamIds.every((id) => ids.includes(id))
    }) || null
  }
  return null
}

function declaredWinnerId(root) {
  const selected = [...root.querySelectorAll('[data-ocr-action="winner"][data-team]')]
    .find((button) => button.classList.contains('button-gold'))
  return String(selected?.dataset.team || '')
}

function teamName(match, teamId) {
  if (String(match.team_a_id) === String(teamId)) return match.team_a_name || 'Team A'
  if (String(match.team_b_id) === String(teamId)) return match.team_b_name || 'Team B'
  return 'Unknown team'
}

function reviewStep(root) {
  return [...root.querySelectorAll('.iel-report-step')]
    .find((element) => String(element.querySelector('h3')?.textContent || '').includes('Staff Review + Apply')) || null
}

function decorate() {
  const root = overlay()
  if (!root) return
  const step = reviewStep(root)
  const host = step?.querySelector('div:last-child') || step
  if (!host) return

  let wrap = root.querySelector('[data-verify-without-stats-wrap]')
  if (!wrap) {
    wrap = document.createElement('div')
    wrap.dataset.verifyWithoutStatsWrap = 'true'
    wrap.style.marginTop = '14px'
    wrap.style.display = 'flex'
    wrap.style.alignItems = 'center'
    wrap.style.gap = '10px'
    wrap.style.flexWrap = 'wrap'
    wrap.innerHTML = `
      <button class="button button-ghost" type="button" data-verify-without-stats>Verify Without Stats</button>
      <small style="color:var(--muted)">For forfeits or matches without usable scoreboards. No new player stat rows are created.</small>`
    host.appendChild(wrap)
  }

  const button = wrap.querySelector('[data-verify-without-stats]')
  if (!button) return
  const winnerId = declaredWinnerId(root)
  const nextDisabled = busy || !winnerId
  if (button.disabled !== nextDisabled) button.disabled = nextDisabled
  const nextText = busy ? 'Verifying Result...' : 'Verify Without Stats'
  if (button.textContent !== nextText) button.textContent = nextText
}

async function verifyWithoutStats() {
  const root = overlay()
  if (!root || busy) return
  const match = currentReporterMatch(root)
  if (!match) return toast('IEL could not identify this match.', 'error')

  const winnerId = declaredWinnerId(root)
  if (!winnerId) return toast('Declare the series winner first.', 'error')
  if (![String(match.team_a_id), String(match.team_b_id)].includes(winnerId)) {
    return toast('The declared winner is not part of this match.', 'error')
  }

  const target = Math.floor(Number(match.best_of || 5) / 2) + 1
  const reportsResult = await supabase
    .from('map_reports')
    .select('map_number,team_a_score,team_b_score')
    .eq('match_id', match.id)

  if (reportsResult.error) return toast(reportsResult.error.message, 'error')

  let teamAWins = 0
  let teamBWins = 0
  for (const report of reportsResult.data || []) {
    if (Number(report.team_a_score) > Number(report.team_b_score)) teamAWins += 1
    else if (Number(report.team_b_score) > Number(report.team_a_score)) teamBWins += 1
  }

  const existingWinner = teamAWins >= target
    ? String(match.team_a_id)
    : teamBWins >= target
      ? String(match.team_b_id)
      : ''

  if (existingWinner && existingWinner !== winnerId) {
    return toast(`Safety stop: applied maps already calculate ${teamName(match, existingWinner)} as the series winner.`, 'error')
  }

  const winnerIsA = winnerId === String(match.team_a_id)
  const finalA = winnerIsA ? target : Math.min(teamAWins, target - 1)
  const finalB = winnerIsA ? Math.min(teamBWins, target - 1) : target
  const winnerName = teamName(match, winnerId)
  const scoreText = `${match.team_a_name || 'Team A'} ${finalA} — ${finalB} ${match.team_b_name || 'Team B'}`

  const confirmed = window.confirm(
    `Verify ${winnerName} as the winner without adding new player stats?\n\nFinal series result: ${scoreText}\n\nAny stats from maps already applied will remain. No stats will be fabricated for forfeited or unreported maps.`
  )
  if (!confirmed) return

  busy = true
  decorate()
  try {
    const update = await supabase
      .from('matches')
      .update({
        team_a_score: finalA,
        team_b_score: finalB,
        winner_team_id: winnerId,
        status: 'complete',
      })
      .eq('id', match.id)

    if (update.error) throw update.error
    toast(`${scoreText}. Match verified without new player stats.`, 'success')
    window.setTimeout(() => window.location.reload(), 650)
  } catch (error) {
    busy = false
    decorate()
    toast(error.message || 'IEL could not verify this match.', 'error')
  }
}

function handleClick(event) {
  const button = event.target.closest('[data-verify-without-stats]')
  if (!button) return
  event.preventDefault()
  event.stopPropagation()
  verifyWithoutStats().catch((error) => {
    busy = false
    decorate()
    toast(error.message || 'IEL could not verify this match.', 'error')
  })
}

export function initVerifyWithoutStats() {
  if (initialized) return
  initialized = true
  document.addEventListener('click', handleClick)
  observer = new MutationObserver(() => queueMicrotask(decorate))
  observer.observe(document.body, { childList: true, subtree: true })
  decorate()
}
