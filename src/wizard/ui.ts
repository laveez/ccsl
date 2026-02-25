import { bgRgb, fgWhite, reset } from "../utils.js";

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

export function header(text: string): string {
    const bg = bgRgb(38, 60, 100);
    return `${bg}${fgWhite()} ${BOLD}${text} ${RESET}`;
}

export function sectionLabel(text: string): string {
    return `${BOLD}${text}${RESET}`;
}

export function highlight(text: string): string {
    const bg = bgRgb(65, 45, 88);
    return `${bg}${fgWhite()} ${text} ${RESET}`;
}

export function dim(text: string): string {
    return `${DIM}${text}${RESET}`;
}

export function selectedRow(text: string): string {
    const bg = bgRgb(50, 55, 65);
    return `${bg}${fgWhite()} ${text} ${RESET}`;
}

export function cursor(): string {
    return `${BOLD}\x1b[38;2;100;180;255m▸${RESET} `;
}

export function boxTop(width: number): string {
    return `${DIM}╭${"─".repeat(width - 2)}╮${RESET}`;
}

export function boxBottom(width: number): string {
    return `${DIM}╰${"─".repeat(width - 2)}╯${RESET}`;
}

export function keyHint(key: string, action: string): string {
    return `${BOLD}${key}${RESET} ${dim(action)}`;
}
