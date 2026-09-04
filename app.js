import { loadPublicData, state, supabase, toast } from './js/core.js'
import { bindPublicRoute, renderPublicRoute } from './js/public.js'
import { bindStaffPage, prepareStaffPage, renderStaffPage } from './js/staff.js'

const app = document.getElementById('app')
const nav = document.getElementById('main-nav')
const mobileMenu = document.getElementById('mobile-menu')

const publicRoutes = new Set([
  'home', 'qualifiers', 'majors', 'schedule', 'teams', 'standings',
  'featured', 'sponsors', 'champions', 'register', 'merch', 'promo', 'leaderboard',
])

function resolveRoute() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('page') === 'staff') return 'staff'
  const hash = window.location.hash.replace(/^#/, '').toLowerCase().trim()
  if (hash === 'staff') return 'staff'
  return publicRoutes.has(hash) ? hash : 'home'
}

function updateNavigation(route) {
  document.querySelectorAll('#main-nav a').forEach((link) => {
    const target = link.getAttribute('href')?.replace('#', '')
    link.classList.toggle('active', target === route)
  })
  nav?.classList.remove('open')
  mobileMenu?.setAttribute('aria-expanded', 'false')
}

async function renderRoute() {
  const route = resolveRoute()
  updateNavigation(route)

  if (route === 'staff') {
    app.innerHTML = '<section class="loading-screen"><div class="spinner"></div><p>Authenticating Staff Command...</p></section>'
    await prepareStaffPage()
    app.innerHTML = renderStaffPage()
    bindStaffPage()
  } else {
    app.innerHTML = renderPublicRoute(route)
    bindPublicRoute(route)
  }

  const register = document.getElementById('header-register')
  if (register) {
    register.textContent = state.site?.registration_open === false ? 'Registration Closed' : 'Register'
    register.classList.toggle('button-ghost', state.site?.registration_open === false)
    register.classList.toggle('button-gold', state.site?.registration_open !== false)
  }

  app.focus({ preventScroll: true })
  window.scrollTo({ top: 0, behavior: 'instant' })
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

window.addEventListener('hashchange', renderRoute)
window.addEventListener('popstate', renderRoute)

supabase.auth.onAuthStateChange((event) => {
  if (['SIGNED_IN', 'SIGNED_OUT', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event) && resolveRoute() === 'staff') {
    window.setTimeout(() => renderRoute().catch((error) => toast(error.message, 'error')), 0)
  }
})

bootstrap()
