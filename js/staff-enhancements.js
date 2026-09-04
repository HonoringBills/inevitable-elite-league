import { esc, loadPublicData, loadStaffData, state, supabase, toast } from './core.js'

let initialized = false
let observer = null
let reportState = null

function ocrApiBase() {
  const configured = String(state.site?.ocr_api_url || '').trim().replace(/\/$/, '')
  const host = window.location.hostname.toLowerCase()
  if (!host.endsWith('github.io') && !host.endsWith('chatgpt.site')) return window.location.origin
  return configured
}

function safeFileName(value) {
  return String(value || 'scoreboard.png').replace(/[^a-z0-9._-]+/gi, '-').slice(-90)
}

function confidenceLabel(value) {
  const number = Number(value)
  return Number.isFinite(number) ? `${Math.round(number * 100)}% confidence` : 'Confidence pending'
}

function intValue(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
}

function currentMatch(id) {
  return state.matches.find((match) => String(match.id) === String(id)) || null
}

function teamName(match, id) {
  if (String(id) === String(match.team_a_id)) return match.team_a_name
  if (String(id) === String(match.team_b_id)) return match.team_b_name
  return 'Unknown team'
}

function createQueueItem(file, mapNumber) {
  return {
    id: crypto.randomUUID(),
    file,
    mapNumber,
    previewUrl: URL.createObjectURL(file),
    status: 'ready',
    error: '',
    screenshotUrl: '',
    screenshotPath: '',
    uploadId: '',
    roster: [],
    extraction: null,
    perks: null,
    result: null,
  }
}

function cleanupReportState() {
  if (!reportState) return
  reportState.queue.forEach((item) => item.previewUrl && URL.revokeObjectURL(item.previewUrl))
  reportState = null
}

function statusText(status) {
  const labels = {
    ready: 'Ready',
    uploading: 'Uploading',
    analyzing: 'Qwen analyzing',
    review: 'Staff review',
    applying: 'Applying',
    applied: 'Applied',
    error: 'Needs attention',
  }
  return labels[status] || status
}

function perkBadge(enabled, team) {
  return enabled
    ? `<span class="badge gold">${esc(team)} · Stats Perk ON</span>`
    : `<span class="badge">${esc(team)} · Results only</span>`
}

function validateExtraction(item) {
  const extraction = item.extraction
  if (!extraction) return false
  const players = extraction.players || []
  const ids = players.map((player) => player.playerId).filter(Boolean)
  const unique = new Set(ids)
  const aCount = players.filter((player) => String(player.teamId) === String(reportState.match.team_a_id)).length
  const bCount = players.filter((player) => String(player.teamId) === String(reportState.match.team_b_id)).length
  extraction.canApply = players.length === 8 && ids.length === 8 && unique.size === 8 && aCount === 4 && bCount === 4
    && Boolean(String(extraction.mapName || '').trim())
    && ['Hardpoint', 'Search and Destroy', 'Overload'].includes(extraction.modeName)
    && Number(extraction.teamAScore) !== Number(extraction.teamBScore)
  return extraction.canApply
}

function playerReviewRows(item) {
  if (!item.extraction) return ''
  const matched = new Set((item.extraction.players || []).map((player) => player.playerId).filter(Boolean))
  return `
    <div class="iel-ocr-player-head"><span>Player</span><span>K</span><span>D</span><span>DMG</span><span>Hill</span><span>FB</span><span>Plants</span><span>Def</span><span>OL</span></div>
    ${(item.extraction.players || []).map((player, index) => `
      <div class="iel-ocr-player-row ${player.playerId ? 'matched' : 'unmatched'}">
        <label class="iel-ocr-player-select">
          <select data-ocr-item="${item.id}" data-player-index="${index}" data-player-field="playerId">
            <option value="">Unmatched: ${esc(player.extractedName || player.playerName || `Row ${index + 1}`)}</option>
            ${(item.roster || []).map((option) => `<option value="${option.playerId}" ${option.playerId === player.playerId ? 'selected' : ''} ${matched.has(option.playerId) && option.playerId !== player.playerId ? 'disabled' : ''}>${esc(option.displayName)} · ${esc(option.teamName)}</option>`).join('')}
          </select>
          <small>${esc(player.extractedName && player.extractedName !== player.playerName ? `Read as: ${player.extractedName}` : player.teamName || '')}</small>
        </label>
        ${[
          ['kills', 'K'], ['deaths', 'D'], ['damage', 'DMG'], ['hillTimeSeconds', 'Hill'], ['firstBloods', 'FB'], ['plants', 'Plants'], ['defuses', 'Def'], ['overloads', 'OL'],
        ].map(([field, label]) => `<label class="iel-ocr-stat"><span>${label}</span><input type="number" min="0" value="${intValue(player[field])}" data-ocr-item="${item.id}" data-player-index="${index}" data-player-field="${field}" /></label>`).join('')}
      </div>`).join('')}`
}

function queueCard(item) {
  const extraction = item.extraction
  const warnings = extraction?.warnings || []
  const canApply = validateExtraction(item)
  return `
    <article class="iel-ocr-map-card" data-ocr-card="${item.id}">
      <div class="iel-ocr-map-top">
        <div class="iel-ocr-preview"><img src="${item.previewUrl}" alt="Map ${item.mapNumber} scoreboard preview" /></div>
        <div class="iel-ocr-map-info">
          <div class="admin-toolbar" style="margin:0">
            <div><span class="card-kicker">Map ${item.mapNumber}</span><h3>${esc(item.file?.name || `Map ${item.mapNumber}`)}</h3></div>
            <span class="badge ${item.status === 'applied' ? 'success' : item.status === 'error' ? 'danger' : item.status === 'review' ? 'gold' : 'teal'}">${esc(statusText(item.status))}</span>
          </div>
          <p>${extraction ? confidenceLabel(extraction.confidence) : 'Waiting for Qwen vision extraction.'}</p>
          ${item.error ? `<div class="iel-ocr-alert danger">${esc(item.error)}</div>` : ''}
          ${warnings.length ? `<div class="iel-ocr-alert">${warnings.map((warning) => `<div>• ${esc(warning)}</div>`).join('')}</div>` : ''}
          <div class="admin-actions">
            ${['ready', 'error'].includes(item.status) ? `<button class="button button-teal compact" type="button" data-ocr-action="analyze" data-item="${item.id}">Analyze Map</button>` : ''}
            ${item.status !== 'applied' && !['uploading', 'analyzing', 'applying'].includes(item.status) ? `<button class="button button-danger compact" type="button" data-ocr-action="remove" data-item="${item.id}">Remove</button>` : ''}
          </div>
        </div>
      </div>
      ${extraction ? `
        <div class="iel-ocr-review">
          <div class="iel-ocr-map-fields">
            <label>Map Name<input value="${esc(extraction.mapName || '')}" data-ocr-item="${item.id}" data-map-field="mapName" /></label>
            <label>Mode<select data-ocr-item="${item.id}" data-map-field="modeName"><option value="">Choose Mode</option>${['Hardpoint','Search and Destroy','Overload'].map((mode) => `<option value="${mode}" ${mode === extraction.modeName ? 'selected' : ''}>${mode}</option>`).join('')}</select></label>
            <label>${esc(reportState.match.team_a_name)} Score<input type="number" min="0" value="${intValue(extraction.teamAScore)}" data-ocr-item="${item.id}" data-map-field="teamAScore" /></label>
            <label>${esc(reportState.match.team_b_name)} Score<input type="number" min="0" value="${intValue(extraction.teamBScore)}" data-ocr-item="${item.id}" data-map-field="teamBScore" /></label>
          </div>
          <div class="iel-ocr-player-review">${playerReviewRows(item)}</div>
          <div class="iel-ocr-applybar">
            <div>${item.perks ? `${perkBadge(item.perks.teamA, reportState.match.team_a_name)} ${perkBadge(item.perks.teamB, reportState.match.team_b_name)}` : ''}</div>
            ${item.status === 'review' ? `<button class="button button-gold" type="button" data-ocr-action="apply" data-item="${item.id}" ${canApply ? '' : 'disabled'}>Apply Map</button>` : ''}
            ${item.status === 'applied' ? `<span class="badge success">Map applied · ${item.result?.statsRowsWritten || 0} stat rows written</span>` : ''}
          </div>
        </div>` : ''}
    </article>`
}

function renderReportOverlay() {
  const overlay = document.getElementById('iel-match-report-overlay')
  if (!overlay || !reportState) return
  const match = reportState.match
  const winnerLocked = Boolean(reportState.declaredWinnerTeamId)
  const analyzable = reportState.queue.filter((item) => ['ready', 'error'].includes(item.status)).length
  const applied = reportState.queue.filter((item) => item.status === 'applied').length
  overlay.innerHTML = `
    <div class="iel-report-backdrop" data-ocr-action="close"></div>
    <section class="iel-report-workspace" role="dialog" aria-modal="true" aria-label="IEL Match Reporting">
      <header class="iel-report-header">
        <div>
          <p class="section-label">IEL Match Reporting · Qwen OCR</p>
          <h2>${esc(match.team_a_name)} <span>vs</span> ${esc(match.team_b_name)}</h2>
          <p>${esc(match.match_code)} · Week ${match.week} · Best of ${match.best_of || 5}</p>
        </div>
        <button class="button button-ghost compact" type="button" data-ocr-action="close">Close</button>
      </header>

      <div class="iel-report-body">
        <section class="iel-report-step gold">
          <span class="iel-step-number">01</span>
          <div>
            <h3>Declare the Series Winner</h3>
            <p>This is the Blacksite-style safety lock. If the OCR-applied maps calculate the other team as the winner, IEL will stop completion for Staff review.</p>
            <div class="admin-actions">
              <button class="button ${String(reportState.declaredWinnerTeamId) === String(match.team_a_id) ? 'button-gold' : 'button-ghost'}" type="button" data-ocr-action="winner" data-team="${match.team_a_id}">${esc(match.team_a_name)}</button>
              <button class="button ${String(reportState.declaredWinnerTeamId) === String(match.team_b_id) ? 'button-gold' : 'button-ghost'}" type="button" data-ocr-action="winner" data-team="${match.team_b_id}">${esc(match.team_b_name)}</button>
            </div>
          </div>
        </section>

        <section class="iel-report-step">
          <span class="iel-step-number">02</span>
          <div style="width:100%">
            <div class="admin-toolbar" style="margin:0 0 12px">
              <div><h3>Upload the Series Scoreboards</h3><p>Upload PNG, JPG or WEBP screenshots. IEL assigns them to open map slots, then Qwen extracts scores and player stats for Staff review.</p></div>
              <div class="admin-actions">
                <label class="button button-teal compact ${winnerLocked ? '' : 'disabled'}">Upload Scoreboards<input id="iel-ocr-files" type="file" accept="image/png,image/jpeg,image/webp" multiple ${winnerLocked ? '' : 'disabled'} hidden /></label>
                ${reportState.queue.length ? `<button class="button button-gold compact" type="button" data-ocr-action="analyze-all" ${analyzable && winnerLocked && !reportState.busy ? '' : 'disabled'}>${reportState.busy ? 'Analyzing...' : `Analyze All (${analyzable})`}</button>` : ''}
              </div>
            </div>
            ${!ocrApiBase() ? `<div class="iel-ocr-alert danger"><strong>OCR backend not connected yet.</strong> The UI is ready, but Staff must connect the Cloudflare Worker URL before Qwen analysis can run from the GitHub Pages test site.</div>` : ''}
            ${reportState.message ? `<div class="iel-ocr-alert ${reportState.messageType === 'error' ? 'danger' : reportState.messageType === 'success' ? 'success' : ''}">${esc(reportState.message)}</div>` : ''}
            <div class="iel-ocr-queue">${reportState.queue.length ? reportState.queue.map(queueCard).join('') : '<div class="empty-state"><strong>No scoreboards queued</strong><span>Choose the series winner, then upload the completed map screenshots.</span></div>'}</div>
          </div>
        </section>

        <section class="iel-report-step teal">
          <span class="iel-step-number">03</span>
          <div><h3>Staff Review + Apply</h3><p>Nothing is written until Staff applies each reviewed map. Match wins always count. Player stats are written only for teams whose Stats Perk Package is enabled.</p><span class="badge teal">${applied} map${applied === 1 ? '' : 's'} applied this session</span></div>
        </section>
      </div>
    </section>`

  overlay.querySelector('#iel-ocr-files')?.addEventListener('change', (event) => {
    addFiles(event.target.files)
    event.target.value = ''
  })
}

function openMatchReporter(matchId) {
  const match = currentMatch(matchId)
  if (!match) return toast('IEL could not find that match.', 'error')
  cleanupReportState()
  reportState = { match, declaredWinnerTeamId: '', queue: [], busy: false, message: '', messageType: '' }
  let overlay = document.getElementById('iel-match-report-overlay')
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'iel-match-report-overlay'
    document.body.appendChild(overlay)
  }
  document.body.classList.add('iel-report-open')
  renderReportOverlay()
}

function closeMatchReporter() {
  const hadApplied = Boolean(reportState?.queue.some((item) => item.status === 'applied'))
  cleanupReportState()
  document.body.classList.remove('iel-report-open')
  document.getElementById('iel-match-report-overlay')?.remove()
  if (hadApplied) window.location.reload()
}

function addFiles(fileList) {
  if (!reportState?.declaredWinnerTeamId) {
    reportState.message = 'Declare the series winner before uploading scoreboards.'
    reportState.messageType = 'error'
    renderReportOverlay()
    return
  }
  const files = [...(fileList || [])].filter((file) => ['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
  const maxMaps = Math.min(7, Number(reportState.match.best_of || 5))
  const used = new Set(reportState.queue.map((item) => Number(item.mapNumber)))
  const slots = Array.from({ length: maxMaps }, (_, index) => index + 1).filter((slot) => !used.has(slot))
  const additions = files.slice(0, slots.length).map((file, index) => createQueueItem(file, slots[index]))
  reportState.queue.push(...additions)
  reportState.message = additions.length ? `${additions.length} scoreboard${additions.length === 1 ? '' : 's'} queued.` : 'No valid PNG, JPG or WEBP images were added.'
  reportState.messageType = additions.length ? '' : 'error'
  renderReportOverlay()
}

async function apiRequest(path, payload) {
  const base = ocrApiBase()
  if (!base) throw new Error('Cloudflare OCR backend URL is not configured yet.')
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  const token = sessionData?.session?.access_token
  if (!token) throw new Error('Your Staff login expired. Sign in again.')
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `IEL OCR request failed (${response.status}).`)
  return data
}

async function analyzeItem(item, quiet = false) {
  if (!reportState?.declaredWinnerTeamId) return false
  const hasUpload = Boolean(item.screenshotUrl && item.screenshotPath)
  item.status = hasUpload ? 'analyzing' : 'uploading'
  item.error = ''
  if (!quiet) renderReportOverlay()

  try {
    if (!hasUpload) {
      const ext = String(item.file.name || 'scoreboard.png').split('.').pop()?.toLowerCase() || 'png'
      const path = `ocr/${state.season?.code || 'S1'}/${reportState.match.id}/map-${item.mapNumber}/${Date.now()}-${safeFileName(item.file.name || `scoreboard.${ext}`)}`
      const upload = await supabase.storage.from('scoreboards').upload(path, item.file, { contentType: item.file.type || 'image/png', cacheControl: '3600', upsert: false })
      if (upload.error) throw upload.error
      const publicUrl = supabase.storage.from('scoreboards').getPublicUrl(path).data.publicUrl
      if (!publicUrl) throw new Error('IEL could not create the scoreboard image URL.')
      item.screenshotPath = path
      item.screenshotUrl = publicUrl
    }

    item.status = 'analyzing'
    if (!quiet) renderReportOverlay()
    const result = await apiRequest('/api/staff/scoreboards/extract', {
      matchId: reportState.match.id,
      mapNumber: Number(item.mapNumber),
      screenshotUrl: item.screenshotUrl,
      screenshotPath: item.screenshotPath,
    })
    item.uploadId = result.uploadId
    item.roster = result.roster || []
    item.extraction = result.extraction || null
    item.perks = result.perks || null
    item.status = 'review'
    validateExtraction(item)
    return true
  } catch (error) {
    item.status = 'error'
    item.error = error.message
    return false
  } finally {
    if (!quiet) renderReportOverlay()
  }
}

async function analyzeAll() {
  const candidates = reportState.queue.filter((item) => ['ready', 'error'].includes(item.status))
  if (!candidates.length || reportState.busy) return
  reportState.busy = true
  reportState.message = `Analyzing ${candidates.length} scoreboard${candidates.length === 1 ? '' : 's'} with Qwen 3.8...`
  reportState.messageType = ''
  renderReportOverlay()
  let complete = 0
  let failed = 0
  for (const item of candidates) {
    // Sequential by design so a full series does not spike the vision worker.
    // eslint-disable-next-line no-await-in-loop
    if (await analyzeItem(item, true)) complete += 1
    else failed += 1
    renderReportOverlay()
  }
  reportState.busy = false
  reportState.message = failed ? `${complete} map${complete === 1 ? '' : 's'} ready for review; ${failed} need Retry OCR.` : `All ${complete} map${complete === 1 ? '' : 's'} are ready for Staff review.`
  reportState.messageType = failed ? 'error' : 'success'
  renderReportOverlay()
}

async function applyItem(item) {
  if (!item.extraction || !item.uploadId || !validateExtraction(item)) {
    item.error = 'Correct all map fields and match all eight players before applying.'
    renderReportOverlay()
    return
  }
  item.status = 'applying'
  item.error = ''
  renderReportOverlay()
  try {
    const result = await apiRequest('/api/staff/scoreboards/commit', {
      matchId: reportState.match.id,
      mapNumber: Number(item.mapNumber),
      uploadId: item.uploadId,
      declaredWinnerTeamId: reportState.declaredWinnerTeamId,
      extraction: item.extraction,
    })
    item.status = 'applied'
    item.result = result
    const score = `${reportState.match.team_a_name} ${result.teamAWins} — ${result.teamBWins} ${reportState.match.team_b_name}`
    if (result.winnerMismatch) {
      reportState.message = `SAFETY STOP: applied maps calculate ${teamName(reportState.match, result.actualWinnerTeamId)} as series winner, but Staff declared ${teamName(reportState.match, reportState.declaredWinnerTeamId)}. Review map orientation before completion. Current series: ${score}.`
      reportState.messageType = 'error'
    } else if (result.complete) {
      reportState.message = `${score}. Match complete. ${result.statsRowsWritten} player stat rows were written from this map based on Stats Perk eligibility.`
      reportState.messageType = 'success'
    } else {
      reportState.message = `${score}. Map applied. ${result.statsRowsWritten} player stat rows were written from this map based on Stats Perk eligibility.`
      reportState.messageType = 'success'
    }
  } catch (error) {
    item.status = 'review'
    item.error = error.message
    reportState.message = error.message
    reportState.messageType = 'error'
  }
  renderReportOverlay()
}

function removeItem(id) {
  const item = reportState.queue.find((entry) => entry.id === id)
  if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl)
  reportState.queue = reportState.queue.filter((entry) => entry.id !== id)
  renderReportOverlay()
}

function updatePlayerField(element) {
  const item = reportState.queue.find((entry) => entry.id === element.dataset.ocrItem)
  if (!item?.extraction) return
  const index = Number(element.dataset.playerIndex)
  const field = element.dataset.playerField
  const player = { ...(item.extraction.players[index] || {}) }
  if (field === 'playerId') {
    const match = item.roster.find((option) => option.playerId === element.value)
    player.playerId = element.value
    if (match) {
      player.playerName = match.displayName
      player.teamId = match.teamId
      player.teamName = match.teamName
    }
  } else {
    player[field] = intValue(element.value)
  }
  item.extraction.players[index] = player
  validateExtraction(item)
  renderReportOverlay()
}

function updateMapField(element) {
  const item = reportState.queue.find((entry) => entry.id === element.dataset.ocrItem)
  if (!item?.extraction) return
  const field = element.dataset.mapField
  item.extraction[field] = ['teamAScore', 'teamBScore'].includes(field) ? intValue(element.value) : element.value
  validateExtraction(item)
  renderReportOverlay()
}

async function toggleStatsPerk(teamId) {
  const team = state.teams.find((row) => String(row.id) === String(teamId))
  if (!team) return
  const next = !team.stats_perk_enabled
  const result = await supabase.from('teams').update({ stats_perk_enabled: next }).eq('id', team.id)
  if (result.error) return toast(result.error.message, 'error')
  team.stats_perk_enabled = next
  toast(`${team.team_name}: Stats Perk ${next ? 'enabled' : 'disabled'}.`, 'success')
  decorateStaff()
}

async function saveOcrApi() {
  const input = document.getElementById('iel-ocr-api-url')
  if (!input) return
  const value = String(input.value || '').trim().replace(/\/$/, '')
  if (value) {
    try {
      const url = new URL(value)
      if (url.protocol !== 'https:') throw new Error('HTTPS required')
    } catch {
      return toast('Enter a valid HTTPS Cloudflare Worker URL.', 'error')
    }
  }
  const id = state.site?.id || 1
  const result = await supabase.from('site_settings').update({ ocr_api_url: value || null }).eq('id', id)
  if (result.error) return toast(result.error.message, 'error')
  state.site.ocr_api_url = value || null
  toast(value ? 'IEL OCR backend URL saved.' : 'IEL OCR backend URL cleared.', 'success')
}

function decorateTeams() {
  document.querySelectorAll('[data-staff-action="set-seed"]').forEach((seedButton) => {
    const team = state.teams.find((row) => String(row.id) === String(seedButton.dataset.id))
    const cell = seedButton.closest('td')
    if (!team || !cell || cell.querySelector('[data-staff-action="toggle-stats-perk"]')) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `button compact ${team.stats_perk_enabled ? 'button-gold' : 'button-ghost'}`
    button.dataset.staffAction = 'toggle-stats-perk'
    button.dataset.id = team.id
    button.textContent = team.stats_perk_enabled ? 'Stats Perk: ON' : 'Enable Stats Perk'
    button.style.marginLeft = '8px'
    cell.appendChild(button)
  })
}

function decorateSettings() {
  const form = document.getElementById('site-settings-form')
  if (!form || document.getElementById('iel-ocr-api-card')) return
  const card = document.createElement('div')
  card.id = 'iel-ocr-api-card'
  card.className = 'card teal'
  card.style.marginTop = '22px'
  card.innerHTML = `
    <span class="card-kicker">Match Reporting Backend</span>
    <h3>Cloudflare Qwen OCR</h3>
    <p>On the final Cloudflare domain, Match Reporting uses the same origin automatically. While testing on GitHub Pages, save the temporary workers.dev URL here.</p>
    <div class="field" style="margin-top:16px"><label>OCR API URL</label><input id="iel-ocr-api-url" type="url" placeholder="https://inevitable-elite-league.YOURSUBDOMAIN.workers.dev" value="${esc(state.site?.ocr_api_url || '')}" /></div>
    <div class="form-actions"><button class="button button-teal" type="button" data-staff-action="save-ocr-api">Save OCR Endpoint</button></div>`
  form.insertAdjacentElement('afterend', card)
}

function decorateStaff() {
  const scoreboardTab = document.querySelector('[data-staff-tab="scoreboards"]')
  if (scoreboardTab) scoreboardTab.style.display = 'none'
  decorateTeams()
  decorateSettings()

  const heading = document.querySelector('.page-heading .section-copy')
  if (heading && heading.textContent.includes('scoreboard review')) {
    heading.textContent = 'Registration review, approved rosters, qualifier scheduling, integrated Qwen match reporting and public content management.'
  }
}

function captureClick(event) {
  const target = event.target.closest('[data-staff-action], [data-ocr-action]')
  if (!target) return

  if (target.dataset.staffAction === 'report-match') {
    event.preventDefault()
    event.stopImmediatePropagation()
    openMatchReporter(target.dataset.id)
    return
  }
  if (target.dataset.staffAction === 'toggle-stats-perk') {
    event.preventDefault()
    event.stopImmediatePropagation()
    toggleStatsPerk(target.dataset.id).catch((error) => toast(error.message, 'error'))
    return
  }
  if (target.dataset.staffAction === 'save-ocr-api') {
    event.preventDefault()
    event.stopImmediatePropagation()
    saveOcrApi().catch((error) => toast(error.message, 'error'))
    return
  }

  const action = target.dataset.ocrAction
  if (!action || !reportState) return
  event.preventDefault()
  event.stopImmediatePropagation()
  if (action === 'close') return closeMatchReporter()
  if (action === 'winner') {
    reportState.declaredWinnerTeamId = target.dataset.team
    reportState.message = `${teamName(reportState.match, target.dataset.team)} locked as the declared series winner.`
    reportState.messageType = 'success'
    return renderReportOverlay()
  }
  const item = reportState.queue.find((entry) => entry.id === target.dataset.item)
  if (action === 'remove' && item) return removeItem(item.id)
  if (action === 'analyze' && item) return analyzeItem(item).catch((error) => toast(error.message, 'error'))
  if (action === 'analyze-all') return analyzeAll().catch((error) => toast(error.message, 'error'))
  if (action === 'apply' && item) return applyItem(item).catch((error) => toast(error.message, 'error'))
}

function captureChange(event) {
  const element = event.target
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement)) return
  if (element.dataset.playerField) updatePlayerField(element)
  else if (element.dataset.mapField) updateMapField(element)
}

export function initStaffEnhancements() {
  if (!initialized) {
    initialized = true
    document.addEventListener('click', captureClick, true)
    document.addEventListener('change', captureChange, true)
    observer = new MutationObserver(() => decorateStaff())
    observer.observe(document.getElementById('app'), { childList: true, subtree: true })
  }
  decorateStaff()
}

export async function refreshStaffEnhancementData() {
  await Promise.all([loadPublicData(), loadStaffData()])
  decorateStaff()
}
