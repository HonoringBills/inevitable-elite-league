import { state, supabase, toast } from './core.js'

function optionalReserve(fd, number) {
  const gamertag = String(fd.get(`p${number}_gamertag`) || '').trim()
  const activisionId = String(fd.get(`p${number}_activision`) || '').trim()
  if (!gamertag && !activisionId) return null
  if (!gamertag || !activisionId) throw new Error(`Reserve ${number - 4} needs both a gamertag and Activision ID, or leave both fields blank.`)
  return { gamertag, activision_id: activisionId, roster_role: 'substitute' }
}

async function submitRegistration(event) {
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
    if (players.some((player) => !player.gamertag || !player.activision_id)) throw new Error('All four starters need a gamertag and Activision ID.')

    const substitutes = [5, 6].map((number) => optionalReserve(fd, number)).filter(Boolean)

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
    })

    if (result.error) throw result.error
    form.reset()
    status.textContent = 'Submitted · Awaiting IEL staff review'
    toast('Team registration submitted for IEL staff review.', 'success')
  } catch (error) {
    console.error(error)
    status.textContent = error.message || 'Registration failed.'
    toast(error.message || 'Registration failed.', 'error')
  } finally {
    submit.disabled = false
  }
}

function makeReserveFieldsOptional(form) {
  for (const number of [5, 6]) {
    for (const suffix of ['gamertag', 'activision']) {
      const input = form.elements.namedItem(`p${number}_${suffix}`)
      if (input instanceof HTMLInputElement) input.required = false
    }
  }
  form.querySelectorAll('.player-row').forEach((row) => {
    if (!row.querySelector('input[name^="p5_"], input[name^="p6_"]')) return
    row.querySelectorAll('label').forEach((label) => {
      if (!label.textContent.includes('(optional)')) label.innerHTML += ' <small>(optional)</small>'
    })
  })
  const section = [...form.querySelectorAll('.form-section')].find((item) => item.querySelector('input[name="p5_gamertag"]'))
  if (section) {
    const title = section.querySelector('h3')
    const copy = section.querySelector('.section-copy')
    if (title) title.textContent = 'Team Roster'
    if (copy) copy.textContent = 'Four starters are required. Reserve 1 and Reserve 2 are optional and can be added later.'
  }
}

export function bindRegistration() {
  const form = document.getElementById('registration-form')
  if (!form) return
  makeReserveFieldsOptional(form)
  form.addEventListener('submit', submitRegistration)
}
