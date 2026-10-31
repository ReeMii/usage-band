import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  barOf,
  DAY_MS,
  DAY_SHARE,
  dayOf,
  endsAt,
  LAST_DAY,
  labelsOf,
  readingOf,
  settled,
  toneOf,
  TONES,
  WEEK_MS,
} from '../hooks/register'

/** Thursday 22:00 local, whatever zone the test runs in. */
const RESET = new Date(2026, 10, 5, 22, 0).getTime()
const WEEK_START = RESET - WEEK_MS

const BAND = {
  plugin: 'usage-band',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const LIMITS = [
  { kind: 'five_hour', percentUsed: 32, resetsAt: new Date(RESET).toISOString() },
  { kind: 'seven_day', percentUsed: 15, resetsAt: new Date(RESET).toISOString() },
]

/** The engine, beneath the plugin: it draws nothing above the prompt of its own. */
const engine = (
  on: On,
  rateLimits: readonly unknown[] = [],
  stored?: Record<string, unknown>,
): void => {
  mock.clock(on)
  mock.store(on, stored)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.usage', () => ({ value: { rateLimits } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>beneath</Text>
  })
}

const start = ($: Parameters<Parameters<typeof test>[1]>[0]) =>
  $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

describe('the sections', () => {
  test('a week ending Thursday night opens on Friday and ends on Thursday', () => {
    expect(labelsOf(RESET)).toEqual(['Fri', 'Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu'])
  })

  test('a week ending by day opens on that same day', () => {
    const morning = new Date(2026, 10, 5, 10, 0).getTime()

    expect(labelsOf(morning)[0]).toBe('Thu')
  })

  test('a day turns at the reset time, not at midnight', () => {
    expect(dayOf(RESET, WEEK_START)).toBe(0)
    expect(dayOf(RESET, WEEK_START + DAY_MS - 1)).toBe(0)
    expect(dayOf(RESET, WEEK_START + DAY_MS)).toBe(1)
    expect(dayOf(RESET, RESET - 1)).toBe(LAST_DAY)
  })
})

describe('the colour', () => {
  test('today, the second section, turns orange at 25.7% and red at 28.6%', () => {
    expect(toneOf(15, 1)).toBe('normal')
    expect(toneOf(25.7, 1)).toBe('normal')
    expect(toneOf(25.8, 1)).toBe('warn')
    expect(toneOf(DAY_SHARE * 2, 1)).toBe('warn')
    expect(toneOf(28.6, 1)).toBe('over')
  })

  test('short of today\'s section it is green, and on the first day it never is', () => {
    expect(toneOf(14, 1)).toBe('under')
    expect(toneOf(DAY_SHARE, 1)).toBe('normal')
    expect(toneOf(85, LAST_DAY)).toBe('under')
    expect(toneOf(0, 0)).toBe('normal')
  })

  test('the last day goes straight to red at 80% of its share', () => {
    expect(toneOf(97.1, LAST_DAY)).toBe('normal')
    expect(toneOf(97.2, LAST_DAY)).toBe('over')
  })
})

describe('the reading', () => {
  test('only the weekly window counts, and only with a reset time', () => {
    expect(readingOf(LIMITS, 1)?.percentUsed).toBe(15)
    expect(readingOf([{ kind: 'seven_day', percentUsed: 15 }], 1)).toBeNull()
    expect(readingOf([], 1)).toBeNull()
  })

  test('the reset lands on a whole minute', () => {
    const kept = { percentUsed: 15, resetsAt: new Date(RESET - 119).toISOString(), at: 0 }

    expect(settled(kept, WEEK_START).resetsAt).toBe(RESET)
  })

  test('once the window has reset it reads nothing used, next week', () => {
    const kept = { percentUsed: 90, resetsAt: new Date(RESET).toISOString(), at: 0 }

    expect(settled(kept, RESET)).toEqual({ percentUsed: 0, resetsAt: RESET + WEEK_MS })
    expect(settled(kept, RESET + WEEK_MS + 1)).toEqual({
      percentUsed: 0,
      resetsAt: RESET + 2 * WEEK_MS,
    })
  })

  test('the end reads on the 24-hour clock', () => {
    expect(endsAt(RESET)).toBe('Thu 22:00')
  })
})

describe('the bar', () => {
  const args = {
    width: 700,
    total: 830,
    tail: '15% \u00b7 Thu 22:00',
    percentUsed: 15,
    day: 1,
    labels: labelsOf(RESET),
    isDim: false,
  }

  test('it draws seven labels, seven dividers, and the fill in its tone', () => {
    const svg = barOf(args)

    expect(svg.match(/<text /g)).toHaveLength(8)
    expect(svg.match(/height="11"/g)).toHaveLength(7)
    expect(svg).toContain(`width="105" height="4" rx="2" fill="${TONES.normal}"`)
  })

  test("today's label stands out and past 100% the fill stops at the end", () => {
    const svg = barOf({ ...args, percentUsed: 104, day: LAST_DAY })

    expect(svg).toContain(`font-weight="600" fill="#ffffff">Thu<`)
    expect(svg).toContain(`width="700" height="4" rx="2" fill="${TONES.over}"`)
  })

  test('the percent and the end sit flush right, in the labels\' font', () => {
    const svg = barOf(args)

    expect(svg).toContain('width="830" height="26"')
    expect(svg).toContain('font-family="-apple-system, system-ui, sans-serif"')
    expect(svg).toContain('<text x="830" y="25" text-anchor="end" font-size="11" fill="#e4e4e4">15% \u00b7 Thu 22:00</text>')
  })

  test('a dim bar says so', () => {
    expect(barOf({ ...args, isDim: true })).toContain('opacity="0.6"')
  })
})

describe('the band', () => {
  test('a fresh reading draws the bar, the percent and the end, above what is beneath', async ($, on) => {
    engine(on, LIMITS)
    await start($)

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

    const svg = await ui.find({ type: 'Svg' })

    expect(svg?.props.source).toContain('>15% \u00b7 Thu 22:00</text>')
    // Left to the surface, so it fits the drawing to the slot.
    expect(svg?.props.width).toBeUndefined()
    expect(svg?.props.height).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /beneath/ })).toBeDefined()
    await ui.unmount()
  })

  test('a measurement replaces the reading', async ($, on) => {
    engine(on, LIMITS)
    await start($)
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

    await $.session.measure({
      context: { tokens: 0, window: 0 },
      rateLimits: [{ ...LIMITS[1], kind: 'seven_day', percentUsed: 16 }],
      cost: 0,
      changed: ['rateLimits'],
    } as never)

    expect((await ui.find({ type: 'Svg' }))?.props.source).toContain('>16% ')
    await ui.unmount()
  })

  test('with no reply yet, the last kept reading shows, dimmed', async ($, on) => {
    engine(on, [], {
      reading: { percentUsed: 12, resetsAt: new Date(RESET).toISOString(), at: 1 },
    })
    await start($)

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const svg = await ui.find({ type: 'Svg' })

    expect(svg?.props.source).toContain('opacity="0.6"')
    expect(svg?.props.source).toContain('>12% ')
    await ui.unmount()
  })

  test('nothing ever read and something else stored draws no band', async ($, on) => {
    engine(on, [], { reading: { percent: 12 } })
    await start($)

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /beneath/ })).toBeDefined()
    await ui.unmount()
  })

  test('a survey holds the band, and the terminal gets none', async ($, on) => {
    engine(on, LIMITS)
    await start($)

    const survey = await $.ui.mount({
      ...BAND,
      surface: 'desktop',
      props: { ...BAND.props, hasSurvey: true },
    })
    expect(await survey.find({ type: 'Svg' })).toBeUndefined()
    await survey.unmount()

    const terminal = await $.ui.mount({ ...BAND, surface: 'terminal' })
    expect(await terminal.find({ type: 'Text', text: /beneath/ })).toBeDefined()
    await terminal.unmount()
  })
})
