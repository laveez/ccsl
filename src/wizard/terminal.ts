export interface KeyEvent {
    name: string;
    char?: string;
    ctrl?: boolean;
    shift?: boolean;
}

let rawModeActive = false;
let cursorHidden = false;

export function enableRawMode(): void {
    if (process.stdin.isTTY && !rawModeActive) {
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding("utf8");
        rawModeActive = true;
    }
}

export function disableRawMode(): void {
    if (rawModeActive) {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        rawModeActive = false;
    }
}

export function hideCursor(): void {
    process.stdout.write("\x1b[?25l");
    cursorHidden = true;
}

export function showCursor(): void {
    process.stdout.write("\x1b[?25h");
    cursorHidden = false;
}

export function clearScreen(): void {
    process.stdout.write("\x1b[2J\x1b[H");
}

export function eraseDown(): void {
    process.stdout.write("\x1b[J");
}

function cleanup(): void {
    if (cursorHidden) showCursor();
    if (rawModeActive) disableRawMode();
}

process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
});

process.on("exit", cleanup);

export function readKey(): Promise<KeyEvent> {
    return new Promise((resolve) => {
        process.stdin.once("data", (data: string) => {
            resolve(parseKey(data));
        });
    });
}

function parseKey(data: string): KeyEvent {
    if (data === "\x03") return { name: "ctrl-c", ctrl: true };
    if (data === "\r" || data === "\n") return { name: "enter" };
    if (data === " ") return { name: "space", char: " " };
    if (data === "\x1b") return { name: "escape" };
    if (data === "\x7f" || data === "\x08") return { name: "backspace" };
    if (data === "\t") return { name: "tab" };

    // Arrow keys and modifiers
    if (data.startsWith("\x1b[")) {
        const seq = data.slice(2);
        // Shift+arrows: \x1b[1;2A etc.
        if (seq === "1;2A") return { name: "up", shift: true };
        if (seq === "1;2B") return { name: "down", shift: true };
        if (seq === "1;2C") return { name: "right", shift: true };
        if (seq === "1;2D") return { name: "left", shift: true };
        // Plain arrows
        if (seq === "A") return { name: "up" };
        if (seq === "B") return { name: "down" };
        if (seq === "C") return { name: "right" };
        if (seq === "D") return { name: "left" };
        // Home/End
        if (seq === "H") return { name: "home" };
        if (seq === "F") return { name: "end" };
    }

    // Ctrl+letter
    const code = data.charCodeAt(0);
    if (code >= 1 && code <= 26) {
        return { name: String.fromCharCode(code + 96), ctrl: true };
    }

    // Printable character
    if (data.length === 1 && code >= 32) {
        return { name: data, char: data };
    }

    return { name: "unknown", char: data };
}
