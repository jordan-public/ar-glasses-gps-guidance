import {
  waitForEvenAppBridge,
  TextContainerProperty,
  TextContainerUpgrade,
  CreateStartUpPageContainer,
  OsEventTypeList,
} from '@evenrealities/even_hub_sdk'

type Maneuver = 'START' | 'LEFT' | 'RIGHT' | 'STRAIGHT' | 'ARRIVE'

type RouteStep = {
  maneuver: Maneuver
  instruction: string
  street: string
  distanceMeters: number
  etaMinutes: number
}

type ContainerId = keyof typeof containers

const routeName = 'Home to Blue Bottle'

const route: RouteStep[] = [
  {
    maneuver: 'START',
    instruction: 'Head north on Market St',
    street: 'Market St',
    distanceMeters: 120,
    etaMinutes: 8,
  },
  {
    maneuver: 'RIGHT',
    instruction: 'Turn right onto 3rd St',
    street: '3rd St',
    distanceMeters: 260,
    etaMinutes: 7,
  },
  {
    maneuver: 'LEFT',
    instruction: 'Turn left on Folsom St',
    street: 'Folsom St',
    distanceMeters: 430,
    etaMinutes: 5,
  },
  {
    maneuver: 'STRAIGHT',
    instruction: 'Continue past Howard St',
    street: 'Folsom St',
    distanceMeters: 180,
    etaMinutes: 3,
  },
  {
    maneuver: 'ARRIVE',
    instruction: 'Destination on your right',
    street: 'Blue Bottle Coffee',
    distanceMeters: 0,
    etaMinutes: 0,
  },
]

const containers = {
  header: { id: 1, name: 'navHeader' },
  maneuver: { id: 2, name: 'navTurn' },
  detail: { id: 3, name: 'navDetail' },
  progress: { id: 4, name: 'navProgress' },
  footer: { id: 5, name: 'navFooter' },
} as const

let currentStepIndex = 0
let isMuted = false

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
    bridge.shutDownPageContainer(1)
    return
  }

  if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
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
  const step = route[currentStepIndex]
  const remainingMeters = route.slice(currentStepIndex).reduce((sum, item) => sum + item.distanceMeters, 0)
  const remainingMinutes = route.slice(currentStepIndex).reduce((sum, item) => sum + item.etaMinutes, 0)
  const progress = `${currentStepIndex + 1}/${route.length} ${progressBar(currentStepIndex, route.length)}`
  const soundState = isMuted ? 'Muted' : 'Guidance on'

  await Promise.all([
    updateText('header', `${routeName}\n${formatDistance(remainingMeters)} left | ${remainingMinutes} min`),
    updateText('maneuver', `${maneuverLabel(step.maneuver)}\n${formatDistance(step.distanceMeters)}`),
    updateText('detail', `${step.instruction}\n${step.street}`),
    updateText('progress', progress),
    updateText('footer', `${soundState} | Tap next | Scroll back | Double-tap exit`),
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

function formatDistance(meters: number) {
  if (meters <= 0) return '0 ft'
  const feet = Math.round(meters * 3.28084)

  if (feet < 1000) return `${roundToNearest(feet, 10)} ft`

  return `${(feet / 5280).toFixed(1)} mi`
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

  const step = route[currentStepIndex]

  app.innerHTML = `
    <main class="shell">
      <section class="status">
        <p class="eyebrow">Glasses navigation</p>
        <h1>${maneuverLabel(step.maneuver)}</h1>
        <p class="distance">${formatDistance(step.distanceMeters)}</p>
        <p class="instruction">${step.instruction}</p>
        <p class="street">${step.street}</p>
        <div class="meter" aria-label="Route progress">
          <span style="width: ${((currentStepIndex + 1) / route.length) * 100}%"></span>
        </div>
        <p class="meta">Step ${currentStepIndex + 1} of ${route.length} | ${isMuted ? 'Muted' : 'Guidance on'}</p>
      </section>
      <section class="controls" aria-label="Navigation controls">
        <button id="previous" type="button">Previous</button>
        <button id="mute" type="button">${isMuted ? 'Unmute' : 'Mute'}</button>
        <button id="next" type="button">Next</button>
      </section>
    </main>
  `

  document.querySelector<HTMLButtonElement>('#previous')?.addEventListener('click', previousStep)
  document.querySelector<HTMLButtonElement>('#mute')?.addEventListener('click', toggleMute)
  document.querySelector<HTMLButtonElement>('#next')?.addEventListener('click', nextStep)
}
