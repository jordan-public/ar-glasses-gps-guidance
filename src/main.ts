import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

declare global {
  interface Window {
    google?: GoogleMapsApi
    initGoogleMaps?: () => void
  }
}

type LatLngLiteral = {
  lat: number
  lng: number
}

type GoogleMapsApi = {
  maps: {
    DirectionsService: new () => DirectionsService
    DirectionsStatus: {
      OK: string
    }
    TravelMode: Record<TravelMode, string>
    UnitSystem: {
      IMPERIAL: number
    }
  }
}

type DirectionsService = {
  route: (request: DirectionsRequest, callback: (result: DirectionsResult | null, status: string) => void) => void
}

type DirectionsRequest = {
  origin: LatLngLiteral | string
  destination: string
  travelMode: string
  unitSystem: number
}

type DirectionsResult = {
  routes: Array<{
    summary: string
    legs: DirectionsLeg[]
  }>
}

type DirectionsLeg = {
  distance?: DirectionsValue
  duration?: DirectionsValue
  end_address?: string
  steps: DirectionsStep[]
}

type DirectionsStep = {
  distance?: DirectionsValue
  duration?: DirectionsValue
  end_location?: GoogleLatLng
  instructions: string
  maneuver?: string
}

type DirectionsValue = {
  text: string
  value: number
}

type GoogleLatLng = {
  lat: () => number
  lng: () => number
}

type Maneuver = 'START' | 'LEFT' | 'RIGHT' | 'STRAIGHT' | 'SLIGHT_LEFT' | 'SLIGHT_RIGHT' | 'UTURN' | 'ARRIVE'

type TravelMode = 'DRIVING' | 'WALKING' | 'BICYCLING' | 'TRANSIT'

type RouteStep = {
  maneuver: Maneuver
  instruction: string
  street: string
  distanceMeters: number
  etaSeconds: number
  endLocation?: LatLngLiteral
}

type ContainerId = keyof typeof containers

const apiKeyStorageKey = 'gmaps-api-key'
const destinationStorageKey = 'gmaps-destination'
const travelModeStorageKey = 'gmaps-travel-mode'
const rerouteMinDistanceMeters = 35
const autoAdvanceDistanceMeters = 28

const demoRouteName = 'Demo route'
const demoRoute: RouteStep[] = [
  {
    maneuver: 'START',
    instruction: 'Enter a Google Maps key and destination',
    street: 'Companion setup',
    distanceMeters: 0,
    etaSeconds: 0,
  },
  {
    maneuver: 'STRAIGHT',
    instruction: 'Tap Start Guidance',
    street: 'Live route will appear here',
    distanceMeters: 0,
    etaSeconds: 0,
  },
]

const containers = {
  header: { id: 1, name: 'navHeader' },
  maneuver: { id: 2, name: 'navTurn' },
  detail: { id: 3, name: 'navDetail' },
  progress: { id: 4, name: 'navProgress' },
  footer: { id: 5, name: 'navFooter' },
} as const

let routeName = demoRouteName
let route = demoRoute
let currentStepIndex = 0
let isMuted = false
let isRouting = false
let isLiveGuidance = false
let statusMessage = 'Ready'
let currentPosition: LatLngLiteral | null = null
let lastReroutePosition: LatLngLiteral | null = null
let watchId: number | null = null
let directionsService: DirectionsService | null = null

const bridge = await waitForEvenAppBridge()

const textContainers = [
  makeTextContainer('header', 0, 0, 576, 42, 0, 0),
  makeTextContainer('maneuver', 0, 42, 576, 94, 1, 0),
  makeTextContainer('detail', 0, 136, 576, 70, 1, 0),
  makeTextContainer('progress', 0, 206, 576, 42, 0, 0),
  makeTextContainer('footer', 0, 248, 576, 40, 0, 1),
]

const result = await bridge.createStartUpPageContainer(
  new CreateStartUpPageContainer({
    containerTotalNum: textContainers.length,
    textObject: textContainers,
  }),
)

console.log('Navigation page created:', result === 0 ? 'success' : `failed (${result})`)

await renderGlasses()
renderCompanion()

const savedKey = window.localStorage.getItem(apiKeyStorageKey)
const savedDestination = window.localStorage.getItem(destinationStorageKey)

if (savedKey && savedDestination) {
  statusMessage = 'Saved Google Maps setup found'
  renderCompanion()
}

// Event routing, critical details:
//   - Protobuf omits zero-value fields on the wire, so CLICK_EVENT (0)
//     may arrive as undefined. Coalesce event types with ?? 0 before comparing.
//   - Scroll gestures come through event.textEvent; taps and lifecycle events
//     usually come through event.sysEvent.
//   - Double-tap must always exit, regardless of which envelope carries it.
const unsubscribe = bridge.onEvenHubEvent(event => {
  const sysType = event.sysEvent ? event.sysEvent.eventType ?? OsEventTypeList.CLICK_EVENT : null
  const textType = event.textEvent ? event.textEvent.eventType ?? OsEventTypeList.CLICK_EVENT : null

  if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
    stopPositionWatch()
    bridge.shutDownPageContainer(1)
    return
  }

  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
    stopPositionWatch()
    unsubscribe()
    return
  }

  if (textType === OsEventTypeList.SCROLL_TOP_EVENT) {
    previousStep()
    return
  }

  if (textType === OsEventTypeList.SCROLL_BOTTOM_EVENT || sysType === OsEventTypeList.CLICK_EVENT) {
    nextStep()
  }
})

function makeTextContainer(
  key: ContainerId,
  xPosition: number,
  yPosition: number,
  width: number,
  height: number,
  borderWidth: number,
  isEventCapture: number,
) {
  return new TextContainerProperty({
    xPosition,
    yPosition,
    width,
    height,
    borderWidth,
    borderColor: 5,
    borderRadius: 4,
    paddingLength: 6,
    containerID: containers[key].id,
    containerName: containers[key].name,
    content: '',
    isEventCapture,
  })
}

async function renderGlasses() {
  const step = route[currentStepIndex] ?? demoRoute[0]
  const remainingMeters = route.slice(currentStepIndex).reduce((sum, item) => sum + item.distanceMeters, 0)
  const remainingSeconds = route.slice(currentStepIndex).reduce((sum, item) => sum + item.etaSeconds, 0)
  const progress = `${currentStepIndex + 1}/${route.length} ${progressBar(currentStepIndex, route.length)}`
  const soundState = isMuted ? 'Muted' : 'Guidance on'
  const liveState = isLiveGuidance ? 'Live GPS' : statusMessage

  await Promise.all([
    updateText('header', `${routeName}\n${formatDistance(remainingMeters)} left | ${formatDuration(remainingSeconds)}`),
    updateText('maneuver', `${maneuverLabel(step.maneuver)}\n${formatDistance(step.distanceMeters)}`),
    updateText('detail', `${step.instruction}\n${step.street}`),
    updateText('progress', progress),
    updateText('footer', `${liveState} | ${soundState} | Tap next | Double-tap exit`),
  ])
}

async function updateText(key: ContainerId, content: string) {
  const container = containers[key]

  return bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: container.id,
      containerName: container.name,
      contentOffset: 0,
      contentLength: content.length,
      content,
    }),
  )
}

function nextStep() {
  currentStepIndex = Math.min(currentStepIndex + 1, route.length - 1)
  void renderGlasses()
  renderCompanion()
}

function previousStep() {
  currentStepIndex = Math.max(currentStepIndex - 1, 0)
  void renderGlasses()
  renderCompanion()
}

function toggleMute() {
  isMuted = !isMuted
  void renderGlasses()
  renderCompanion()
}

async function startGuidance(form: HTMLFormElement) {
  const formData = new FormData(form)
  const apiKey = String(formData.get('apiKey') ?? '').trim()
  const destination = String(formData.get('destination') ?? '').trim()
  const travelMode = normalizeTravelMode(String(formData.get('travelMode') ?? 'WALKING'))

  if (!apiKey || !destination) {
    statusMessage = 'Add a Google Maps API key and destination'
    renderCompanion()
    await renderGlasses()
    return
  }

  window.localStorage.setItem(apiKeyStorageKey, apiKey)
  window.localStorage.setItem(destinationStorageKey, destination)
  window.localStorage.setItem(travelModeStorageKey, travelMode)

  await requestFreshRoute(destination, travelMode, true)
}

async function requestFreshRoute(destination: string, travelMode: TravelMode, shouldStartWatch: boolean) {
  isRouting = true
  statusMessage = 'Finding your location...'
  renderCompanion()
  await renderGlasses()

  try {
    await loadGoogleMaps(window.localStorage.getItem(apiKeyStorageKey) ?? '')
    const origin = await getCurrentPosition()
    currentPosition = origin
    statusMessage = 'Loading Google route...'
    renderCompanion()
    await renderGlasses()

    const directions = await getDirections(origin, destination, travelMode)
    applyDirections(directions, destination)
    lastReroutePosition = origin
    isLiveGuidance = true
    statusMessage = 'Live guidance running'

    if (shouldStartWatch) startPositionWatch(destination, travelMode)
  } catch (error) {
    isLiveGuidance = false
    statusMessage = error instanceof Error ? error.message : 'Could not start guidance'
  } finally {
    isRouting = false
    renderCompanion()
    await renderGlasses()
  }
}

function loadGoogleMaps(apiKey: string) {
  if (window.google?.maps) return Promise.resolve()
  if (!apiKey) return Promise.reject(new Error('Missing Google Maps API key'))

  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-maps-loader]')

    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error('Google Maps failed to load')), { once: true })
      return
    }

    window.initGoogleMaps = () => resolve()

    const script = document.createElement('script')
    script.dataset.googleMapsLoader = 'true'
    script.async = true
    script.defer = true
    script.onerror = () => reject(new Error('Google Maps failed to load'))
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&callback=initGoogleMaps`
    document.head.append(script)
  })
}

function getCurrentPosition() {
  return new Promise<LatLngLiteral>((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Location is not available in this WebView'))
      return
    }

    navigator.geolocation.getCurrentPosition(
      position => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        })
      },
      error => reject(new Error(describeGeolocationError(error))),
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 5000,
      },
    )
  })
}

function describeGeolocationError(error: GeolocationPositionError) {
  const secureContextHint = window.isSecureContext
    ? ''
    : ' The WebView is not in a secure context; try an HTTPS dev URL or a packaged build.'

  switch (error.code) {
    case error.PERMISSION_DENIED:
      return `Location was denied by the WebView. Confirm this app requests the Even Hub location permission and relaunch it.${secureContextHint}`
    case error.POSITION_UNAVAILABLE:
      return `Location is currently unavailable from the phone.${secureContextHint}`
    case error.TIMEOUT:
      return `Timed out waiting for phone location. Try again outdoors or after the GPS settles.${secureContextHint}`
    default:
      return `Could not read phone location.${secureContextHint}`
  }
}

function getDirections(origin: LatLngLiteral, destination: string, travelMode: TravelMode) {
  return new Promise<DirectionsResult>((resolve, reject) => {
    if (!window.google?.maps) {
      reject(new Error('Google Maps is not ready'))
      return
    }

    directionsService ??= new window.google.maps.DirectionsService()

    directionsService.route(
      {
        origin,
        destination,
        travelMode: window.google.maps.TravelMode[travelMode],
        unitSystem: window.google.maps.UnitSystem.IMPERIAL,
      },
      (result, status) => {
        if (status === window.google?.maps.DirectionsStatus.OK && result) {
          resolve(result)
          return
        }

        reject(new Error(`Google Maps route failed: ${status}`))
      },
    )
  })
}

function applyDirections(directions: DirectionsResult, fallbackDestination: string) {
  const routeResult = directions.routes[0]
  const leg = routeResult?.legs[0]

  if (!leg || leg.steps.length === 0) {
    throw new Error('Google Maps returned no route steps')
  }

  routeName = leg.end_address ? `To ${leg.end_address}` : `To ${fallbackDestination}`
  route = [
    {
      maneuver: 'START',
      instruction: `Start toward ${routeResult.summary || fallbackDestination}`,
      street: `${leg.distance?.text ?? ''} | ${leg.duration?.text ?? ''}`.trim(),
      distanceMeters: 0,
      etaSeconds: 0,
      endLocation: currentPosition ?? undefined,
    },
    ...leg.steps.map(toRouteStep),
    {
      maneuver: 'ARRIVE',
      instruction: 'Arrive at destination',
      street: leg.end_address ?? fallbackDestination,
      distanceMeters: 0,
      etaSeconds: 0,
      endLocation: leg.steps.at(-1)?.end_location ? toLatLngLiteral(leg.steps.at(-1)?.end_location) : undefined,
    },
  ]
  currentStepIndex = 0
}

function toRouteStep(step: DirectionsStep): RouteStep {
  const instruction = stripHtml(step.instructions)

  return {
    maneuver: mapGoogleManeuver(step.maneuver, instruction),
    instruction,
    street: step.duration?.text ? `ETA ${step.duration.text}` : 'Next instruction',
    distanceMeters: step.distance?.value ?? 0,
    etaSeconds: step.duration?.value ?? 0,
    endLocation: step.end_location ? toLatLngLiteral(step.end_location) : undefined,
  }
}

function startPositionWatch(destination: string, travelMode: TravelMode) {
  stopPositionWatch()

  if (!navigator.geolocation) {
    statusMessage = 'Location watch unavailable'
    return
  }

  watchId = navigator.geolocation.watchPosition(
    position => {
      const nextPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      }

      currentPosition = nextPosition
      maybeAdvanceFromPosition(nextPosition)
      void maybeReroute(nextPosition, destination, travelMode)
    },
    () => {
      statusMessage = 'Waiting for location updates'
      renderCompanion()
      void renderGlasses()
    },
    {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 20000,
    },
  )
}

function stopPositionWatch() {
  if (watchId === null) return

  navigator.geolocation.clearWatch(watchId)
  watchId = null
}

function maybeAdvanceFromPosition(position: LatLngLiteral) {
  const step = route[currentStepIndex]

  if (!step?.endLocation || currentStepIndex >= route.length - 1) return

  const distanceToStepEnd = distanceBetweenMeters(position, step.endLocation)

  if (distanceToStepEnd <= autoAdvanceDistanceMeters) {
    currentStepIndex = Math.min(currentStepIndex + 1, route.length - 1)
    void renderGlasses()
    renderCompanion()
  }
}

async function maybeReroute(position: LatLngLiteral, destination: string, travelMode: TravelMode) {
  if (isRouting || !lastReroutePosition) return

  const movedMeters = distanceBetweenMeters(position, lastReroutePosition)

  if (movedMeters < rerouteMinDistanceMeters) return

  await requestFreshRoute(destination, travelMode, false)
}

function distanceBetweenMeters(first: LatLngLiteral, second: LatLngLiteral) {
  const earthRadiusMeters = 6371000
  const firstLat = toRadians(first.lat)
  const secondLat = toRadians(second.lat)
  const latDelta = toRadians(second.lat - first.lat)
  const lngDelta = toRadians(second.lng - first.lng)
  const a =
    Math.sin(latDelta / 2) * Math.sin(latDelta / 2) +
    Math.cos(firstLat) * Math.cos(secondLat) * Math.sin(lngDelta / 2) * Math.sin(lngDelta / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return earthRadiusMeters * c
}

function toRadians(value: number) {
  return (value * Math.PI) / 180
}

function toLatLngLiteral(location?: GoogleLatLng): LatLngLiteral | undefined {
  if (!location) return undefined

  return {
    lat: location.lat(),
    lng: location.lng(),
  }
}

function normalizeTravelMode(value: string): TravelMode {
  if (value === 'DRIVING' || value === 'BICYCLING' || value === 'TRANSIT') return value

  return 'WALKING'
}

function stripHtml(value: string) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(value, 'text/html')

  return doc.body.textContent?.replace(/\s+/g, ' ').trim() || 'Continue'
}

function mapGoogleManeuver(maneuver = '', instruction: string): Maneuver {
  if (maneuver.includes('left')) return maneuver.includes('slight') ? 'SLIGHT_LEFT' : 'LEFT'
  if (maneuver.includes('right')) return maneuver.includes('slight') ? 'SLIGHT_RIGHT' : 'RIGHT'
  if (maneuver.includes('uturn')) return 'UTURN'
  if (/arrive/i.test(instruction)) return 'ARRIVE'

  return 'STRAIGHT'
}

function formatDistance(meters: number) {
  if (meters <= 0) return '0 ft'
  const feet = Math.round(meters * 3.28084)

  if (feet < 1000) return `${roundToNearest(feet, 10)} ft`

  return `${(feet / 5280).toFixed(1)} mi`
}

function formatDuration(seconds: number) {
  if (seconds <= 0) return '0 min'

  return `${Math.max(1, Math.round(seconds / 60))} min`
}

function roundToNearest(value: number, nearest: number) {
  return Math.round(value / nearest) * nearest
}

function maneuverLabel(maneuver: Maneuver) {
  switch (maneuver) {
    case 'START':
      return 'START'
    case 'LEFT':
      return '< TURN LEFT'
    case 'RIGHT':
      return 'TURN RIGHT >'
    case 'SLIGHT_LEFT':
      return '< VEER LEFT'
    case 'SLIGHT_RIGHT':
      return 'VEER RIGHT >'
    case 'UTURN':
      return 'U-TURN'
    case 'STRAIGHT':
      return 'CONTINUE'
    case 'ARRIVE':
      return 'ARRIVE'
  }
}

function progressBar(index: number, total: number) {
  const width = 18
  const filled = Math.round(((index + 1) / total) * width)

  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`
}

function renderCompanion() {
  const app = document.querySelector<HTMLDivElement>('#app')
  if (!app) return

  const step = route[currentStepIndex] ?? demoRoute[0]
  const apiKey = window.localStorage.getItem(apiKeyStorageKey) ?? ''
  const destination = window.localStorage.getItem(destinationStorageKey) ?? ''
  const travelMode = normalizeTravelMode(window.localStorage.getItem(travelModeStorageKey) ?? 'WALKING')

  app.innerHTML = `
    <main class="shell">
      <section class="status">
        <p class="eyebrow">Google Maps guidance</p>
        <h1>${escapeHtml(maneuverLabel(step.maneuver))}</h1>
        <p class="distance">${escapeHtml(formatDistance(step.distanceMeters))}</p>
        <p class="instruction">${escapeHtml(step.instruction)}</p>
        <p class="street">${escapeHtml(step.street)}</p>
        <div class="meter" aria-label="Route progress">
          <span style="width: ${((currentStepIndex + 1) / route.length) * 100}%"></span>
        </div>
        <p class="meta">Step ${currentStepIndex + 1} of ${route.length} | ${escapeHtml(statusMessage)}</p>
      </section>

      <form class="route-form" id="route-form">
        <label>
          <span>Google Maps API key</span>
          <input name="apiKey" type="password" autocomplete="off" value="${escapeAttribute(apiKey)}" placeholder="Browser key with Maps JS + Directions" />
        </label>
        <label>
          <span>Destination</span>
          <input name="destination" value="${escapeAttribute(destination)}" placeholder="Coffee, address, or place name" />
        </label>
        <label>
          <span>Mode</span>
          <select name="travelMode">
            ${travelModeOption('WALKING', travelMode)}
            ${travelModeOption('DRIVING', travelMode)}
            ${travelModeOption('BICYCLING', travelMode)}
            ${travelModeOption('TRANSIT', travelMode)}
          </select>
        </label>
        <button class="primary" type="submit">${isRouting ? 'Loading...' : 'Start Guidance'}</button>
      </form>

      <section class="controls" aria-label="Navigation controls">
        <button id="previous" type="button">Previous</button>
        <button id="mute" type="button">${isMuted ? 'Unmute' : 'Mute'}</button>
        <button id="next" type="button">Next</button>
      </section>
    </main>
  `

  document.querySelector<HTMLFormElement>('#route-form')?.addEventListener('submit', event => {
    event.preventDefault()
    void startGuidance(event.currentTarget as HTMLFormElement)
  })
  document.querySelector<HTMLButtonElement>('#previous')?.addEventListener('click', previousStep)
  document.querySelector<HTMLButtonElement>('#mute')?.addEventListener('click', toggleMute)
  document.querySelector<HTMLButtonElement>('#next')?.addEventListener('click', nextStep)
}

function travelModeOption(value: TravelMode, selectedValue: TravelMode) {
  const selected = value === selectedValue ? ' selected' : ''

  return `<option value="${value}"${selected}>${value.toLowerCase()}</option>`
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttribute(value: string) {
  return escapeHtml(value).replaceAll('"', '&quot;')
}
