import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.115.0/+esm'

export const SUPABASE_URL = 'https://qbgmqakdxissnsjazjws.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_B0rOVxLsBbdB06KBtLO1aw_w_DN3UwI'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export const DIVISIONS = ['Entry', 'Elite', 'Masters']

export const state = {
  site: null,
  season: null,
  teams: [],
  rosters: [],
  matches: [],
  standings: [],
  featured: [],
  sponsors: [],
  claims: null,
  staff: null,
  registrations: [],
  uploads: [],
  staffFeatures: [],
  staffSponsors: [],
  publicLoaded: false,
  staffLoaded: false,
}

const fallbackSite = {
  league_name: 'Inevitable Elite League',
  league_short_name: 'IEL',
  logo_url: `${SUPABASE_URL}/storage/v1/object/public/site-assets/branding/iel-logo.png`,
  discord_url: 'https://discord.gg/vKPx4a23CF',
  hero_title: 'SEASON 1',
  hero_subtitle: 'FOUNDERS SEASON',
  registration_open: true,
}

function rows(result, label) {
  if (result.error) {
    console.warn(`[IEL] ${label}:`, result.error.message)
    return []
  }
  return result.data || []
}

export async function loadPublicData() {
  const [settings, season, teams, rosters, matches, standings, featured, sponsors] = await Promise.all([
    supabase.from('site_settings').select('*').order('id').limit(1).maybeSingle(),
    supabase.from('seasons').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('teams').select('*').eq('status', 'approved').order('division').order('team_name'),
    supabase.from('team_members').select('*').eq('is_active', true).order('roster_order'),
    supabase.from('public_matches').select('*').order('week').order('round_number').order('scheduled_at', { ascending: true, nullsFirst: false }),
    supabase.from('public_standings').select('*'),
    supabase.from('featured_players').select('*').eq('is_published', true).order('published_at', { ascending: false, nullsFirst: false }),
    supabase.from('sponsors').select('*').eq('is_active', true).order('sort_order').order('name'),
  ])

  state.site = settings.data || fallbackSite
  state.season = season.data || null
  state.teams = rows(teams, 'teams')
  state.rosters = rows(rosters, 'rosters')
  state.matches = rows(matches, 'matches')
  state.standings = rows(standings, 'standings')
  state.featured = rows(featured, 'featured players')
  state.sponsors = rows(sponsors, 'sponsors')
  state.publicLoaded = true

  applyGlobalBranding()
  return state
}

export async function refreshIdentity() {
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims?.sub) {
    state.claims = null
    state.staff = null
    state.staffLoaded = false
    return null
  }

  state.claims = data.claims
  const staffResult = await supabase
    .from('staff_members')
    .select('*')
    .eq('user_id', data.claims.sub)
    .eq('is_active', true)
    .maybeSingle()

  state.staff = staffResult.data || null
  if (!state.staff) state.staffLoaded = false
  return state.staff
}

export async function loadStaffData() {
  if (!state.staff) return null

  const [registrations, uploads, features, sponsors] = await Promise.all([
    supabase.from('team_registrations').select('*').order('created_at', { ascending: false }),
    supabase.from('scoreboard_uploads').select('*').order('created_at', { ascending: false }),
    supabase.from('featured_players').select('*').order('published_at', { ascending: false, nullsFirst: false }),
    supabase.from('sponsors').select('*').order('sort_order').order('name'),
  ])

  state.registrations = rows(registrations, 'registrations')
  state.uploads = rows(uploads, 'scoreboard uploads')
  state.staffFeatures = rows(features, 'staff features')
  state.staffSponsors = rows(sponsors, 'staff sponsors')
  state.staffLoaded = true
  return state
}

export function applyGlobalBranding() {
  const site = state.site || fallbackSite
  document.title = `${site.league_short_name || 'IEL'} · ${site.league_name || 'Inevitable Elite League'}`

  for (const id of ['brand-logo', 'footer-logo']) {
    const img = document.getElementById(id)
    if (img && site.logo_url) img.src = site.logo_url
  }

  const discord = document.getElementById('footer-discord')
  if (discord) discord.href = site.discord_url || '#'
}

export function esc(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function teamLogo(team, className = 'team-logo') {
  if (team?.logo_url) {
    return `<img class="${className}" src="${esc(team.logo_url)}" alt="${esc(team.team_name || 'Team')} logo" loading="lazy" />`
  }
  const initials = (team?.team_name || 'IEL').split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase()
  return `<span class="${className} placeholder">${esc(initials)}</span>`
}

export function formatDate(value, options = {}) {
  if (!value) return 'TBD'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'TBD'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...options,
  }).format(date)
}

export function statusBadge(status = '') {
  const normalized = String(status).toLowerCase()
  const tone = ['complete', 'approved', 'applied'].includes(normalized)
    ? 'success'
    : ['rejected', 'cancelled', 'failed'].includes(normalized)
      ? 'danger'
      : ['scheduled', 'review_required', 'pending_report'].includes(normalized)
        ? 'gold'
        : 'teal'
  return `<span class="badge ${tone}">${esc(status.replaceAll('_', ' '))}</span>`
}

let toastTimer
export function toast(message, type = '') {
  const el = document.getElementById('toast')
  if (!el) return
  window.clearTimeout(toastTimer)
  el.textContent = message
  el.className = `toast ${type} show`.trim()
  toastTimer = window.setTimeout(() => {
    el.className = 'toast'
  }, 4200)
}

export function teamById(id) {
  return state.teams.find((team) => team.id === id) || null
}

export function rosterForTeam(teamId, startersOnly = false) {
  return state.rosters
    .filter((member) => member.team_id === teamId && (!startersOnly || member.roster_role !== 'substitute'))
    .sort((a, b) => (a.roster_order ?? 99) - (b.roster_order ?? 99))
}

export function sortStandings(rowsToSort) {
  return [...rowsToSort].sort((a, b) =>
    (b.wins ?? 0) - (a.wins ?? 0) ||
    (b.map_diff ?? 0) - (a.map_diff ?? 0) ||
    (b.maps_won ?? 0) - (a.maps_won ?? 0) ||
    String(a.team_name).localeCompare(String(b.team_name))
  )
}

export async function signInDiscord() {
  const base = `${window.location.origin}${window.location.pathname}`
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: { redirectTo: `${base}?page=staff` },
  })
  if (error) toast(error.message, 'error')
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) {
    toast(error.message, 'error')
    return false
  }
  state.claims = null
  state.staff = null
  state.staffLoaded = false
  toast('Signed out.', 'success')
  return true
}
