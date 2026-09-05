import { loadPublicData, state, supabase, toast } from './js/core.js'
import { bindPublicRoute, renderPublicRoute } from './js/public.js'
import { bindRegistration } from './js/registration.js'
import { bindStaffPage, prepareStaffPage, renderStaffPage } from './js/staff.js'
import { bindStatsPage, renderStatsPage } from './js/stats.js'
import { initStaffEnhancements } from './js/staff-enhancements.js?v=20260905-staff-stability-1'
import { initSeriesRosterMemory } from './js/series-roster-memory.js?v=20260905-staff-stability-1'
import { initApplyAllReview } from './js/apply-all-review.js?v=20260905-staff-stability-1'
import { initVerifyWithoutStats } from './js/verify-without-stats.js?v=20260905-staff-stability-1'
import { initDiscordTestMatchups } from './js/discord-test.js?v=20260905-discord-orchestrator-1'

const app = document.getElementById('app')
const nav = document.getElementById('main-nav')
const mobileMenu = document.getElementById('mobile-menu')

let renderInFlight = false
let renderRequested = false

const publicRoutes = new Set([
  'home', 'qualifiers', 'majors', 'schedule', 'teams', 'standings', 'stats',
  'featured', 'sponsors', 'champions', 'register', 'merch', 'promo', 'leaderboard',
])

function resolveRoute() {
  const hash = window.location.hash.replace(/^#/, '').toLowerCase().trim()

  // Explicit hash navigation always wins. This keeps normal site links working
  // after Discord OAuth returns through ?page=staff.
  if (hash === 'staff') return 'staff'
  if (publicRoutes.has(hash)) return hash

  // The query-string route exists only as an OAuth return fallback when there
  // is no explicit hash route yet.
  const params = new URLSearchParams(window.location.search)
  if (params.get('page') === 'staff') return 'staff'

  return 'home'
}

function updateNavigation(route) {
  document.querySelectorAll('#main-nav a').forEach((link) => {
    const target = link.getAttribute('href')?.replace('#', '')
    link.classList.toggle('active', target === route)
  })
  nav?.classList.remove('open')
  mobileMenu?.setAttribute('aria-expanded', 'false')
}

async function renderRouteOnce() {
  const route = resolveRoute()
  updateNavigation(route)

  if (route === 'staff') {
    app.innerHTML = '<section class="loading-screen"><div class="spinner"></div><p>Authenticating Staff Command...</p></section>'
    await prepareStaffPage()
    app.innerHTML = renderStaffPage()
    bindStaffPage()
    initStaffEnhancements()
    initSeriesRosterMemory()
    initApplyAllReview()
    initVerifyWithoutStats()
    initDiscordTestMatchups()
  } else if (route === 'stats') {
    app.innerHTML = renderStatsPage()
    await bindStatsPage()
  } else {
    app.innerHTML = renderPublicRoute(route)
    if (route === 'register') bindRegistration()
    else bindPublicRoute(route)
  }

  const register = document.getElementById('header-register')
  if (register) {
    register.textContent = state.site?.registration_open === false ? 'Registration Closed' : 'Register'
    register.classList.toggle('button-ghost', state.site?.registration_open === false)
    register.classList.toggle('button-gold', state.site?.registration_open !== false)
  }

  app.focus({ preventScroll: true })
  window.scrollTo({ top: 0, behavior: 'auto' })
}

async function renderRoute() {
  if (renderInFlight) {
    renderRequested = true
    return
  }

  renderInFlight = true
  try {
    do {
      renderRequested = false
      await renderRouteOnce()
    } while (renderRequested)
  } finally {
    renderInFlight = false
  }
}

function requestRouteRender() {
  renderRoute().catch((error) => {
    console.error('[IEL] route render failed', error)
    toast(error.message || 'IEL could not refresh this page.', 'error')
  })
}

async function bootstrap() {
  try {
    await loadPublicData()
    await renderRoute()
  } catch (error) {
    console.error('[IEL] bootstrap failed', error)
    app.innerHTML = `
      <section class="loading-screen">
        <div class="card gold" style="max-width:640px;text-align:center">
          <h3>IEL Command Connection Failed</h3>
          <p>The website loaded, but the league database did not respond. Refresh the page to try again.</p>
          <button class="button button-gold" type="button" onclick="location.reload()">Retry</button>
        </div>
      </section>`
  }
}

mobileMenu?.addEventListener('click', () => {
  const open = nav?.classList.toggle('open')
  mobileMenu.setAttribute('aria-expanded', String(Boolean(open)))
})

nav?.addEventListener('click', (event) => {
  if (event.target.closest('a')) {
    nav.classList.remove('open')
    mobileMenu?.setAttribute('aria-expanded', 'false')
  }
})

window.addEventListener('hashchange', requestRouteRender)
window.addEventListener('popstate', requestRouteRender)

supabase.auth.onAuthStateChange((event) => {
  // Token refreshes are normal background auth maintenance. Rebuilding the
  // entire Staff DOM for them caused UI churn and could collide with tab clicks.
  if (['SIGNED_IN', 'SIGNED_OUT', 'USER_UPDATED'].includes(event) && resolveRoute() === 'staff') {
    window.setTimeout(requestRouteRender, 0)
  }
})

bootstrap()
