import type { UsageData } from "./types.js";
import { BADGE } from "./types.js";
import type { RGB } from "./utils.js";
import { bgRgb, fgRgb, fgWhite, reset, gradientColor } from "./utils.js";

// Each limit is drawn as a bar whose fill is the share used and whose white tick is the clock, so fill past
// the tick means the limit is being used faster than its window runs down.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const FIVE_HOURS = 5 * HOUR;
const SEVEN_DAYS = 7 * DAY;
const CELLS_5H = 6;
const CELLS_7D = 7;
// Countdowns are padded to this many characters so each badge keeps one width as it ticks down.
const COUNTDOWN_CHARS = 5;
// The countdown also takes a lead cell, '↻ ' and a trailing space.
const COUNTDOWN_WIDTH = COUNTDOWN_CHARS + 4;
const PERCENT_WIDTH = 3;

// Colors are keyed on points of usage ahead of the clock.
const ON_PACE_PTS = 1;
const GOLD_PTS = 5;
const ORANGE_PTS = 12;
const RED_PTS = 20;
// Deeper than BADGE.rose, so a hot chip does not read as the rose effort or cost badge beside it.
const HOT_RED: RGB = [108, 28, 34];
const CHIP_STOPS: [number, RGB][] = [[ON_PACE_PTS, BADGE.green], [GOLD_PTS, BADGE.gold], [ORANGE_PTS, BADGE.orange], [RED_PTS, HOT_RED]];
const FILL_STOPS: [number, RGB][] = [[ON_PACE_PTS, [60, 135, 75]], [GOLD_PTS, [150, 122, 38]], [ORANGE_PTS, [165, 95, 40]], [RED_PTS, [170, 60, 68]]];
// A hit limit is brighter than any pace red: blocked must not look like burning fast.
const LIMIT_CHIP: RGB = [150, 24, 44];
const LIMIT_FILL: RGB = [186, 40, 56];
const NEUTRAL_CHIP: RGB = BADGE.steel;
const NEUTRAL_FILL: RGB = [112, 120, 138];
const TRACK: RGB = [45, 48, 55];
const TICK: RGB = [245, 245, 245];
const DIM: RGB = [200, 204, 214];
const TAB_SHADE = 0.6;

// The first tenth of the 5h window forgives up to 5 points of lead, fading out: one big prompt is a burst, not a pace.
const BURST_PTS = 5;
const BURST_SHARE = 0.1;
// Once the current pace would run dry within 15% of the window (fully from 10%), the color also follows the
// lockout it implies, as a share of the window: 2% (6 min of 5h) is gold, 7% orange, 20% red.
const RUNWAY_SOON = 0.15;
const RUNWAY_RAMP = 0.05;
const LOCKOUT_PTS: [number, number][] = [[0, 0], [0.02, GOLD_PTS], [0.07, ORANGE_PTS], [0.2, RED_PTS]];

const LEFT_EIGHTHS = ["", "▏", "▎", "▍", "▌", "▋", "▊", "▉"];

interface WindowState {
    state: "pace" | "limit" | "unknown" | "resetting";
    used: number;
    leftMs: number | null;
    // Share of the window the tick marks.
    clock: number;
    // Points of usage ahead of the clock; severity adds the burst grace and the runway forecast.
    lead: number;
    severity: number;
}

interface Cell {
    bg: RGB;
    fg?: RGB;
    ch: string;
    edge?: boolean;
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

function piecewise(stops: [number, number][], x: number): number {
    if (x <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
        const [x1, y1] = stops[i];
        if (x <= x1) {
            const [x0, y0] = stops[i - 1];
            return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
        }
    }
    return stops[stops.length - 1][1];
}

function severity(used: number, clock: number, grace: number, elapsedMs: number, leftMs: number, windowMs: number): number {
    const lead = used - 100 * clock - grace;
    const elapsed = elapsedMs / windowMs;
    if (elapsed < BURST_SHARE || used <= 100 * elapsed) return lead;
    const toLimitMs = ((100 - used) / used) * elapsedMs;
    const soon = clamp((RUNWAY_SOON * windowMs - toLimitMs) / (RUNWAY_RAMP * windowMs), 0, 1);
    const lockout = piecewise(LOCKOUT_PTS, (leftMs - toLimitMs) / windowMs);
    return lead + soon * Math.max(0, lockout - lead);
}

function measure(usedPct: number, resetsAt: Date | null, windowMs: number, weekly: boolean): WindowState {
    const used = clamp(Number.isFinite(usedPct) ? usedPct : 0, 0, 100);
    const resetMs = resetsAt?.getTime() ?? NaN;
    const still = { used, clock: 0, lead: 0, severity: 0 };
    // A resets_at of null or 0 arrives as the 1970 epoch: an unknown reset, not one that has passed.
    if (!(resetMs > 0)) return { ...still, state: used >= 100 ? "limit" : "unknown", leftMs: null };
    // A reset further off than the window is clock skew, and would only overflow the countdown.
    const leftMs = Math.min(resetMs - Date.now(), windowMs);
    if (leftMs <= 0) return { ...still, state: "resetting", leftMs: 0 };
    if (used >= 100) return { ...still, state: "limit", leftMs };
    const elapsedMs = clamp(windowMs - leftMs, 0, windowMs);
    const elapsed = elapsedMs / windowMs;
    // The weekly clock is the end of the current day of the window: a working day spent at a seventh of the
    // limit stays level with it whichever hours it falls in, where the wall clock would run behind every evening.
    const clock = weekly ? Math.min(CELLS_7D, Math.floor(elapsedMs / (windowMs / CELLS_7D)) + 1) / CELLS_7D : elapsed;
    const grace = weekly ? 0 : BURST_PTS * Math.max(0, 1 - elapsed / BURST_SHARE);
    return {
        state: "pace",
        used,
        leftMs,
        clock,
        lead: used - 100 * clock,
        severity: severity(used, clock, grace, elapsedMs, leftMs, windowMs),
    };
}

function colors(s: WindowState): { chip: RGB; fill: RGB } {
    if (s.state === "limit") return { chip: LIMIT_CHIP, fill: LIMIT_FILL };
    if (s.state === "pace") return { chip: gradientColor(CHIP_STOPS, s.severity), fill: gradientColor(FILL_STOPS, s.severity) };
    return { chip: NEUTRAL_CHIP, fill: NEUTRAL_FILL };
}

// Which side of the clock the fill is on: ahead, behind, or level with it.
function side(s: WindowState): number {
    if (s.lead > ON_PACE_PTS) return 1;
    return s.lead < -ON_PACE_PTS ? -1 : 0;
}

// Nearest minute under 10 hours, nearest hour from there, at most 5 characters: 45m, 2h43m, 14h.
function formatLeft(ms: number): string {
    const minutes = Math.max(1, Math.round(ms / MINUTE));
    if (minutes < 60) return `${minutes}m`;
    if (minutes < 600) return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
    return `${Math.round(ms / HOUR)}h`;
}

// Nearest hour once a day or more is left, at most 5 characters: 4d05h, 23h, 9h40m.
function formatDaysLeft(ms: number): string {
    const hours = Math.round(ms / HOUR);
    return hours < 24 ? formatLeft(ms) : `${Math.floor(hours / 24)}d${String(hours % 24).padStart(2, "0")}h`;
}

// Padded so the chip keeps one width from 0% to 99%, on the right so a one-digit value keeps a gap before the
// bar. 99.6% must not read as 100% while the chip still shows a pace color instead of the limit one.
function percent(used: number): string {
    return `${used >= 100 ? 100 : Math.min(99, Math.round(used))}%`.padEnd(PERCENT_WIDTH);
}

// The label sits on a darker tab of the chip color, split mid-cell by ▌, so every chip shows an edge against
// neighbors of a similar color without costing a column.
function head(label: string, chip: RGB): string {
    const tab: RGB = [Math.round(chip[0] * TAB_SHADE), Math.round(chip[1] * TAB_SHADE), Math.round(chip[2] * TAB_SHADE)];
    return `${bgRgb(...tab)}${fgWhite()} ${label}${fgRgb(...tab)}${bgRgb(...chip)}▌${fgWhite()}`;
}

// Any usage shows at least a sliver, and only a hit limit fills the whole bar.
function barCells(count: number, used: number, fill: RGB): Cell[] {
    const eighths = clamp(Math.round((used / 100) * count * 8), used > 0 ? 1 : 0, used >= 100 ? count * 8 : count * 8 - 1);
    return Array.from({ length: count }, (_, i): Cell => {
        const cover = clamp(eighths - 8 * i, 0, 8);
        if (cover === 8) return { bg: fill, ch: " " };
        if (cover === 0) return { bg: TRACK, ch: " " };
        return { bg: TRACK, fg: fill, ch: LEFT_EIGHTHS[cover], edge: true };
    });
}

// The tick sits on cell boundary `at`, drawn as ▕ in the cell before it or ▏ in the cell after it, whichever
// does not hold the fill's ragged edge. When it has to share that cell, the cell takes the side the verdict
// reads (full when ahead, empty when behind), so the fill never shows on the wrong side of the clock; on the
// bar's right end a full cell would read as the limit, so the tick steps back a boundary instead.
// `room` says which free chip cells border the bar; a tick on the bar's end goes there ("before" or "after")
// rather than hide the fill's edge.
function placeTick(
    cells: Cell[],
    at: number,
    ahead: number,
    fill: RGB,
    room: { before: boolean; after: boolean },
): "in" | "before" | "after" {
    const before: Cell | undefined = cells[at - 1];
    const after: Cell | undefined = cells[at];
    const mark = (i: number, ch: string, bg: RGB = cells[i].bg): "in" => {
        cells[i] = { bg, fg: TICK, ch };
        return "in";
    };
    if (after?.edge && ahead < 0) return mark(at, "▏", TRACK);
    if (before?.edge && ahead > 0) return after ? mark(at - 1, "▕", fill) : placeTick(cells, at - 1, ahead, fill, room);
    if (after && !after.edge) return mark(at, "▏");
    if (before && !before.edge) return mark(at - 1, "▕");
    if (after) return ahead > 0 && room.before ? "before" : mark(at, "▏", ahead > 0 ? fill : TRACK);
    return room.after ? "after" : mark(at - 1, "▕", TRACK);
}

function paint(cells: Cell[]): string {
    return cells.map(c => `${bgRgb(...c.bg)}${c.fg ? fgRgb(...c.fg) : ""}${c.ch}`).join("");
}

// The space before ↻ is the cell after the bar, where an end-of-window tick goes when the bar's last cell
// holds the fill's edge. Padding goes before ↻ so the countdown stays right-aligned.
function countdown(text: string, chip: RGB, tickFirst: boolean): string {
    const first = tickFirst ? `${fgRgb(...TICK)}▏` : " ";
    return `${bgRgb(...chip)}${first}${" ".repeat(COUNTDOWN_CHARS - text.length)}${fgRgb(...DIM)}↻${fgWhite()} ${text} `;
}

interface BarStyle {
    label: string;
    cells: number;
    timeLeft: (ms: number) => string;
}

const FIVE_HOUR_BAR: BarStyle = { label: "⚡", cells: CELLS_5H, timeLeft: formatLeft };
const SEVEN_DAY_BAR: BarStyle = { label: "7d", cells: CELLS_7D, timeLeft: formatDaysLeft };

function renderBar(s: WindowState, bar: BarStyle, { chip, fill }: { chip: RGB; fill: RGB }): string {
    const tab = head(bar.label, chip);
    if (s.state === "resetting") return `${tab}${"resetting".padEnd(PERCENT_WIDTH + bar.cells + COUNTDOWN_WIDTH)}${reset()}`;
    // A full bar gives a cell to the wider '100%', so hitting the limit never widens the chip.
    const cells = barCells(s.state === "limit" ? bar.cells - 1 : bar.cells, s.used, fill);
    let label = percent(s.used);
    const room = { before: label.endsWith(" "), after: true };
    const tick = s.state === "pace" ? placeTick(cells, Math.round(s.clock * bar.cells), side(s), fill, room) : "in";
    if (tick === "before") label = `${label.slice(0, -1)}${fgRgb(...TICK)}▕${fgWhite()}`;
    const tail = s.leftMs === null
        ? `${bgRgb(...chip)}${" ".repeat(COUNTDOWN_WIDTH)}`
        : countdown(bar.timeLeft(s.leftMs), chip, tick === "after");
    return `${tab}${label}${paint(cells)}${tail}${reset()}`;
}

function compact7d(s: WindowState): string {
    const tab = head("7d", colors(s).chip);
    if (s.state === "resetting") return `${tab}  ↻ ${reset()}`;
    return `${tab}${s.state === "limit" ? "100%" : `${percent(s.used)} `}${reset()}`;
}

export function buildUsage5hBadge(usageData: UsageData | null): string[] {
    if (!usageData || usageData.fiveHour === null) return [];
    const fiveHour = measure(usageData.fiveHour, usageData.fiveHourResetAt, FIVE_HOURS, false);
    // The 5h window cannot be spent while the 7d limit is used up, so its chip goes neutral.
    const weeklyLimitHit = usageData.sevenDay !== null
        && measure(usageData.sevenDay, usageData.sevenDayResetAt, SEVEN_DAYS, true).state === "limit";
    return [renderBar(fiveHour, FIVE_HOUR_BAR, weeklyLimitHit ? { chip: NEUTRAL_CHIP, fill: NEUTRAL_FILL } : colors(fiveHour))];
}

// `compact` is the 8-column chip without the day bar or countdown, for a row too full to take them.
export function buildUsage7dBadge(usageData: UsageData | null, compact = false): string[] {
    if (!usageData || usageData.sevenDay === null) return [];
    const sevenDay = measure(usageData.sevenDay, usageData.sevenDayResetAt, SEVEN_DAYS, true);
    return [compact ? compact7d(sevenDay) : renderBar(sevenDay, SEVEN_DAY_BAR, colors(sevenDay))];
}
