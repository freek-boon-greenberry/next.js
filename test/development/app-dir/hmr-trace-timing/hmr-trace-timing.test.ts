import { nextTestSetup } from 'e2e-utils'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { retry } from 'next-test-utils'

type SpanId = number

type TraceEvent = {
  traceId?: string
  parentId?: SpanId
  name: string
  id: SpanId
  timestamp: number
  duration: number
  tags?: Record<string, unknown>
  startTime?: number
}

interface TraceStructure {
  events: TraceEvent[]
  eventsByName: Map<string, TraceEvent[]>
  eventsById: Map<string, TraceEvent>
}

function parseTraceFile(tracePath: string): TraceStructure {
  const traceContent = readFileSync(tracePath, 'utf8')
  const traceLines = traceContent
    .trim()
    .split('\n')
    .filter((line) => line.trim())

  const allEvents: TraceEvent[] = []

  for (const line of traceLines) {
    const events = JSON.parse(line) as TraceEvent[]
    allEvents.push(...events)
  }

  const eventsByName = new Map<string, TraceEvent[]>()
  const eventsById = new Map<string, TraceEvent>()

  // Index all events
  for (const event of allEvents) {
    if (!eventsByName.has(event.name)) {
      eventsByName.set(event.name, [])
    }
    eventsByName.get(event.name)!.push(event)
    eventsById.set(event.id.toString(), event)
  }

  return {
    events: allEvents,
    eventsByName,
    eventsById,
  }
}

describe('hmr-trace-timing', () => {
  const { next, isNextDev, isTurbopack } = nextTestSetup({
    files: __dirname,
  })

  if (!isNextDev) {
    it('should be skipped in production', () => {})
    return
  }

  if (!isTurbopack) {
    it('should be skipped for webpack (turbopack-only feature)', () => {})
    return
  }

  it('should record client-hmr-latency events with compilationId', async () => {
    // Open a browser and view the page
    const browser = await next.browser('/')
    expect(await browser.elementByCss('p').text()).toBe('hello world')

    // Trigger multiple HMR events to test trace collection
    for (let i = 0; i < 5; i++) {
      await next.patchFile('app/page.tsx', (content) => {
        return content.replace(/<p>.*?<\/p>/, `<p>hello HMR ${i}</p>`)
      })

      await retry(async () => {
        expect(await browser.elementByCss('p').text()).toBe(`hello HMR ${i}`)
      })
    }

    // Close browser and stop dev server with SIGTERM to allow cleanup
    await browser.close()
    await next.stop('SIGTERM')

    // Wait for server's SIGTERM handler to complete trace flushing
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Read the trace file (in dev mode it's in .next/dev/trace)
    const tracePath = join(next.testDir, '.next/dev/trace')
    expect(existsSync(tracePath)).toBe(true)

    const traceStructure = parseTraceFile(tracePath)

    // Check for client-hmr-latency events
    const clientHmrLatencyEvents =
      traceStructure.eventsByName.get('client-hmr-latency')
    expect(clientHmrLatencyEvents).toBeDefined()
    expect(clientHmrLatencyEvents!.length).toBeGreaterThan(0)

    // Verify events have compilationId
    let eventsWithCompilationId = 0
    for (const clientEvent of clientHmrLatencyEvents!) {
      const compilationId = (clientEvent.tags as any)?.compilationId
      if (compilationId) {
        eventsWithCompilationId++
        // Verify the event has valid duration
        expect(clientEvent.duration).toBeGreaterThan(0)

        // Log timing details for debugging
        console.log(`HMR Timing for compilationId ${compilationId}:`)
        console.log(
          `  Client HMR latency: ${clientEvent.duration / 1_000_000}ms`
        )
      }
    }

    // Should have at least one event with compilationId
    expect(eventsWithCompilationId).toBeGreaterThan(0)
  })

  it('should record render-path events for page requests', async () => {
    const tracePath = join(next.testDir, '.next/dev/trace')

    // Trigger page request if trace doesn't exist yet
    if (!existsSync(tracePath)) {
      const browser = await next.browser('/')
      expect(await browser.elementByCss('p').text()).toBe('hello world')
      await browser.close()
      await next.stop('SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, 500))
    }

    const traceStructure = parseTraceFile(tracePath)

    // Check for render-path events
    const renderPathEvents = traceStructure.eventsByName.get('render-path')
    expect(renderPathEvents).toBeDefined()
    expect(renderPathEvents!.length).toBeGreaterThan(0)

    // Verify the first render-path event has expected attributes
    const renderEvent = renderPathEvents![0]
    expect(renderEvent.tags).toBeDefined()
    const renderTags = renderEvent.tags as any

    expect(renderTags.path).toBeDefined()
    expect(typeof renderTags.path).toBe('string')

    // Verify render event has valid duration
    expect(renderEvent.duration).toBeGreaterThan(0)

    // Log timing details for debugging
    console.log(`Render timing: ${renderEvent.duration / 1000}ms`)
  })
})
