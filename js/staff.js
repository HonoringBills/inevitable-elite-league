import {
  DIVISIONS,
  esc,
  formatDate,
  loadPublicData,
  loadStaffData,
  refreshIdentity,
  rosterForTeam,
  signInDiscord,
  signOut,
  state,
  statusBadge,
  supabase,
  teamById,
  teamLogo,
  toast,
} from './core.js'

let staffTab = 'overview'
let staffBound = false

function staffHeading() {
  return `
    <section class="page-heading">
      <div class="container">
        <p class="section-label">Authenticated League Operations</p>
        <h1 class="section-title">Staff Command</h1>
        <p class="section-copy">Registration review, approved rosters, qualifier scheduling, match reporting, scoreboard review and public content management.</p>
      </div>
    </section>`
}

function loginView() {
  return `
    <div class="page">
      ${staffHeading()}
      <section class="section">
        <div class="container">
          <div class="card gold" style="max-width:650px;margin:0 auto;text-align:center;padding:48px 30px">
            <span class="card-kicker">Staff Authentication</span>
            <h3>Sign in with Discord</h3>
            <p style="margin-bottom:22px">IEL staff access is tied to an authenticated Supabase user and an active staff record. Signing into Discord alone does not grant league permissions.</p>
            <button class="button button-gold" type="button" data-staff-action="discord-login">Continue with Discord</button>
          </div>
        </div>
      </section>
    </div>`
}

function notAuthorizedView() {
  return `
    <div class="page">
      ${staffHeading()}
      <section class="section">
        <div class="container">
          <div class="card" style="max-width:720px;margin:0 auto">
            <span class="card-kicker">Account Authenticated</span>
            <h3>Staff access has not been granted.</h3>
            <p>Your Discord login succeeded, but this account is not currently listed in IEL's active staff table.</p>
            <p style="margin-top:18px">User UUID</p>
            <div class="code">${esc(state.claims?.sub || '')}</div>
            <div class="admin-actions" style="margin-top:20px">
              <button class="button button-ghost" type="button" data-staff-action="copy-user-id">Copy UUID</button>
              <button class="button button-danger" type="button" data-staff-action="sign-out">Sign Out</button>
            </div>
          </div>
        </div>
      </section>
    </div>`
}

function shell() {
  const displayName = state.staff?.display_name || state.claims?.email || 'IEL Staff'
  const tabs = [
    ['overview', 'Overview'],
    ['registrations', 'Registrations'],
    ['teams', 'Teams'],
    ['schedule', 'Schedule / Results'],
    ['scoreboards', 'Scoreboards'],
    ['content', 'Featured / Partners'],
    ['settings', 'Site Settings'],
  ]

  return `
    <div class="page">
      ${staffHeading()}
      <section class="section">
        <div class="container">
          <div class="admin-toolbar">
            <div><strong>${esc(displayName)}</strong> ${statusBadge(state.staff?.role || 'staff')}</div>
            <button class="button button-danger compact" type="button" data-staff-action="sign-out">Sign Out</button>
          </div>
          <div class="staff-shell">
            <aside class="staff-nav">
              ${tabs.map(([key, label]) => `<button type="button" class="${staffTab === key ? 'active' : ''}" data-staff-tab="${key}">${label}</button>`).join('')}
            </aside>
            <section id="staff-workspace" class="staff-panel">${staffWorkspace()}</section>
          </div>
        </div>
      </section>
    </div>`
}

function overviewPanel() {
  const pending = state.registrations.filter((item) => item.status === 'pending').length
  const activeMatches = state.matches.filter((item) => !['complete', 'cancelled'].includes(item.status)).length
  const pendingUploads = state.uploads.filter((item) => item.status !== 'applied').length
  return `
    <div class="admin-toolbar"><div><p class="section-label">System Status</p><h2 style="margin:0;font:700 34px Oswald;text-transform:uppercase">Season 1 Command</h2></div><button class="button button-ghost compact" type="button" data-staff-action="refresh">Refresh Data</button></div>
    <div class="grid grid-4">
      <article class="card"><span class="card-kicker">Pending</span><h3>${pending}</h3><p>Team registrations waiting for review.</p></article>
      <article class="card"><span class="card-kicker">Approved</span><h3>${state.teams.length}</h3><p>Teams currently published to IEL.</p></article>
      <article class="card"><span class="card-kicker">Active</span><h3>${activeMatches}</h3><p>Matches not yet marked complete.</p></article>
      <article class="card"><span class="card-kicker">Scoreboards</span><h3>${pendingUploads}</h3><p>Uploads still waiting to be applied.</p></article>
    </div>
    <div class="grid grid-2" style="margin-top:20px">
      <article class="card teal"><h3>Database Connected</h3><p>Public pages and Staff Command are using the dedicated Inevitable Elite League Supabase project.</p></article>
      <article class="card gold"><h3>OCR Hook Ready</h3><p>Scoreboards can be uploaded and manually applied now. An automated OCR processor can later populate the same review records without changing the public stats pipeline.</p></article>
    </div>`
}

function registrationRoster(registration) {
  const starters = Array.isArray(registration.players) ? registration.players : []
  const subs = Array.isArray(registration.substitutes) ? registration.substitutes : []
  return `
    <ul class="roster-list">
      ${starters.map((player, index) => `<li><span>${index + 1}. ${esc(player.gamertag || '')}</span><small>${esc(player.activision_id || '')} · starter</small></li>`).join('')}
      ${subs.map((player, index) => `<li><span>${starters.length + index + 1}. ${esc(player.gamertag || '')}</span><small>${esc(player.activision_id || '')} · reserve</small></li>`).join('')}
    </ul>`
}

function registrationsPanel() {
  const pending = state.registrations.filter((item) => item.status === 'pending')
  const reviewed = state.registrations.filter((item) => item.status !== 'pending')
  return `
    <div class="admin-toolbar"><div><p class="section-label">Roster Intake</p><h2 style="margin:0;font:700 34px Oswald;text-transform:uppercase">Team Registrations</h2></div><span class="badge gold">${pending.length} pending</span></div>
    <div class="admin-list">
      ${pending.length ? pending.map((registration) => `
        <article class="card registration-card gold">
          <div class="admin-toolbar" style="margin:0">
            <div><h3>${esc(registration.team_name)}</h3><div class="registration-meta"><span class="badge teal">${esc(registration.division)}</span><span class="badge">${esc(registration.region)}</span><span class="badge">${formatDate(registration.created_at)}</span></div></div>
            ${registration.logo_url ? `<img class="team-logo" style="width:64px;height:64px" src="${esc(registration.logo_url)}" alt="Team logo" />` : ''}
          </div>
          <p><strong>Captain:</strong> ${esc(registration.captain_name)} · ${esc(registration.captain_discord)}</p>
          ${registration.promo_code ? `<p><strong>Promo:</strong> ${esc(registration.promo_code)}</p>` : ''}
          ${registrationRoster(registration)}
          <div class="admin-actions">
            <button class="button button-teal compact" type="button" data-staff-action="approve-registration" data-id="${registration.id}">Approve + Publish</button>
            <button class="button button-danger compact" type="button" data-staff-action="reject-registration" data-id="${registration.id}">Reject</button>
          </div>
        </article>`).join('') : '<div class="empty-state"><strong>No pending registrations</strong>The review queue is clear.</div>'}
    </div>
    ${reviewed.length ? `
      <div style="margin-top:36px"><p class="section-label">Recently Reviewed</p>
        <div class="table-wrap"><table><thead><tr><th>Team</th><th>Division</th><th>Status</th><th>Reviewed</th></tr></thead><tbody>
          ${reviewed.slice(0, 20).map((item) => `<tr><td>${esc(item.team_name)}</td><td>${esc(item.division)}</td><td>${statusBadge(item.status)}</td><td>${formatDate(item.reviewed_at || item.created_at)}</td></tr>`).join('')}
        </tbody></table></div>
      </div>` : ''}`
}

function teamsPanel() {
  return `
    <div class="admin-toolbar"><div><p class="section-label">Approved Field</p><h2 style="margin:0;font:700 34px Oswald;text-transform:uppercase">Teams</h2></div><span class="badge teal">${state.teams.length} approved</span></div>
    ${state.teams.length ? `
      <div class="table-wrap"><table><thead><tr><th>Team</th><th>Division</th><th>Captain</th><th>Seed</th><th>Roster</th><th>Action</th></tr></thead><tbody>
        ${state.teams.map((team) => `<tr>
          <td><div class="team-cell">${teamLogo(team)}<span>${esc(team.team_name)}</span></div></td>
          <td>${esc(team.division)}</td><td>${esc(team.captain_name || '—')}</td><td>${team.seed_number ?? '—'}</td><td>${rosterForTeam(team.id).length}</td>
          <td><button class="button button-ghost compact" type="button" data-staff-action="set-seed" data-id="${team.id}">Set Seed</button></td>
        </tr>`).join('')}
      </tbody></table></div>` : '<div class="empty-state"><strong>No approved teams</strong>Approve registrations to build the Season 1 field.</div>'}`
}

function schedulePanel() {
  const weekCount = state.season?.qualifier_weeks || 4
  return `
    <div class="admin-toolbar"><div><p class="section-label">Qualifier Operations</p><h2 style="margin:0;font:700 34px Oswald;text-transform:uppercase">Schedule + Results</h2></div></div>
    <form id="schedule-generator" class="card gold" style="margin-bottom:24px">
      <h3>Generate Weekly Matchups</h3>
      <p style="margin-bottom:18px">Generates one cycle of matchups so every team in the selected division receives exactly two opponents for that week. Existing non-cancelled matches block duplicate generation.</p>
      <div class="form-grid">
        <div class="field"><label>Week</label><select name="week">${Array.from({ length: weekCount }, (_, i) => `<option value="${i + 1}">Week ${i + 1}</option>`).join('')}</select></div>
        <div class="field"><label>Division</label><select name="division">${DIVISIONS.map((d) => `<option value="${d}">${d}</option>`).join('')}</select></div>
      </div>
      <div class="form-actions"><button class="button button-gold" type="submit">Generate Matchups</button><span class="form-status">Requires 3+ approved teams.</span></div>
    </form>

    <div class="match-list">
      ${state.matches.length ? state.matches.map((match) => `
        <article class="match-card">
          <div class="match-meta">${esc(match.match_code)}<br>Week ${match.week} · R${match.round_number}</div>
          <div class="match-team"><span>${esc(match.team_a_name)}</span></div>
          <div class="match-score">${match.status === 'complete' ? `${match.team_a_score} — ${match.team_b_score}` : 'VS'}</div>
          <div class="match-team right"><span>${esc(match.team_b_name)}</span></div>
          <div class="admin-actions">
            ${statusBadge(match.status)}
            ${match.status !== 'complete' ? `<button class="button button-ghost compact" type="button" data-staff-action="report-match" data-id="${match.id}">Report</button>` : `<button class="button button-ghost compact" type="button" data-staff-action="reopen-match" data-id="${match.id}">Reopen</button>`}
          </div>
        </article>`).join('') : '<div class="empty-state"><strong>No matches yet</strong>Generate the first qualifier week once enough teams are approved.</div>'}
    </div>`
}

function scoreboardPanel() {
  return `
    <div class="admin-toolbar"><div><p class="section-label">Stat Intake</p><h2 style="margin:0;font:700 34px Oswald;text-transform:uppercase">Scoreboard Review</h2></div></div>
    <form id="scoreboard-upload" class="upload-zone" style="margin-bottom:24px">
      <h3 style="margin-top:0;font:700 26px Oswald;text-transform:uppercase">Upload COD Scoreboard</h3>
      <p class="section-copy" style="margin:0 0 18px">PNG, JPG or WEBP. Uploads enter the same review queue an OCR processor will use; staff can manually apply a map immediately.</p>
      <div class="form-grid">
        <div class="field"><label>Match</label><select name="match_id" required><option value="">Select a match</option>${state.matches.filter((m) => m.status !== 'cancelled').map((m) => `<option value="${m.id}">${esc(m.match_code)} · ${esc(m.team_a_name)} vs ${esc(m.team_b_name)}</option>`).join('')}</select></div>
        <div class="field"><label>Map Number</label><select name="map_number">${[1,2,3,4,5,6,7].map((n) => `<option value="${n}">Map ${n}</option>`).join('')}</select></div>
        <div class="field full"><label>Scoreboard Image</label><input type="file" name="scoreboard" accept="image/png,image/jpeg,image/webp" required /></div>
      </div>
      <div class="form-actions"><button class="button button-teal" type="submit">Upload to Review Queue</button></div>
    </form>

    <div class="admin-list">
      ${state.uploads.length ? state.uploads.map((upload) => {
        const match = state.matches.find((m) => m.id === upload.match_id)
        return `<article class="card">
          <div class="admin-toolbar" style="margin:0 0 12px"><div><span class="card-kicker">${esc(match?.match_code || 'Match')} · Map ${upload.map_number}</span><h3>${esc(match ? `${match.team_a_name} vs ${match.team_b_name}` : 'Scoreboard Upload')}</h3></div>${statusBadge(upload.status)}</div>
          <p>Uploaded ${formatDate(upload.created_at)}${upload.confidence != null ? ` · Confidence ${Number(upload.confidence).toFixed(2)}` : ''}</p>
          <div class="admin-actions" style="margin-top:16px">
            <a class="button button-ghost compact" href="${esc(upload.screenshot_url)}" target="_blank" rel="noopener noreferrer">View Image</a>
            ${upload.status !== 'applied' ? `<button class="button button-gold compact" type="button" data-staff-action="manual-apply-map" data-id="${upload.id}">Manual Review + Apply</button>` : ''}
          </div>
        </article>`
      }).join('') : '<div class="empty-state"><strong>No scoreboard uploads</strong>Upload an official map screenshot to start the review queue.</div>'}
    </div>`
}

function contentPanel() {
  return `
    <div class="admin-toolbar"><div><p class="section-label">Public Content</p><h2 style="margin:0;font:700 34px Oswald;text-transform:uppercase">Featured + Partners</h2></div></div>
    <div class="grid grid-2">
      <form id="feature-form" class="card">
        <h3>Publish Featured Player</h3>
        <div class="form-grid">
          <div class="field"><label>Player</label><input name="player_name" required /></div>
          <div class="field"><label>Team</label><input name="team_name" /></div>
          <div class="field full"><label>Title</label><input name="title" placeholder="Week 1 MVP" /></div>
          <div class="field full"><label>Writeup</label><textarea name="writeup"></textarea></div>
          <div class="field"><label>Image URL</label><input name="image_url" type="url" /></div>
          <div class="field"><label>Clip URL</label><input name="clip_url" type="url" /></div>
        </div>
        <div class="form-actions"><button class="button button-gold" type="submit">Publish Feature</button></div>
      </form>

      <form id="sponsor-form" class="card">
        <h3>Add Sponsor / Partner</h3>
        <div class="form-grid">
          <div class="field"><label>Name</label><input name="name" required /></div>
          <div class="field"><label>Kind</label><select name="kind"><option value="partner">Partner</option><option value="sponsor">Sponsor</option></select></div>
          <div class="field full"><label>Description</label><textarea name="description"></textarea></div>
          <div class="field"><label>Logo URL</label><input name="logo_url" type="url" /></div>
          <div class="field"><label>Website URL</label><input name="website_url" type="url" /></div>
        </div>
        <div class="form-actions"><button class="button button-teal" type="submit">Publish Partner</button></div>
      </form>
    </div>

    <div class="grid grid-2" style="margin-top:22px">
      <div><p class="section-label">Featured Players</p><div class="admin-list">${state.staffFeatures.length ? state.staffFeatures.map((item) => `<article class="card"><h3>${esc(item.player_name)}</h3><p>${esc(item.title || '')} · ${item.is_published ? 'Published' : 'Draft'}</p><div class="admin-actions" style="margin-top:12px"><button class="button button-danger compact" type="button" data-staff-action="delete-feature" data-id="${item.id}">Delete</button></div></article>`).join('') : '<div class="empty-state">No features yet.</div>'}</div></div>
      <div><p class="section-label">Sponsors / Partners</p><div class="admin-list">${state.staffSponsors.length ? state.staffSponsors.map((item) => `<article class="card"><h3>${esc(item.name)}</h3><p>${esc(item.kind)} · ${item.is_active ? 'Active' : 'Hidden'}</p><div class="admin-actions" style="margin-top:12px"><button class="button button-danger compact" type="button" data-staff-action="delete-sponsor" data-id="${item.id}">Delete</button></div></article>`).join('') : '<div class="empty-state">No partners yet.</div>'}</div></div>
    </div>`
}

function settingsPanel() {
  const site = state.site || {}
  return `
    <div class="admin-toolbar"><div><p class="section-label">League Presentation</p><h2 style="margin:0;font:700 34px Oswald;text-transform:uppercase">Site Settings</h2></div></div>
    <form id="site-settings-form" class="card gold">
      <div class="form-grid">
        <div class="field"><label>League Name</label><input name="league_name" value="${esc(site.league_name || '')}" required /></div>
        <div class="field"><label>Short Name</label><input name="league_short_name" value="${esc(site.league_short_name || 'IEL')}" required /></div>
        <div class="field"><label>Hero Title</label><input name="hero_title" value="${esc(site.hero_title || '')}" required /></div>
        <div class="field"><label>Hero Subtitle</label><input name="hero_subtitle" value="${esc(site.hero_subtitle || '')}" required /></div>
        <div class="field full"><label>Discord URL</label><input name="discord_url" type="url" value="${esc(site.discord_url || '')}" required /></div>
        <div class="field full"><label>Logo URL</label><input name="logo_url" type="url" value="${esc(site.logo_url || '')}" /></div>
        <div class="field"><label>Registration</label><select name="registration_open"><option value="true" ${site.registration_open ? 'selected' : ''}>Open</option><option value="false" ${!site.registration_open ? 'selected' : ''}>Closed</option></select></div>
      </div>
      <div class="form-actions"><button class="button button-gold" type="submit">Save Site Settings</button></div>
    </form>`
}

function staffWorkspace() {
  switch (staffTab) {
    case 'registrations': return registrationsPanel()
    case 'teams': return teamsPanel()
    case 'schedule': return schedulePanel()
    case 'scoreboards': return scoreboardPanel()
    case 'content': return contentPanel()
    case 'settings': return settingsPanel()
    default: return overviewPanel()
  }
}

async function refreshAndRender() {
  await loadPublicData()
  await refreshIdentity()
  if (state.staff) await loadStaffData()
  const workspace = document.getElementById('staff-workspace')
  if (workspace) workspace.innerHTML = staffWorkspace()
}

async function approveRegistration(id) {
  const registration = state.registrations.find((item) => item.id === id)
  if (!registration) return
  if (!window.confirm(`Approve ${registration.team_name} and publish its roster?`)) return

  let createdTeam = null
  try {
    const existing = await supabase.from('teams').select('id').eq('season_id', registration.season_id).ilike('team_name', registration.team_name).maybeSingle()
    if (existing.data) throw new Error('A team with this name already exists in the active season.')

    const teamResult = await supabase.from('teams').insert({
      season_id: registration.season_id,
      team_name: registration.team_name,
      division: registration.division,
      region: registration.region,
      captain_name: registration.captain_name,
      captain_discord: registration.captain_discord,
      logo_url: registration.logo_url,
      status: 'approved',
    }).select('*').single()
    if (teamResult.error) throw teamResult.error
    createdTeam = teamResult.data

    const starters = Array.isArray(registration.players) ? registration.players : []
    const substitutes = Array.isArray(registration.substitutes) ? registration.substitutes : []
    const captainNorm = String(registration.captain_name || '').trim().toLowerCase()
    const members = [...starters, ...substitutes].map((player, index) => ({
      team_id: createdTeam.id,
      gamertag: player.gamertag,
      activision_id: player.activision_id || null,
      roster_role: index >= starters.length ? 'substitute' : String(player.gamertag || '').trim().toLowerCase() === captainNorm ? 'captain' : 'starter',
      roster_order: index + 1,
      is_active: true,
    }))

    const rosterResult = await supabase.from('team_members').insert(members)
    if (rosterResult.error) throw rosterResult.error

    const reviewResult = await supabase.from('team_registrations').update({
      status: 'approved',
      reviewed_by: state.claims.sub,
      reviewed_at: new Date().toISOString(),
      review_note: 'Approved and published from IEL Staff Command.',
    }).eq('id', id)
    if (reviewResult.error) throw reviewResult.error

    toast(`${registration.team_name} approved and published.`, 'success')
    await refreshAndRender()
  } catch (error) {
    if (createdTeam?.id) await supabase.from('teams').delete().eq('id', createdTeam.id)
    console.error(error)
    toast(error.message || 'Approval failed.', 'error')
  }
}

async function rejectRegistration(id) {
  const registration = state.registrations.find((item) => item.id === id)
  if (!registration) return
  const note = window.prompt(`Reason for rejecting ${registration.team_name}:`, '')
  if (note === null) return

  const result = await supabase.from('team_registrations').update({
    status: 'rejected',
    reviewed_by: state.claims.sub,
    reviewed_at: new Date().toISOString(),
    review_note: note.trim() || 'Rejected by IEL staff.',
  }).eq('id', id)

  if (result.error) return toast(result.error.message, 'error')
  toast(`${registration.team_name} rejected.`, 'success')
  await loadStaffData()
  document.getElementById('staff-workspace').innerHTML = staffWorkspace()
}

async function setSeed(id) {
  const team = state.teams.find((item) => item.id === id)
  if (!team) return
  const value = window.prompt(`Seed number for ${team.team_name}:`, team.seed_number || '')
  if (value === null) return
  const seed = Number.parseInt(value, 10)
  if (!Number.isInteger(seed) || seed < 1) return toast('Seed must be a positive whole number.', 'error')

  const result = await supabase.from('teams').update({ seed_number: seed }).eq('id', id)
  if (result.error) return toast(result.error.message, 'error')
  toast('Seed updated.', 'success')
  await refreshAndRender()
}

function hashString(value) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function weeklyCycle(teams, week, division) {
  const sorted = [...teams].sort((a, b) => {
    const aKey = hashString(`${week}:${division}:${a.id}`)
    const bKey = hashString(`${week}:${division}:${b.id}`)
    return aKey - bKey || String(a.team_name).localeCompare(String(b.team_name))
  })

  const edges = sorted.map((team, index) => [team, sorted[(index + 1) % sorted.length]])
  const used = new Map(sorted.map((team) => [team.id, new Set()]))

  return edges.map(([a, b]) => {
    let round = 1
    while (used.get(a.id).has(round) || used.get(b.id).has(round)) round += 1
    used.get(a.id).add(round)
    used.get(b.id).add(round)
    return { a, b, round }
  })
}

async function generateSchedule(form) {
  const fd = new FormData(form)
  const week = Number.parseInt(fd.get('week'), 10)
  const division = String(fd.get('division'))
  const teams = state.teams.filter((team) => team.division === division)

  if (teams.length < 3) return toast(`${division} needs at least 3 approved teams before generating two opponents per team.`, 'error')
  if ((state.season?.matches_per_team_per_week || 2) !== 2) return toast('This generator is configured for the current two-match weekly format.', 'error')

  const existing = state.matches.filter((match) => match.week === week && match.division === division && match.status !== 'cancelled')
  if (existing.length) return toast(`Week ${week} ${division} already has ${existing.length} match(es). Cancel or clear them before regenerating.`, 'error')

  const pairs = weeklyCycle(teams, week, division)
  const prefix = (state.season?.code || 'S1').replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  const div = division.slice(0, 3).toUpperCase()
  const rows = pairs.map((pair, index) => ({
    season_id: state.season.id,
    match_code: `${prefix}-W${String(week).padStart(2, '0')}-${div}-${String(index + 1).padStart(2, '0')}`,
    week,
    round_number: pair.round,
    division,
    team_a_id: index % 2 === 0 ? pair.a.id : pair.b.id,
    team_b_id: index % 2 === 0 ? pair.b.id : pair.a.id,
    best_of: 5,
    scheduled_at: null,
    status: 'scheduling',
    created_by: state.claims.sub,
  }))

  const result = await supabase.from('matches').insert(rows)
  if (result.error) return toast(result.error.message, 'error')
  toast(`Generated ${rows.length} Week ${week} ${division} matchups. Every team has two opponents.`, 'success')
  await refreshAndRender()
}

async function reportMatch(id) {
  const match = state.matches.find((item) => item.id === id)
  if (!match) return
  const aRaw = window.prompt(`${match.team_a_name} map wins:`, match.team_a_score ?? '')
  if (aRaw === null) return
  const bRaw = window.prompt(`${match.team_b_name} map wins:`, match.team_b_score ?? '')
  if (bRaw === null) return
  const a = Number.parseInt(aRaw, 10)
  const b = Number.parseInt(bRaw, 10)
  if (![a, b].every((value) => Number.isInteger(value) && value >= 0 && value <= match.best_of) || a === b) return toast('Enter valid, non-tied map scores.', 'error')

  const winner = a > b ? match.team_a_id : match.team_b_id
  const result = await supabase.from('matches').update({ team_a_score: a, team_b_score: b, winner_team_id: winner, status: 'complete' }).eq('id', id)
  if (result.error) return toast(result.error.message, 'error')
  toast('Match result applied. Standings will update automatically.', 'success')
  await refreshAndRender()
}

async function reopenMatch(id) {
  if (!window.confirm('Reopen this completed match and remove it from the standings until it is reported again?')) return
  const result = await supabase.from('matches').update({ team_a_score: null, team_b_score: null, winner_team_id: null, status: 'pending_report' }).eq('id', id)
  if (result.error) return toast(result.error.message, 'error')
  toast('Match reopened.', 'success')
  await refreshAndRender()
}

async function uploadScoreboard(form) {
  const fd = new FormData(form)
  const matchId = String(fd.get('match_id') || '')
  const mapNumber = Number.parseInt(fd.get('map_number'), 10)
  const file = fd.get('scoreboard')
  if (!(file instanceof File) || !file.size) return toast('Choose a scoreboard image.', 'error')
  if (file.size > 12 * 1024 * 1024) return toast('Scoreboard image must be 12MB or smaller.', 'error')
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast('Scoreboard must be PNG, JPG, or WEBP.', 'error')

  const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
  const path = `${matchId}/map-${mapNumber}-${crypto.randomUUID()}.${ext}`
  const upload = await supabase.storage.from('scoreboards').upload(path, file, { contentType: file.type, upsert: false })
  if (upload.error) return toast(upload.error.message, 'error')
  const screenshotUrl = supabase.storage.from('scoreboards').getPublicUrl(path).data.publicUrl

  const row = await supabase.from('scoreboard_uploads').insert({
    match_id: matchId,
    map_number: mapNumber,
    screenshot_path: path,
    screenshot_url: screenshotUrl,
    status: 'uploaded',
    uploaded_by: state.claims.sub,
  })
  if (row.error) return toast(row.error.message, 'error')

  form.reset()
  toast('Scoreboard uploaded to the review queue.', 'success')
  await loadStaffData()
  document.getElementById('staff-workspace').innerHTML = staffWorkspace()
}

function parseStatsInput(raw) {
  const values = String(raw).split(',').map((item) => Number.parseInt(item.trim(), 10))
  if (values.length !== 8 || values.some((value) => !Number.isInteger(value) || value < 0)) throw new Error('Use 8 comma-separated non-negative numbers.')
  return {
    kills: values[0], deaths: values[1], damage: values[2], hill_time_seconds: values[3],
    first_bloods: values[4], plants: values[5], defuses: values[6], overloads: values[7],
  }
}

async function manualApplyMap(uploadId) {
  const upload = state.uploads.find((item) => item.id === uploadId)
  const match = state.matches.find((item) => item.id === upload?.match_id)
  if (!upload || !match) return toast('Could not resolve the uploaded scoreboard to a match.', 'error')

  const mapName = window.prompt('Map name:', '')
  if (!mapName) return
  const modeName = window.prompt('Mode: Hardpoint, Search and Destroy, or Overload', 'Hardpoint')
  if (!['Hardpoint', 'Search and Destroy', 'Overload'].includes(modeName)) return toast('Mode must exactly match an IEL mode.', 'error')
  const aRaw = window.prompt(`${match.team_a_name} map score:`, '')
  if (aRaw === null) return
  const bRaw = window.prompt(`${match.team_b_name} map score:`, '')
  if (bRaw === null) return
  const teamAScore = Number.parseInt(aRaw, 10)
  const teamBScore = Number.parseInt(bRaw, 10)
  if (![teamAScore, teamBScore].every((v) => Number.isInteger(v) && v >= 0) || teamAScore === teamBScore) return toast('Map scores must be valid and cannot tie.', 'error')

  const teamAPlayers = rosterForTeam(match.team_a_id, true).slice(0, 4)
  const teamBPlayers = rosterForTeam(match.team_b_id, true).slice(0, 4)
  if (teamAPlayers.length !== 4 || teamBPlayers.length !== 4) return toast('Both teams need four active starter/captain roster records before map stats can be applied.', 'error')

  const instructions = 'kills,deaths,damage,hillSeconds,firstBloods,plants,defuses,overloads'
  const collected = []
  try {
    for (const member of [...teamAPlayers, ...teamBPlayers]) {
      const raw = window.prompt(`${member.gamertag}\nEnter ${instructions}`, '0,0,0,0,0,0,0,0')
      if (raw === null) return
      collected.push({ member, stats: parseStatsInput(raw) })
    }
  } catch (error) {
    return toast(error.message, 'error')
  }

  let report = null
  try {
    const reportResult = await supabase.from('map_reports').insert({
      match_id: match.id,
      scoreboard_upload_id: upload.id,
      map_number: upload.map_number,
      map_name: mapName.trim(),
      mode_name: modeName,
      team_a_score: teamAScore,
      team_b_score: teamBScore,
      reviewed_by: state.claims.sub,
    }).select('*').single()
    if (reportResult.error) throw reportResult.error
    report = reportResult.data

    const statsRows = collected.map(({ member, stats }) => ({
      map_report_id: report.id,
      team_member_id: member.id,
      team_id: member.team_id,
      player_name: member.gamertag,
      ...stats,
      raw_ocr_name: null,
      confidence: null,
    }))
    const statsResult = await supabase.from('player_map_stats').insert(statsRows)
    if (statsResult.error) throw statsResult.error

    const uploadResult = await supabase.from('scoreboard_uploads').update({
      status: 'applied',
      reviewed_by: state.claims.sub,
      reviewed_at: new Date().toISOString(),
      review_json: { source: 'manual_staff_review', map_report_id: report.id },
    }).eq('id', upload.id)
    if (uploadResult.error) throw uploadResult.error

    toast(`Map ${upload.map_number} stats applied.`, 'success')
    await loadStaffData()
    document.getElementById('staff-workspace').innerHTML = staffWorkspace()
  } catch (error) {
    if (report?.id) await supabase.from('map_reports').delete().eq('id', report.id)
    console.error(error)
    toast(error.message || 'Could not apply map stats.', 'error')
  }
}

async function createFeature(form) {
  const fd = new FormData(form)
  const result = await supabase.from('featured_players').insert({
    season_id: state.season?.id || null,
    player_name: String(fd.get('player_name') || '').trim(),
    team_name: String(fd.get('team_name') || '').trim() || null,
    title: String(fd.get('title') || '').trim() || null,
    writeup: String(fd.get('writeup') || '').trim() || null,
    image_url: String(fd.get('image_url') || '').trim() || null,
    clip_url: String(fd.get('clip_url') || '').trim() || null,
    is_published: true,
    published_at: new Date().toISOString(),
  })
  if (result.error) return toast(result.error.message, 'error')
  form.reset()
  toast('Featured Player published.', 'success')
  await refreshAndRender()
}

async function createSponsor(form) {
  const fd = new FormData(form)
  const result = await supabase.from('sponsors').insert({
    name: String(fd.get('name') || '').trim(),
    kind: String(fd.get('kind') || 'partner'),
    description: String(fd.get('description') || '').trim() || null,
    logo_url: String(fd.get('logo_url') || '').trim() || null,
    website_url: String(fd.get('website_url') || '').trim() || null,
    sort_order: state.staffSponsors.length + 1,
    is_active: true,
  })
  if (result.error) return toast(result.error.message, 'error')
  form.reset()
  toast('Sponsor / Partner published.', 'success')
  await refreshAndRender()
}

async function deleteRow(table, id, label) {
  if (!window.confirm(`Delete this ${label}?`)) return
  const result = await supabase.from(table).delete().eq('id', id)
  if (result.error) return toast(result.error.message, 'error')
  toast(`${label} deleted.`, 'success')
  await refreshAndRender()
}

async function saveSettings(form) {
  const fd = new FormData(form)
  const payload = {
    league_name: String(fd.get('league_name') || '').trim(),
    league_short_name: String(fd.get('league_short_name') || '').trim(),
    hero_title: String(fd.get('hero_title') || '').trim(),
    hero_subtitle: String(fd.get('hero_subtitle') || '').trim(),
    discord_url: String(fd.get('discord_url') || '').trim(),
    logo_url: String(fd.get('logo_url') || '').trim() || null,
    registration_open: String(fd.get('registration_open')) === 'true',
    updated_at: new Date().toISOString(),
  }
  const result = await supabase.from('site_settings').update(payload).eq('id', state.site.id)
  if (result.error) return toast(result.error.message, 'error')
  toast('Site settings updated.', 'success')
  await refreshAndRender()
}

async function handleStaffClick(event) {
  const tab = event.target.closest('[data-staff-tab]')
  if (tab) {
    staffTab = tab.dataset.staffTab
    document.querySelectorAll('[data-staff-tab]').forEach((button) => button.classList.toggle('active', button.dataset.staffTab === staffTab))
    document.getElementById('staff-workspace').innerHTML = staffWorkspace()
    return
  }

  const actionEl = event.target.closest('[data-staff-action]')
  if (!actionEl) return
  const action = actionEl.dataset.staffAction
  const id = actionEl.dataset.id

  if (action === 'discord-login') return signInDiscord()
  if (action === 'copy-user-id') {
    await navigator.clipboard.writeText(state.claims?.sub || '')
    return toast('User UUID copied.', 'success')
  }
  if (action === 'sign-out') {
    if (await signOut()) window.location.hash = '#home'
    return
  }
  if (action === 'refresh') return refreshAndRender().then(() => toast('IEL data refreshed.', 'success'))
  if (action === 'approve-registration') return approveRegistration(id)
  if (action === 'reject-registration') return rejectRegistration(id)
  if (action === 'set-seed') return setSeed(id)
  if (action === 'report-match') return reportMatch(id)
  if (action === 'reopen-match') return reopenMatch(id)
  if (action === 'manual-apply-map') return manualApplyMap(id)
  if (action === 'delete-feature') return deleteRow('featured_players', id, 'featured player')
  if (action === 'delete-sponsor') return deleteRow('sponsors', id, 'partner')
}

async function handleStaffSubmit(event) {
  const form = event.target
  if (!(form instanceof HTMLFormElement)) return
  if (!['schedule-generator', 'scoreboard-upload', 'feature-form', 'sponsor-form', 'site-settings-form'].includes(form.id)) return
  event.preventDefault()

  const button = form.querySelector('button[type="submit"]')
  if (button) button.disabled = true
  try {
    if (form.id === 'schedule-generator') await generateSchedule(form)
    if (form.id === 'scoreboard-upload') await uploadScoreboard(form)
    if (form.id === 'feature-form') await createFeature(form)
    if (form.id === 'sponsor-form') await createSponsor(form)
    if (form.id === 'site-settings-form') await saveSettings(form)
  } finally {
    if (button?.isConnected) button.disabled = false
  }
}

export async function prepareStaffPage() {
  await refreshIdentity()
  if (state.staff) await loadStaffData()
}

export function renderStaffPage() {
  if (!state.claims) return loginView()
  if (!state.staff) return notAuthorizedView()
  return shell()
}

export function bindStaffPage() {
  const app = document.getElementById('app')
  if (!app || staffBound) return
  app.addEventListener('click', handleStaffClick)
  app.addEventListener('submit', handleStaffSubmit)
  staffBound = true
}
