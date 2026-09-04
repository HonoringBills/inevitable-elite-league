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

function playerTable(rows) {
  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Player</th><th>Team</th><th>Maps</th><th>K</th><th>D</th><th>K/D</th><th>Damage</th><th>Hill</th><th>FB</th><th>Plants</th><th>Def</th><th>OL</th></tr></thead>
        <tbody>${rows.map((row, index) => `
          <tr>
            <td><span class="rank">${index + 1}</span> <strong>${esc(row.player_name)}</strong></td>
            <td>${esc(row.team_name)}</td>
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

function teamCards(rows) {
  return `<div class="grid grid-3">${rows.map((row) => `
    <article class="card gold">
      <div class="team-card-head">
        ${teamLogo(row)}
        <div><span class="badge gold">Stats Perk</span><h3>${esc(row.team_name)}</h3><small>${esc(row.division)}</small></div>
      </div>
      <div class="stat-strip" style="grid-template-columns:repeat(3,1fr);margin:18px -24px -24px">
        <div><strong>${row.maps_tracked ?? 0}</strong><span>Maps</span></div>
        <div><strong>${Number(row.kd ?? 0).toFixed(2)}</strong><span>Team K/D</span></div>
        <div><strong>${Number(row.damage ?? 0).toLocaleString()}</strong><span>Damage</span></div>
      </div>
    </article>`).join('')}</div>`
}

export async function bindStatsPage() {
  const root = document.getElementById('stats-page-content')
  if (!root) return
  const [playersResult, teamsResult] = await Promise.all([
    supabase.from('public_player_stats').select('*').order('kills', { ascending: false }),
    supabase.from('public_team_stats').select('*').order('kills', { ascending: false }),
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

  root.querySelectorAll('[data-stats-division]').forEach((button) => {
    button.addEventListener('click', () => {
      root.querySelectorAll('[data-stats-division]').forEach((item) => item.classList.toggle('active', item === button))
      const division = button.dataset.statsDivision
      const filtered = division === 'all' ? players : players.filter((row) => row.division === division)
      document.getElementById('stats-player-table').innerHTML = filtered.length ? playerTable(filtered) : '<div class="empty-state"><strong>No tracked players</strong><span>No Stats Perk data has been published for this division yet.</span></div>'
    })
  })
}
