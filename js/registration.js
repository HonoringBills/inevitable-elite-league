import { state, supabase, toast } from './core.js'

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
      const upload = await supabase.storage.from('team-logos').upload(path, logo, {
        contentType: logo.type,
        upsert: false,
      })
      if (upload.error) throw upload.error
      logoUrl = supabase.storage.from('team-logos').getPublicUrl(path).data.publicUrl
    }

    status.textContent = 'Sending roster for staff review...'
    // Intentionally do NOT call .select() here. Anonymous users may INSERT
    // registrations but may not SELECT the private review queue under RLS.
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

export function bindRegistration() {
  document.getElementById('registration-form')?.addEventListener('submit', submitRegistration)
}
