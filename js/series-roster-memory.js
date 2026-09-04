let initialized = false
let applyingRememberedMapping = false
let activeOverlay = null
const seriesMappings = new Map()

function normalizeAlias(value) {
  return String(value || '')
    .replace(/ø/gi, 'o')
    .replace(/æ/gi, 'ae')
    .replace(/œ/gi, 'oe')
    .replace(/ß/gi, 'ss')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/^[0-9]+\s+/, '')
    .replace(/\$/g, 's')
    .replace(/@/g, 'a')
    .replace(/0/g, 'o')
    .replace(/5/g, 's')
    .replace(/3/g, 'e')
    .replace(/1/g, 'i')
    .replace(/[^a-z0-9]+/g, '')
}

function rawOcrName(select) {
  const first = select?.options?.[0]?.textContent || ''
  return String(first).replace(/^Unmatched:\s*/i, '').trim()
}

function isMissingPlaceholder(value) {
  return /(?:disconnected|missing player)/i.test(String(value || ''))
}

function optionTeam(option) {
  const text = String(option?.textContent || '')
  const parts = text.split(' · ')
  return parts.length > 1 ? parts[parts.length - 1].trim() : ''
}

function rowTeam(select) {
  if (select?.value) return optionTeam(select.selectedOptions?.[0])
  const small = select?.closest('.iel-ocr-player-select')?.querySelector('small')?.textContent?.trim() || ''
  return /^Read as:/i.test(small) ? '' : small
}

function reviewCard(select) {
  const card = select?.closest('[data-ocr-card]')
  if (!card?.querySelector('[data-ocr-action="apply"]')) return null
  return card
}

function targetAlreadyUsed(card, select, targetValue) {
  return [...card.querySelectorAll('select[data-player-field="playerId"]')]
    .some((candidate) => candidate !== select && candidate.value === targetValue)
}

function applyRememberedMappings() {
  if (applyingRememberedMapping) return
  const overlay = document.getElementById('iel-match-report-overlay')
  if (!overlay || overlay !== activeOverlay || !seriesMappings.size) return

  const selects = [...overlay.querySelectorAll('select[data-player-field="playerId"]')]
  for (const select of selects) {
    const raw = rawOcrName(select)
    if (!raw || isMissingPlaceholder(raw)) continue
    const mapping = seriesMappings.get(normalizeAlias(raw))
    if (!mapping || !mapping.playerId || select.value === mapping.playerId) continue

    const card = reviewCard(select)
    if (!card) continue

    const candidateTeam = rowTeam(select)
    if (candidateTeam && mapping.teamName && candidateTeam !== mapping.teamName) continue
    if (targetAlreadyUsed(card, select, mapping.playerId)) continue

    const option = [...select.options].find((entry) => entry.value === mapping.playerId)
    if (!option) continue

    select.value = mapping.playerId
    applyingRememberedMapping = true
    select.dispatchEvent(new Event('change', { bubbles: true }))
    applyingRememberedMapping = false

    // staff-enhancements re-renders the workspace after each player change.
    // Continue against the fresh DOM on the next microtask.
    queueMicrotask(applyRememberedMappings)
    return
  }
}

function rememberManualMapping(event) {
  if (applyingRememberedMapping) return
  const select = event.target
  if (!(select instanceof HTMLSelectElement) || select.dataset.playerField !== 'playerId') return
  if (!document.getElementById('iel-match-report-overlay')) return

  const raw = rawOcrName(select)
  if (!raw || isMissingPlaceholder(raw)) return
  const key = normalizeAlias(raw)
  if (!key) return

  if (!select.value) {
    seriesMappings.delete(key)
    return
  }

  const selectedOption = select.selectedOptions?.[0]
  seriesMappings.set(key, {
    playerId: select.value,
    teamName: optionTeam(selectedOption),
  })
  queueMicrotask(applyRememberedMappings)
}

function observeWorkspace() {
  const overlay = document.getElementById('iel-match-report-overlay')
  if (overlay && overlay !== activeOverlay) {
    activeOverlay = overlay
    seriesMappings.clear()
  } else if (!overlay && activeOverlay) {
    activeOverlay = null
    seriesMappings.clear()
  }

  if (overlay) queueMicrotask(applyRememberedMappings)
}

export function initSeriesRosterMemory() {
  if (initialized) return
  initialized = true

  // staff-enhancements registers its capture listener first. This listener runs
  // immediately after it, so the manual choice is stored while the original
  // select still carries the OCR-read name even though the UI is re-rendering.
  document.addEventListener('change', rememberManualMapping, true)
  new MutationObserver(observeWorkspace).observe(document.body, { childList: true, subtree: true })
  observeWorkspace()
}
