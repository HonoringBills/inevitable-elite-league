import { DIVISIONS, esc, supabase, teamLogo } from './core.js'

function formatHill(seconds) {
  const value = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(value / 60)
  const remainder = Math.floor(value % 60)
  return `${minutes}:${String(remainder).padStart(2, '0')}`
}

function heading() {
  return `
    <section class="page-heading">
      <div class="container">
        <p class="section-label">Stats Perk Package</p>
        <h1 class="section-title">IEL Stats</h1>
        <p class="section-copy">Official OCR-tracked player and team performance. Only teams with the Stats Perk Package enabled are published here.</p>
      </div>
    </section>`
}

export function renderStatsPage() {
  return `
    <div class="page">
      <style>
        #stats-page-content .iel-stats-team-link {
          position: relative;
          outline: 1px solid transparent;
          transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease, filter .18s ease;
        }
        #stats-page-content .iel-stats-team-link:hover,
        #stats-page-content .iel-stats-team-link:focus-visible {
          transform: translateY(-4px);
          border-color: var(--gold-bright);
          outline-color: rgba(120,255,242,.30);
          box-shadow:
            0 0 0 1px rgba(255,225,133,.52),
            0 0 14px rgba(216,183,91,.62),
            0 0 30px rgba(47,216,203,.28),
            0 18px 42px rgba(0,0,0,.50),
            inset 0 0 22px rgba(47,216,203,.06);
          filter: brightness(1.06);
        }
        #stats-page-content .iel-stats-team-link:hover h3,
        #stats-page-content .iel-stats-team-link:focus-visible h3 {
          color: var(--gold-bright);
          text-shadow: var(--glow-gold);
        }
      </style>
      ${heading()}
      <section class="section">
        <div class="container">
          <div class="callout" style="margin-bottom:22px">
            <p class="section-label">Tracked by IEL OCR</p>
            <h3>Paid stat tracking, verified by Staff.</h3>
            <p>Scoreboards are read during Match Reporting. Map results count for every IEL team; player statistics are stored and published only when that team has the Stats Perk Package active.</p>
          </div>
          <div id="stats-page-content" class="empty-state"><strong>Loading IEL Stats...</strong><span>Reading the active stat package data.</span></div>
        </div>
      </section>
    </div>`
}

function playerTable(rows, { showTeam = true } = {}) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Player</th>${showTeam ? '<th>Team</th>' : ''}<th>Maps</th><th>K</th><th>D</th><th>K/D</th><th>Damage</th><th>Hill</th><th>FB</th><th>Plants</th><th>Def</th><th>OL</th></tr></thead>
        <tbody>${rows.map((row, index) => `
          <tr>
            <td><span class="rank">${index + 1}</span> <strong>${esc(row.player_name)}</strong></td>
            ${showTeam ? `<td>${esc(row.team_name)}</td>` : ''}
            <td>${row.maps_played ?? 0}</td>
            <td>${row.kills ?? 0}</td>
            <td>${row.deaths ?? 0}</td>
            <td><strong>${Number(row.kd ?? 0).toFixed(2)}</strong></td>
            <td>${Number(row.damage ?? 0).toLocaleString()}</td>
            <td>${formatHill(row.hill_time_seconds)}</td>
            <td>${row.first_bloods ?? 0}</td>
            <td>${row.plants ?? 0}</td>
            <td>${row.defuses ?? 0}</td>
            <td>${row.overloads ?? 0}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div>`
}

function teamStatsHref(teamId) {
  return `?stats_team=${encodeURIComponent(teamId)}#stats`
}

function teamCards(rows) {
  return `<div class="grid grid-3">${rows.map((row) => `
    <a class="card gold iel-stats-team-link" href="${teamStatsHref(row.team_id)}" data-stats-team="${esc(row.team_id)}" style="display:block;color:inherit;text-decoration:none;cursor:pointer">
      <div class="team-card-head">
        ${teamLogo(row)}
        <div><span class="badge gold">Stats Perk</span><h3>${esc(row.team_name)}</h3><small>${esc(row.division)}</small></div>
      </div>
      <div class="stat-strip" style="grid-template-columns:repeat(3,1fr);margin:18px -24px -24px">
        <div><strong>${Number(row.win_percentage ?? 0).toFixed(1)}%</strong><span>Win %</span></div>
        <div><strong>${Number(row.kd ?? 0).toFixed(2)}</strong><span>Team K/D</span></div>
        <div><strong>${row.series_played ?? 0}</strong><span>Series Played</span></div>
      </div>
    </a>`).join('')}</div>`
}

function teamDetail(team, players) {
  const sortedPlayers = [...players].sort((a, b) => Number(b.kills || 0) - Number(a.kills || 0))
  return `
    <div class="admin-toolbar" style="margin-bottom:22px">
      <button class="button button-ghost compact" type="button" data-stats-back>← All Stats</button>
      <span class="badge gold">Stats Perk Team</span>
    </div>

    <article class="card gold" style="margin-bottom:24px">
      <div class="team-card-head">
        ${teamLogo(team)}
        <div>
          <p class="section-label" style="margin-bottom:6px">${esc(team.division)} Division</p>
          <h2 class="section-title" style="font-size:34px;margin:0">${esc(team.team_name)}</h2>
          <p style="margin:8px 0 0;color:var(--muted)">Official IEL OCR-tracked team profile.</p>
        </div>
      </div>
      <div class="stat-strip" style="grid-template-columns:repeat(4,1fr);margin:22px -24px -24px">
        <div><strong>${rowNumber(team.win_percentage, 1)}%</strong><span>Series Win %</span></div>
        <div><strong>${team.series_played ?? 0}</strong><span>Series Played</span></div>
        <div><strong>${Number(team.kd ?? 0).toFixed(2)}</strong><span>Team K/D</span></div>
        <div><strong>${team.maps_tracked ?? 0}</strong><span>Maps Tracked</span></div>
      </div>
    </article>

    <div class="section-head" style="margin:34px 0 18px">
      <div><p class="section-label">${esc(team.team_name)}</p><h2 class="section-title" style="font-size:34px">Player Stats</h2></div>
    </div>
    ${sortedPlayers.length ? playerTable(sortedPlayers, { showTeam: false }) : '<div class="empty-state"><strong>No player stats yet.</strong><span>This team has no applied OCR player data yet.</span></div>'}`
}

function rowNumber(value, digits = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(digits) : Number(0).toFixed(digits)
}

function currentTeamId() {
  return new URL(window.location.href).searchParams.get('stats_team') || ''
}

function setTeamUrl(teamId) {
  const url = new URL(window.location.href)
  if (teamId) url.searchParams.set('stats_team', teamId)
  else url.searchParams.delete('stats_team')
  url.hash = 'stats'
  window.history.pushState({}, '', url)
}

function renderStatsHub(root, players, teams) {
  root.className = ''
  root.innerHTML = `
    <div class="section-head" style="margin-bottom:20px"><div><p class="section-label">Tracked Teams</p><h2 class="section-title" style="font-size:34px">Package Leaders</h2></div></div>
    ${teamCards(teams)}
    <div class="section-head" style="margin:48px 0 20px"><div><p class="section-label">Player Leaderboard</p><h2 class="section-title" style="font-size:34px">Official Player Stats</h2></div></div>
    <div class="tabs" aria-label="Stats division filters">
      <button class="tab active" data-stats-division="all">All</button>
      ${DIVISIONS.map((division) => `<button class="tab" data-stats-division="${esc(division)}">${esc(division)}</button>`).join('')}
    </div>
    <div id="stats-player-table">${playerTable(players)}</div>`

  root.querySelectorAll('[data-stats-team]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      const team = teams.find((row) => String(row.team_id) === String(link.dataset.statsTeam))
      if (!team) return
      setTeamUrl(team.team_id)
      root.innerHTML = teamDetail(team, players.filter((row) => String(row.team_id) === String(team.team_id)))
      bindDetailBack(root, players, teams)
      window.scrollTo({ top: 0, behavior: 'auto' })
    })
  })

  root.querySelectorAll('[data-stats-division]').forEach((button) => {
    button.addEventListener('click', () => {
      root.querySelectorAll('[data-stats-division]').forEach((item) => item.classList.toggle('active', item === button))
      const division = button.dataset.statsDivision
      const filtered = division === 'all' ? players : players.filter((row) => row.division === division)
      document.getElementById('stats-player-table').innerHTML = filtered.length ? playerTable(filtered) : '<div class="empty-state"><strong>No tracked players</strong><span>No Stats Perk data has been published for this division yet.</span></div>'
    })
  })
}

function bindDetailBack(root, players, teams) {
  root.querySelector('[data-stats-back]')?.addEventListener('click', () => {
    setTeamUrl('')
    renderStatsHub(root, players, teams)
    window.scrollTo({ top: 0, behavior: 'auto' })
  })
}

export async function bindStatsPage() {
  const root = document.getElementById('stats-page-content')
  if (!root) return
  const [playersResult, teamsResult] = await Promise.all([
    supabase.from('public_player_stats').select('*').order('kills', { ascending: false }),
    supabase.from('public_team_stats').select('*').order('win_percentage', { ascending: false }).order('series_played', { ascending: false }),
  ])

  if (playersResult.error || teamsResult.error) {
    console.error('[IEL Stats]', playersResult.error || teamsResult.error)
    root.innerHTML = '<strong>Stats are temporarily unavailable.</strong><span>IEL Staff can still report matches while this page reconnects.</span>'
    return
  }

  const players = playersResult.data || []
  const teams = teamsResult.data || []
  if (!players.length && !teams.length) {
    root.innerHTML = '<strong>No tracked stats yet.</strong><span>Teams with the Stats Perk Package will appear here after Staff applies their first OCR-reviewed scoreboard.</span>'
    return
  }

  const selectedTeamId = currentTeamId()
  const selectedTeam = teams.find((row) => String(row.team_id) === String(selectedTeamId))
  if (selectedTeam) {
    root.className = ''
    root.innerHTML = teamDetail(selectedTeam, players.filter((row) => String(row.team_id) === String(selectedTeam.team_id)))
    bindDetailBack(root, players, teams)
    return
  }

  renderStatsHub(root, players, teams)
}
