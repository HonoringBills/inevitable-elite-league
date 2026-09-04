import {
  DIVISIONS,
  esc,
  formatDate,
  rosterForTeam,
  sortStandings,
  state,
  statusBadge,
  supabase,
  teamLogo,
  toast,
} from './core.js'

function heading(kicker, title, copy = '') {
  return `
    <section class="page-heading">
      <div class="container">
        <p class="section-label">${esc(kicker)}</p>
        <h1 class="section-title">${esc(title)}</h1>
        ${copy ? `<p class="section-copy">${esc(copy)}</p>` : ''}
      </div>
    </section>`
}

function empty(title, copy) {
  return `<div class="empty-state"><strong>${esc(title)}</strong>${esc(copy)}</div>`
}

function divisionCards() {
  const divisions = [
    ['Entry', 'E', 'A proving ground for rising rosters ready to establish themselves in IEL.'],
    ['Elite', 'X', 'Established competition with tighter eligibility standards and stronger fields.'],
    ['Masters', 'M', "IEL's highest level of competition — built for the league's strongest rosters."],
  ]

  return divisions.map(([name, letter, copy]) => `
    <article class="card division-card ${name === 'Masters' ? 'gold' : ''}" data-letter="${letter}">
      <div>
        <span class="card-kicker">${name} Division</span>
        <h3>${name}</h3>
        <p>${copy}</p>
      </div>
      <span class="badge ${name === 'Masters' ? 'gold' : 'teal'}">Season 1</span>
    </article>`).join('')
}

function homePage() {
  const site = state.site || {}
  const season = state.season || {}
  const teamCount = state.teams.length
  const weeklyMatches = teamCount ? teamCount : 0
  const qualifierWeeks = season.qualifier_weeks || 4

  return `
    <div class="page">
      <section class="hero">
        <div class="container hero-inner">
          <div class="eyebrow">IEL Presents ${esc(site.hero_title || 'Season 1')}</div>
          <h1>${esc(site.hero_title || 'Season 1')}<span>${esc(site.hero_subtitle || 'Founders Season')}</span></h1>
          <p class="lead"><strong>Build your legacy. Compete for history.</strong> Register your squad, battle through weekly qualifiers, and become part of the league's first chapter.</p>
          <div class="hero-actions">
            <a class="button button-gold" href="#register">Register Team →</a>
            <a class="button button-ghost" href="${esc(site.discord_url || '#')}" target="_blank" rel="noopener noreferrer">Join Discord</a>
          </div>
          <div class="hero-stats">
            <div class="hero-stat"><strong>${teamCount}</strong><span>Approved Teams</span></div>
            <div class="hero-stat"><strong>${weeklyMatches}</strong><span>Matches / Week at Full Field</span></div>
            <div class="hero-stat"><strong>3</strong><span>Divisions</span></div>
            <div class="hero-stat"><strong>${qualifierWeeks}</strong><span>Qualifier Weeks</span></div>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="container">
          <p class="section-label">Founders Season</p>
          <h2 class="section-title">Build the first legacy.</h2>
          <p class="section-copy">Every qualifier win improves your Major path. The top two teams in each division earn permanent Founder Team recognition.</p>
          <div class="grid grid-3" style="margin-top:30px">${divisionCards()}</div>
        </div>
      </section>

      <section class="stat-strip">
        <div><strong>4v4</strong><span>Competitive Format</span></div>
        <div><strong>2</strong><span>Matchups Per Team / Week</span></div>
        <div><strong>${qualifierWeeks}</strong><span>Qualifier Weeks</span></div>
        <div><strong>1</strong><span>Founders Season</span></div>
      </section>

      <section class="section">
        <div class="container">
          <p class="section-label">The Format</p>
          <h2 class="section-title">Compete. Qualify. Conquer.</h2>
          <div class="grid grid-4 steps" style="margin-top:30px">
            <article class="card step"><h3>Register</h3><p>Submit a complete six-player roster for league review.</p></article>
            <article class="card step"><h3>Qualify</h3><p>Play two seeded matchups each week during the qualifier stage.</p></article>
            <article class="card step"><h3>Battle</h3><p>Build your record and earn the strongest possible Major bracket position.</p></article>
            <article class="card step"><h3>Become Champions</h3><p>Survive the bracket, win your division, and make IEL history.</p></article>
          </div>
        </div>
      </section>

      <section class="section-tight">
        <div class="container">
          <div class="callout">
            <p class="section-label">Hall of Champions</p>
            <h3>The first IEL champion will be etched here.</h3>
            <p>Season 1 is the beginning. The teams that win it will always be the first.</p>
          </div>
        </div>
      </section>
    </div>`
}

function qualifiersPage() {
  const weeks = state.season?.qualifier_weeks || 4
  const perWeek = state.season?.matches_per_team_per_week || 2
  return `
    <div class="page">
      ${heading('Season 1', 'Qualifiers', 'The weekly proving ground that determines Major seeding and establishes the first IEL Founder Teams.')}
      <section class="section">
        <div class="container">
          <div class="grid grid-3">
            <article class="card gold"><span class="card-kicker">Length</span><h3>${weeks} Weeks</h3><p>Each qualifier week adds to your season record and Major path.</p></article>
            <article class="card"><span class="card-kicker">Weekly Load</span><h3>${perWeek} Matches</h3><p>Every approved team receives two qualifier matchups per week.</p></article>
            <article class="card teal"><span class="card-kicker">Founder Status</span><h3>Top Two</h3><p>The top two finishers in each division earn permanent Founder Team recognition.</p></article>
          </div>

          <div class="grid grid-2" style="margin-top:28px">
            <article class="card">
              <span class="card-kicker">Seeding</span>
              <h3>Every map matters.</h3>
              <p>Standings track match wins, losses, map wins, map losses and map differential. Stronger qualifier results improve your path into the Major.</p>
            </article>
            <article class="card">
              <span class="card-kicker">Integrity</span>
              <h3>Reviewed rosters.</h3>
              <p>Teams enter competition only after league review. Approved rosters remain visible on the Teams page so opponents and staff are working from the same source of truth.</p>
            </article>
          </div>

          <div class="callout" style="margin-top:28px">
            <h3>Three divisions. One standard.</h3>
            <p>Entry, Elite and Masters each run their own qualifier race and Major path under the same IEL competitive structure.</p>
          </div>
        </div>
      </section>
    </div>`
}

function majorsPage() {
  return `
    <div class="page">
      ${heading('The Next Stage', 'Majors', 'Qualifier performance earns your path. Major brackets turn that work into championship opportunity.')}
      <section class="section">
        <div class="container">
          <div class="grid grid-3">
            <article class="card"><span class="card-kicker">01 · Earn It</span><h3>Qualifier Seeding</h3><p>Major placement is built from official qualifier results, not reputation.</p></article>
            <article class="card gold"><span class="card-kicker">02 · Survive It</span><h3>Bracket Play</h3><p>Once the field locks, IEL publishes the Major bracket and official match path.</p></article>
            <article class="card"><span class="card-kicker">03 · Finish It</span><h3>Championship</h3><p>Win when the field is strongest and your name goes into the IEL record book.</p></article>
          </div>
          <div class="callout" style="margin-top:28px">
            <h3>Bracket details publish when the field locks.</h3>
            <p>That keeps Season 1 flexible enough to match the final approved team count in each division without changing competitive results after play begins.</p>
          </div>
        </div>
      </section>
    </div>`
}

function matchMarkup(match) {
  const left = { team_name: match.team_a_name, logo_url: match.team_a_logo_url }
  const right = { team_name: match.team_b_name, logo_url: match.team_b_logo_url }
  const complete = match.status === 'complete'
  const score = complete ? `${match.team_a_score ?? 0} — ${match.team_b_score ?? 0}` : 'VS'
  return `
    <article class="match-card" data-match-week="${match.week}">
      <div class="match-meta">Week ${match.week}<br>${formatDate(match.scheduled_at)}</div>
      <div class="match-team">${teamLogo(left)}<span>${esc(match.team_a_name || 'TBD')}</span></div>
      <div class="match-score">${esc(score)}</div>
      <div class="match-team right"><span>${esc(match.team_b_name || 'TBD')}</span>${teamLogo(right)}</div>
      ${statusBadge(match.status || 'scheduling')}
    </article>`
}

function schedulePage() {
  const matches = state.matches
  const maxWeek = Math.max(state.season?.qualifier_weeks || 4, ...matches.map((m) => m.week || 0))
  const weekButtons = Array.from({ length: maxWeek }, (_, i) => i + 1)
    .map((week) => `<button class="tab" type="button" data-week-filter="${week}">Week ${week}</button>`).join('')

  return `
    <div class="page">
      ${heading('Official Match Board', 'Schedule', 'Official IEL matchups and completed results update from the league database.')}
      <section class="section">
        <div class="container">
          <div class="tabs">
            <button class="tab active" type="button" data-week-filter="all">All</button>
            ${weekButtons}
          </div>
          <div id="schedule-list" class="match-list">
            ${matches.length ? matches.map(matchMarkup).join('') : empty('Schedule not generated yet', 'Approved teams will appear here as soon as staff publishes the first qualifier week.')}
          </div>
        </div>
      </section>
    </div>`
}

function rosterMarkup(team) {
  const roster = rosterForTeam(team.id)
  return `
    <article class="card team-card">
      <div class="team-card-head">
        ${teamLogo(team)}
        <div>
          <h3>${esc(team.team_name)}</h3>
          <span class="badge ${team.division === 'Masters' ? 'gold' : 'teal'}">${esc(team.division)}</span>
        </div>
      </div>
      ${roster.length ? `
        <ul class="roster-list">
          ${roster.map((member) => `<li><span>${esc(member.gamertag)}</span><small>${esc(member.roster_role)}</small></li>`).join('')}
        </ul>` : '<p>Roster details will publish after approval.</p>'}
    </article>`
}

function teamsPage() {
  const teams = state.teams
  return `
    <div class="page">
      ${heading('Approved Rosters', 'Teams', 'Every team shown here has cleared IEL league review for the active season.')}
      <section class="section">
        <div class="container">
          <div class="tabs">
            <button class="tab active" type="button" data-team-filter="all">All · ${teams.length}</button>
            ${DIVISIONS.map((division) => `<button class="tab" type="button" data-team-filter="${division}">${division} · ${teams.filter((t) => t.division === division).length}</button>`).join('')}
          </div>
          <div class="team-grid">
            ${teams.length ? teams.map((team) => `<div data-team-division="${esc(team.division)}">${rosterMarkup(team)}</div>`).join('') : empty('No approved teams yet', 'Season 1 registration is open. Approved rosters will automatically populate this page.')}
          </div>
        </div>
      </section>
    </div>`
}

function standingsTable(division) {
  const rows = sortStandings(state.standings.filter((row) => row.division === division))
  if (!rows.length) return empty(`${division} standings pending`, 'Standings appear automatically once approved teams and completed results are in the system.')

  return `
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Team</th><th>GP</th><th>W</th><th>L</th><th>MW</th><th>ML</th><th>Diff</th></tr></thead>
        <tbody>
          ${rows.map((row, index) => `
            <tr>
              <td class="rank">${index + 1}</td>
              <td><div class="team-cell">${teamLogo(row)}<span>${esc(row.team_name)}</span></div></td>
              <td>${row.played ?? 0}</td><td>${row.wins ?? 0}</td><td>${row.losses ?? 0}</td>
              <td>${row.maps_won ?? 0}</td><td>${row.maps_lost ?? 0}</td>
              <td>${Number(row.map_diff || 0) > 0 ? '+' : ''}${row.map_diff ?? 0}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`
}

function standingsPage() {
  return `
    <div class="page">
      ${heading('Season 1 · Live', 'Standings', 'Wins, losses and map differential are calculated from completed official IEL matches.')}
      <section class="section">
        <div class="container">
          ${DIVISIONS.map((division) => `
            <div style="margin-bottom:42px">
              <p class="section-label">${division} Division</p>
              <h2 style="font:700 32px Oswald;margin:0 0 16px;text-transform:uppercase">${division} Standings</h2>
              ${standingsTable(division)}
            </div>`).join('')}
        </div>
      </section>
    </div>`
}

function featuredPage() {
  return `
    <div class="page">
      ${heading('Player Spotlight', 'Featured Players', 'IEL spotlights performances, stories and moments that define the season.')}
      <section class="section">
        <div class="container">
          <div class="grid grid-3">
            ${state.featured.length ? state.featured.map((player) => `
              <article class="card feature-card">
                ${player.image_url ? `<img class="feature-image" src="${esc(player.image_url)}" alt="${esc(player.player_name)}" loading="lazy" />` : '<div class="feature-image"></div>'}
                <div class="feature-body">
                  <span class="card-kicker">${esc(player.title || 'Featured Player')}</span>
                  <h3>${esc(player.player_name)}</h3>
                  <p style="margin-bottom:12px">${esc(player.team_name || 'IEL')}</p>
                  <p>${esc(player.writeup || '')}</p>
                  ${player.clip_url ? `<a class="button button-ghost compact" style="margin-top:16px" href="${esc(player.clip_url)}" target="_blank" rel="noopener noreferrer">Watch Clip</a>` : ''}
                </div>
              </article>`).join('') : empty('The spotlight is waiting', 'Staff can publish the first Season 1 Featured Player directly from the IEL dashboard.')}
          </div>
        </div>
      </section>
    </div>`
}

function sponsorsPage() {
  return `
    <div class="page">
      ${heading('League Support', 'Sponsors / Partners', 'The organizations helping build the first chapter of Inevitable Elite League.')}
      <section class="section">
        <div class="container">
          <div class="grid grid-3">
            ${state.sponsors.length ? state.sponsors.map((partner) => `
              <article class="card">
                ${partner.logo_url ? `<img class="partner-logo" src="${esc(partner.logo_url)}" alt="${esc(partner.name)} logo" loading="lazy" />` : ''}
                <span class="card-kicker">${esc(partner.kind || 'Partner')}</span>
                <h3>${esc(partner.name)}</h3>
                <p>${esc(partner.description || '')}</p>
                ${partner.website_url ? `<a class="button button-ghost compact" style="margin-top:16px" href="${esc(partner.website_url)}" target="_blank" rel="noopener noreferrer">Visit Partner</a>` : ''}
              </article>`).join('') : empty('Partnership slots open', 'Official IEL sponsors and partners will appear here when activated by league staff.')}
          </div>
        </div>
      </section>
    </div>`
}

function championsPage() {
  return `
    <div class="page">
      ${heading('History Starts Here', 'Hall of Champions', 'Every champion will have a permanent place in the IEL record book.')}
      <section class="section">
        <div class="container">
          <div class="callout" style="text-align:center;padding:70px 30px">
            <p class="section-label">Season 1 · Founders Season</p>
            <h3 style="font-size:clamp(38px,7vw,80px)">TBD</h3>
            <p>The first IEL champions have not been crowned yet.</p>
          </div>
        </div>
      </section>
    </div>`
}

function playerInputs() {
  return [1, 2, 3, 4].map((number) => `
    <div class="player-row">
      <div class="player-number">${number}</div>
      <div class="field"><label>Starter ${number} Gamertag</label><input name="p${number}_gamertag" maxlength="50" required /></div>
      <div class="field"><label>Activision ID</label><input name="p${number}_activision" maxlength="100" required placeholder="Name#1234567" /></div>
    </div>`).join('') + [5, 6].map((number, idx) => `
    <div class="player-row">
      <div class="player-number">${number}</div>
      <div class="field"><label>Reserve ${idx + 1} Gamertag</label><input name="p${number}_gamertag" maxlength="50" required /></div>
      <div class="field"><label>Activision ID</label><input name="p${number}_activision" maxlength="100" required placeholder="Name#1234567" /></div>
    </div>`).join('')
}

function registerPage() {
  const open = state.site?.registration_open !== false
  const season = state.season

  return `
    <div class="page">
      ${heading('Season 1', open ? 'Register Your Team' : 'Registration Closed', open ? 'Submit your full six-player roster for IEL review.' : 'League staff has closed new registrations for the active season.')}
      <section class="section">
        <div class="container">
          ${!open ? empty('Registration is currently closed', 'Watch the IEL Discord for the next registration window.') : !season ? empty('No active season', 'Staff must activate a season before team registrations can be submitted.') : `
          <form id="registration-form" class="card form-card gold">
            <div class="form-grid">
              <div class="field"><label>Team Name</label><input name="team_name" minlength="2" maxlength="80" required /></div>
              <div class="field"><label>Division</label><select name="division" required>${DIVISIONS.map((d) => `<option value="${d}">${d}</option>`).join('')}</select></div>
              <div class="field"><label>Region</label><select name="region" required><option value="NA">North America</option><option value="EU">Europe</option><option value="Other">Other</option></select></div>
              <div class="field"><label>Captain Name</label><input name="captain_name" maxlength="80" required /></div>
              <div class="field"><label>Captain Discord</label><input name="captain_discord" maxlength="100" required placeholder="@username or Discord ID" /></div>
              <div class="field"><label>Promo Code <small>(optional)</small></label><input name="promo_code" maxlength="50" /></div>
              <div class="field full"><label>Team Logo <small>(optional · PNG/JPG/WEBP · 6MB max)</small></label><input name="team_logo" type="file" accept="image/png,image/jpeg,image/webp" /></div>
            </div>

            <div class="form-section">
              <h3>Six-Player Roster</h3>
              <p class="section-copy" style="margin:-8px 0 18px">Four starters plus two reserves. Staff can adjust roster roles after approval if needed.</p>
              ${playerInputs()}
            </div>

            <div class="form-actions">
              <button class="button button-gold" type="submit">Submit for Review</button>
              <span id="registration-status" class="form-status">Season: ${esc(season.name || season.code || 'Active')}</span>
            </div>
          </form>`}
        </div>
      </section>
    </div>`
}

async function handleRegistration(event) {
  event.preventDefault()
  const form = event.currentTarget
  const status = document.getElementById('registration-status')
  const submit = form.querySelector('button[type="submit"]')
  const fd = new FormData(form)

  if (!state.site?.registration_open || !state.season?.id) {
    toast('Registration is not currently available.', 'error')
    return
  }

  submit.disabled = true
  status.textContent = 'Submitting registration...'

  try {
    const players = [1, 2, 3, 4].map((number) => ({
      gamertag: String(fd.get(`p${number}_gamertag`) || '').trim(),
      activision_id: String(fd.get(`p${number}_activision`) || '').trim(),
      roster_role: 'starter',
    }))
    const substitutes = [5, 6].map((number) => ({
      gamertag: String(fd.get(`p${number}_gamertag`) || '').trim(),
      activision_id: String(fd.get(`p${number}_activision`) || '').trim(),
      roster_role: 'substitute',
    }))

    if ([...players, ...substitutes].some((player) => !player.gamertag || !player.activision_id)) {
      throw new Error('All six players need a gamertag and Activision ID.')
    }

    let logoUrl = null
    const logo = fd.get('team_logo')
    if (logo instanceof File && logo.size > 0) {
      if (logo.size > 6 * 1024 * 1024) throw new Error('Team logo must be 6MB or smaller.')
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(logo.type)) throw new Error('Team logo must be PNG, JPG, or WEBP.')

      const ext = (logo.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')
      const path = `registrations/${crypto.randomUUID()}.${ext}`
      status.textContent = 'Uploading team logo...'
      const upload = await supabase.storage.from('team-logos').upload(path, logo, { contentType: logo.type, upsert: false })
      if (upload.error) throw upload.error
      logoUrl = supabase.storage.from('team-logos').getPublicUrl(path).data.publicUrl
    }

    status.textContent = 'Sending roster for staff review...'
    const result = await supabase.from('team_registrations').insert({
      season_id: state.season.id,
      team_name: String(fd.get('team_name') || '').trim(),
      division: String(fd.get('division') || 'Entry'),
      region: String(fd.get('region') || 'NA'),
      captain_name: String(fd.get('captain_name') || '').trim(),
      captain_discord: String(fd.get('captain_discord') || '').trim(),
      logo_url: logoUrl,
      players,
      substitutes,
      promo_code: String(fd.get('promo_code') || '').trim() || null,
      status: 'pending',
    }).select('id').single()

    if (result.error) throw result.error
    form.reset()
    status.textContent = `Submitted · Reference ${result.data.id.slice(0, 8).toUpperCase()}`
    toast('Team registration submitted for IEL staff review.', 'success')
  } catch (error) {
    console.error(error)
    status.textContent = error.message || 'Registration failed.'
    toast(error.message || 'Registration failed.', 'error')
  } finally {
    submit.disabled = false
  }
}

function comingSoonPage(name) {
  return `<div class="page">${heading('IEL', name, 'This section is reserved in the production site and will publish when league staff activates it.')}<section class="section"><div class="container">${empty(`${name} coming soon`, 'The production route is ready for Season 1 content.')}</div></section></div>`
}

export function renderPublicRoute(route) {
  switch (route) {
    case 'home': return homePage()
    case 'qualifiers': return qualifiersPage()
    case 'majors': return majorsPage()
    case 'schedule': return schedulePage()
    case 'teams': return teamsPage()
    case 'standings': return standingsPage()
    case 'featured': return featuredPage()
    case 'sponsors': return sponsorsPage()
    case 'champions': return championsPage()
    case 'register': return registerPage()
    case 'merch': return comingSoonPage('Merch')
    case 'promo': return comingSoonPage('Promo')
    case 'leaderboard': return comingSoonPage('Leaderboard')
    default: return homePage()
  }
}

export function bindPublicRoute(route) {
  if (route === 'register') {
    document.getElementById('registration-form')?.addEventListener('submit', handleRegistration)
  }

  if (route === 'schedule') {
    document.querySelectorAll('[data-week-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-week-filter]').forEach((item) => item.classList.remove('active'))
        button.classList.add('active')
        const filter = button.dataset.weekFilter
        document.querySelectorAll('[data-match-week]').forEach((card) => {
          card.style.display = filter === 'all' || card.dataset.matchWeek === filter ? '' : 'none'
        })
      })
    })
  }

  if (route === 'teams') {
    document.querySelectorAll('[data-team-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-team-filter]').forEach((item) => item.classList.remove('active'))
        button.classList.add('active')
        const filter = button.dataset.teamFilter
        document.querySelectorAll('[data-team-division]').forEach((card) => {
          card.style.display = filter === 'all' || card.dataset.teamDivision === filter ? '' : 'none'
        })
      })
    })
  }
}
