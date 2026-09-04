import { toast } from './core.js'

let initialized = false
let applyingAll = false
let observer = null

function overlay() {
  return document.getElementById('iel-match-report-overlay')
}

function statusText(card) {
  const badge = card?.querySelector('.iel-ocr-map-info .badge')
  return String(badge?.textContent || '').trim().toLowerCase()
}

function mapNumber(card) {
  const kicker = String(card?.querySelector('.card-kicker')?.textContent || '')
  return Number(kicker.match(/map\s+(\d+)/i)?.[1] || 999)
}

function isAppliedCard(card) {
  return statusText(card) === 'applied'
}

function hideAppliedCards() {
  const root = overlay()
  if (!root) return

  const cards = [...root.querySelectorAll('[data-ocr-card]')]
  for (const card of cards) {
    if (isAppliedCard(card)) card.hidden = true
  }

  const queue = root.querySelector('.iel-ocr-queue')
  if (!queue) return
  queue.querySelector('[data-all-maps-applied]')?.remove()

  if (cards.length && cards.every((card) => card.hidden || isAppliedCard(card))) {
    const done = document.createElement('div')
    done.className = 'empty-state'
    done.dataset.allMapsApplied = 'true'
    done.innerHTML = '<strong>All reviewed maps applied.</strong><span>Successful maps are hidden from the active review queue.</span>'
    queue.appendChild(done)
  }
}

function readyApplyButtons(excludedIds = new Set()) {
  const root = overlay()
  if (!root) return []
  return [...root.querySelectorAll('button[data-ocr-action="apply"][data-item]')]
    .filter((button) => !button.disabled)
    .filter((button) => !excludedIds.has(String(button.dataset.item || '')))
    .filter((button) => !button.closest('[data-ocr-card]')?.hidden)
    .sort((a, b) => mapNumber(a.closest('[data-ocr-card]')) - mapNumber(b.closest('[data-ocr-card]')))
}

function decorateApplyAll() {
  const root = overlay()
  if (!root) return

  hideAppliedCards()

  const step = [...root.querySelectorAll('.iel-report-step')].find((element) =>
    String(element.querySelector('h3')?.textContent || '').includes('Staff Review + Apply'))
  const host = step?.querySelector('div:last-child') || step
  if (!host) return

  let button = root.querySelector('[data-apply-all-maps]')
  const count = readyApplyButtons().length

  if (!button) {
    button = document.createElement('button')
    button.type = 'button'
    button.className = 'button button-gold'
    button.dataset.applyAllMaps = 'true'
    button.style.marginLeft = '12px'
    host.appendChild(button)
  }

  button.disabled = applyingAll || count === 0
  button.textContent = applyingAll ? 'Applying Maps...' : `Apply All (${count})`
}

function waitForSettlement(itemId, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    let sawApplying = false

    const check = () => {
      const root = overlay()
      if (!root) return resolve({ ok: false, reason: 'closed' })
      const card = root.querySelector(`[data-ocr-card="${CSS.escape(itemId)}"]`)
      if (!card) return resolve({ ok: true, reason: 'removed' })

      const status = statusText(card)
      if (status === 'applying') sawApplying = true
      if (status === 'applied') return resolve({ ok: true, reason: 'applied' })

      const error = card.querySelector('.iel-ocr-alert.danger')
      if (sawApplying && status === 'staff review' && error) {
        return resolve({ ok: false, reason: String(error.textContent || 'Apply failed.').trim() })
      }

      if (Date.now() - startedAt >= timeoutMs) {
        return resolve({ ok: false, reason: 'Timed out waiting for IEL to apply the map.' })
      }
      window.setTimeout(check, 80)
    }

    check()
  })
}

async function applyAllMaps() {
  if (applyingAll) return
  const initial = readyApplyButtons()
  if (!initial.length) return toast('No fully reviewed maps are ready to apply.', 'error')

  applyingAll = true
  decorateApplyAll()
  const failed = new Set()
  let applied = 0

  try {
    while (true) {
      const next = readyApplyButtons(failed)[0]
      if (!next) break

      const itemId = String(next.dataset.item || '')
      next.click()
      const result = await waitForSettlement(itemId)
      if (result.ok) {
        applied += 1
        hideAppliedCards()
      } else {
        failed.add(itemId)
      }
      decorateApplyAll()
    }
  } finally {
    applyingAll = false
    decorateApplyAll()
  }

  if (failed.size) {
    toast(`${applied} map${applied === 1 ? '' : 's'} applied. ${failed.size} map${failed.size === 1 ? '' : 's'} still need review.`, 'error')
  } else {
    toast(`${applied} map${applied === 1 ? '' : 's'} applied successfully.`, 'success')
  }
}

function handleClick(event) {
  const button = event.target.closest('[data-apply-all-maps]')
  if (!button) return
  event.preventDefault()
  applyAllMaps().catch((error) => {
    applyingAll = false
    decorateApplyAll()
    toast(error.message || 'IEL could not apply all maps.', 'error')
  })
}

export function initApplyAllReview() {
  if (initialized) return
  initialized = true
  document.addEventListener('click', handleClick)
  observer = new MutationObserver(() => queueMicrotask(decorateApplyAll))
  observer.observe(document.body, { childList: true, subtree: true })
  decorateApplyAll()
}
