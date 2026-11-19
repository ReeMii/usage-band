/**
 * A band above the prompt showing the week's usage against the week's seven days.
 *
 * The bar is cut into seven equal sections, each a day of the window and a seventh of the limit,
 * so the fill reaching a divider means that day's share is spent. Unused days carry over: the
 * colour compares everything used so far with today's divider, not today's use alone.
 *
 * The figures are the engine's and arrive with a model response, so a session that has had no
 * reply yet shows the last reading any session kept, dimmed.
 */
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, Timer } from 'claude-code'

import type { Reading } from '../types'

const reading = atom({ plugin: 'usage-band', key: 'reading' } as const, null, {
  shape: 'reading-1',
})
const isFresh = atom({ plugin: 'usage-band', key: 'isFresh' } as const, false)
// Written once a minute so the band redraws as the day turns; nothing reads its value.
const minute = atom({ plugin: 'usage-band', key: 'minute' } as const, 0)

/** The `$.store` key the last reading is kept under, across sessions. */
const STORE_KEY = 'reading'
const TICK_MS = 60_000
export const DAY_MS = 24 * 60 * 60_000
export const WEEK_MS = 7 * DAY_MS
/** A day's share of the week, as a percentage of the limit. */
export const DAY_SHARE = 100 / 7
export const LAST_DAY = 6
/** How far through a day's share the bar turns orange. */
const WARN_AT = 0.8

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** The bar, sampled from the app's own usage bar on the dark theme. */
export const TONES = {
  under: '#46a758',
  normal: '#3d7ad8',
  warn: '#d97757',
  over: '#e5484d',
} as const
export type Tone = keyof typeof TONES

/**
 * CSS pixels per cell of the band's column. The engine reports the column less these five cells.
 * The surface scales the drawing to its slot, stretching it too, but only as a child of a column
 * Box, which is what fills the width.
 */
const CELL_PX = 7.6
const ENGINE_CELLS = 5
/** The drawing's height, and the bar's: as thick as a divider is tall, centred in it. */
const BAND_HEIGHT = 13
const BAR_THICKNESS = 11
const BAR_TOP = (BAND_HEIGHT - BAR_THICKNESS) / 2
const BAR_RADIUS = 3
/** Text sizes, and baselines that put a capital's middle on the bar's. */
const LABEL_SIZE = 9
const TAIL_SIZE = 11
const LABEL_BASELINE = 9.7
/** A label's width per character, near enough to find its middle. */
const LABEL_CHAR_PX = 5
/** Today's label, whether or not the fill has reached it. */
export const LABEL_TODAY = '#f5c518'
const TAIL_BASELINE = 10.4
const MIN_BAR_WIDTH = 240
/** Room for the percent and the end: per character, and between them and the bar. */
const TAIL_CHAR_PX = 6
const TAIL_GAP = 8

let tick: Timer | undefined

/** The weekly window among `limits`, or null when there is none to place on a calendar. */
export const readingOf = (
  limits: readonly SessionRateLimit[],
  at: number,
): Reading | null => {
  const week = limits.find(limit => limit.kind === 'seven_day')
  if (!week?.resetsAt) return null

  return { percentUsed: week.percentUsed, resetsAt: week.resetsAt, at }
}

/** What `$.store` handed back, if it is still a reading: another version may have written it. */
const isReading = (kept: unknown): kept is Reading => {
  const one = kept as Partial<Reading> | null | undefined

  return (
    typeof one?.percentUsed === 'number' &&
    typeof one.resetsAt === 'string' &&
    !Number.isNaN(Date.parse(one.resetsAt)) &&
    typeof one.at === 'number'
  )
}

/**
 * The reading as of `at`: the reset on a whole minute, since the engine reports 20:59:59.881, and
 * a window that has since reset moved on to the current week with nothing used.
 */
export const settled = (
  kept: Reading,
  at: number,
): { percentUsed: number; resetsAt: number } => {
  const resetsAt = Math.round(Date.parse(kept.resetsAt) / TICK_MS) * TICK_MS
  if (resetsAt > at) return { percentUsed: kept.percentUsed, resetsAt }

  const weeks = Math.floor((at - resetsAt) / WEEK_MS) + 1

  return { percentUsed: 0, resetsAt: resetsAt + weeks * WEEK_MS }
}

/** Which section `at` falls in, 0 to LAST_DAY: sections turn at the reset's time of day. */
export const dayOf = (resetsAt: number, at: number): number => {
  const day = Math.floor((at - (resetsAt - WEEK_MS)) / DAY_MS)

  return Math.min(LAST_DAY, Math.max(0, day))
}

/**
 * Each section's name: the day most of it falls on, read at its middle. A week ending at night
 * so opens on the next day, and one ending by day opens on the same day.
 */
export const labelsOf = (resetsAt: number): string[] =>
  Array.from({ length: LAST_DAY + 1 }, (_, day) => {
    const middle = resetsAt - WEEK_MS + day * DAY_MS + DAY_MS / 2

    return DAYS[new Date(middle).getDay()] ?? ''
  })

/**
 * Green short of today's section, blue into it, orange 80% of the way through, red past it; the
 * last day has no orange.
 */
export const toneOf = (percentUsed: number, day: number): Tone => {
  const warnAt = (day + WARN_AT) * DAY_SHARE
  const overAt = (day + 1) * DAY_SHARE

  if (percentUsed < day * DAY_SHARE) return 'under'
  if (percentUsed > overAt) return 'over'
  if (percentUsed <= warnAt) return 'normal'

  return day === LAST_DAY ? 'over' : 'warn'
}

/** When the week ends, on the 24-hour clock: `Thu 22:00`. */
export const endsAt = (resetsAt: number): string => {
  const date = new Date(resetsAt)
  const pad = (value: number): string => String(value).padStart(2, '0')

  return `${DAYS[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * The band as an SVG document: the bar, its dividers as tall as it is, the day labels laid over
 * it, and `tail` to its right, all centred on one line. `tail` is drawn here because a Text can
 * only take the surface's own faces, never the labels'. `width` is the bar's, `total` the whole
 * drawing's. The week's end needs no divider: the bar ends there.
 */
export const barOf = (args: {
  width: number
  total: number
  tail: string
  percentUsed: number
  day: number
  labels: readonly string[]
  isDim: boolean
}): string => {
  const { width, total, tail, percentUsed, day, labels, isDim } = args
  const sectionWidth = width / labels.length
  const fill = (Math.min(100, percentUsed) / 100) * width
  const tone = TONES[toneOf(percentUsed, day)]
  const ends = labels.map((_, index) =>
    Math.min(Math.round((index + 1) * sectionWidth * 10) / 10, width - 0.5),
  )

  const dividers = ends
    .slice(0, -1)
    .map(
      edge =>
        `<rect x="${edge - 0.5}" y="${BAR_TOP}" width="1" height="${BAR_THICKNESS}" fill="#6f6f6f"/>`,
    )
  const names = labels.map((label, index) => {
    const isToday = index === day
    const right = ends[index]! - 4
    // Over the fill once the fill reaches the label's middle.
    const isOverFill = fill >= right - (label.length * LABEL_CHAR_PX) / 2
    const colour = isToday ? LABEL_TODAY : isOverFill ? '#ffffff' : '#b0b0b0'
    const weight = isToday ? 600 : 400

    return (
      `<text x="${right}" y="${LABEL_BASELINE}" text-anchor="end" ` +
      `font-size="${LABEL_SIZE}" font-weight="${weight}" fill="${colour}">${label}</text>`
    )
  })

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${BAND_HEIGHT}" ` +
    `viewBox="0 0 ${total} ${BAND_HEIGHT}" font-family="-apple-system, system-ui, sans-serif"` +
    `${isDim ? ' opacity="0.6"' : ''}>` +
    `<rect y="${BAR_TOP}" width="${width}" height="${BAR_THICKNESS}" rx="${BAR_RADIUS}" fill="#454545"/>` +
    `<rect y="${BAR_TOP}" width="${Math.round(fill * 10) / 10}" height="${BAR_THICKNESS}" ` +
    `rx="${BAR_RADIUS}" fill="${tone}"/>` +
    `${dividers.join('')}${names.join('')}` +
    `<text x="${total}" y="${TAIL_BASELINE}" text-anchor="end" font-size="${TAIL_SIZE}" ` +
    `fill="#e4e4e4">${tail}</text></svg>`
  )
}

/** Keeps a reading the engine reported, for this session and the next. */
const take = async (
  $: EngineInterface,
  limits: readonly SessionRateLimit[],
): Promise<void> => {
  const taken = readingOf(limits, Date.now())
  if (!taken) return

  await update($, reading, () => taken)
  await update($, isFresh, () => true)
  await $.store.set(STORE_KEY, taken)
}

/** Starts the minute, replacing any earlier one. It must never reject: that ends the interval. */
const arm = ($: EngineInterface): void => {
  tick?.cancel()
  tick = $.clock.every(TICK_MS, () => {
    update($, minute, was => was + 1).catch(() => {
      // The next minute tries again.
    })
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A failed read leaves a band with nothing to draw, never a session that will not start.
    try {
      if (!(await read($, reading))) {
        const kept = await $.store.get(STORE_KEY)
        if (isReading(kept)) await update($, reading, () => kept)
      }
      await take($, (await $.session.usage()).rateLimits)
    } catch {
      // The first response brings the figures.
    }
    arm($)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await take($, e.rateLimits)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    await read($, minute)
    const kept = await read($, reading)
    const isCurrent = await read($, isFresh)
    if (e.surface !== 'desktop' || e.props.hasSurvey || !kept) return next(e)

    const { Box, Svg } = $.ui.resolve(e)
    const below = await next(e)
    const at = Date.now()
    const { percentUsed, resetsAt } = settled(kept, at)
    const shown = `${Math.round(percentUsed)}%`
    const ends = endsAt(resetsAt)
    const tail = `${shown} · ${ends}`
    const tailWidth = Math.round(tail.length * TAIL_CHAR_PX) + TAIL_GAP
    const width = Math.max(
      MIN_BAR_WIDTH,
      Math.round((e.props.bodyColumns + ENGINE_CELLS) * CELL_PX) - tailWidth,
    )

    return (
      <Box flexDirection="column">
        <Svg
          source={barOf({
            width,
            total: width + tailWidth,
            tail,
            percentUsed,
            day: dayOf(resetsAt, at),
            labels: labelsOf(resetsAt),
            isDim: !isCurrent,
          })}
          alt={`Weekly usage ${shown}, resets ${ends}`}
        />
        {below}
      </Box>
    )
  })
}
