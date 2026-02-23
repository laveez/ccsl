<div align="center">

# ccsl

**Claude Code Statusline**

A rich, information-dense statusline for Claude Code.

[![npm](https://img.shields.io/npm/v/ccsl?style=flat-square)](https://www.npmjs.com/package/ccsl)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)
[![Node.js 18+](https://img.shields.io/badge/Node.js-18%2B-brightgreen?style=flat-square)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](#)

</div>

---

ccsl replaces Claude Code's default statusline with a dense, color-coded ANSI badge display. It shows your model and plan, session duration, cost, context window usage, git status, file changes, PR links, active tools, sub-agents, task progress, and more — all rendered as compact badges with gradient backgrounds that shift color based on values.

![Demo](docs/demo.gif)

### Contents

- [Layouts](#layouts) · [Badge Reference](#badge-reference) · [Quick Start](#quick-start) · [Configuration](#configuration)
- [How It Works](#how-it-works) · [Privacy](#privacy) · [See Also](#see-also) · [Contributing](#contributing)

---

## Layouts

Three layout modes — **dense** (fixed header rows, default), **semantic** (one category per row), and **adaptive** (auto-wrapping stream). Badges have colored backgrounds that shift based on values — cost from green to red, duration from green to purple, context bars from green to yellow to red.

---

## Badge Reference

![Badge reference](docs/badge-reference.png)

Every badge the statusline can show, with all possible states:

| Badge | Description | States |
|---|---|---|
| **Model / Plan** | Current Claude model and subscription plan | `Opus`, `Sonnet \| Pro`, `Opus \| Max` |
| **Duration** | Session wall-clock time. Background shifts green → gold → purple | `30s`, `12m`, `1h 30m`, `3h` |
| **Cost** | Cumulative API cost. Background shifts green → gold → orange → red | `$0.42`, `$4.82`, `$50`, `$123` |
| **Context window** | Visual progress bar of token usage with color-coded fill | Green (<70%), yellow (70–84%), red (≥85%) |
| **Cache breakdown** | Token split: cache read / cache write / uncached | `🔥 12kr·5kw·800u` |
| **Usage rate limit** | Anthropic API utilization with reset timer | `⚡ 12% (4h 23m / 5h)` — bar fills green/yellow/red |
| **Repo name** | Git repository name | `ccsl`, `my-project` |
| **Branch / Worktree** | Current branch (🌿) or worktree (🌳). Main/master shown in purple | `🌿 main`, `🌿 feature/auth`, `🌳 fix-login` |
| **File stats** | Dirty file counts: modified (!), added (+), deleted (✘), untracked (?) | `!3`, `!1+2?4`, `!5+3✘1?2` |
| **Ahead / Behind** | Commits ahead/behind remote tracking branch | `↑3`, `↓2`, `↑5↓1` |
| **Lines changed** | Total lines added (green) and removed (red) in session | `📊 +284-67` |
| **Config summary** | Counts of CLAUDE.md files, MCP servers, and hooks | `📋 2 CLAUDE.md \| 5 MCPs \| 3 hooks` |
| **Ticket marker** | Jira-style ticket ID extracted from PR title | `🎫 PROJ-123` |
| **PR link** | Clickable PR with status: Draft, Open, Mergeable (✅), Merged, Closed | `🔗 PR#42 (D)`, `(O)`, `(✅)`, `(M)`, `(C)` |
| **Recall status** | Whether `/recall` was run this session | `🧩 ✓` (recalled), `🧩 ✗` (not recalled) |
| **Learn status** | Compact relative time since last `/learn`, plus unprocessed observation count or ✓ | `📚 15m ✓` (recent, all processed), `📚 3d 1418` (3 days ago, 1418 pending), `📚 ⚠ 500` (pending) |
| **Instinct status** | Active instinct count with promotion/correction indicators | `🧬 21` (normal), `🧬 21 ▲3` (3 promotable), `🧬 21 !` (corrections detected) |
| **CCTG** | [cctg](https://github.com/laveez/cctg) Telegram gate status | `📱 ON`, `📱 off` |
| **Transcript link** | Clickable `file://` hyperlink to session transcript | `📝 session-abc.jsonl` |
| **Running tool** | Currently executing tool with target | `◐ Bash: npm test`, `◐ Read: src/types.ts` |
| **Completed tools** | Tool use counts, color-coded by category | `Read×12`, `Grep×6`, `Bash×8`, `WebSearch×1` |
| **MCP tools** | MCP tool counts grouped by server | `🔌playwright×6`, `🔌context7×3` |
| **Running agent** | Active Task subagent with elapsed time | `◐ feature Review auth… (2m 30s)` |
| **Completed agents** | Recent finished agents (max 2) with duration | `✓ feature Review auth… 2m` |
| **Tasks** | Current task from TodoWrite with progress | `▸ Add rate limiting (3/6)`, `✓ All done (6/6)` |

> **Note:** Badges marked with `features.*` in the reference image require the corresponding feature toggle in config.

---

## Quick Start

### 1. Install

```bash
npm install -g ccsl
```

### 2. Configure Claude Code

Add to your `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "ccsl"
  }
}
```

That's it. Claude Code will pipe status data to ccsl on every update.

---

## Configuration

Create `~/.claude/statusline-config.json` to customize behavior:

```json
{
  "layout": "dense",
  "features": {
    "usage": false,
    "learning": false,
    "cctg": false
  }
}
```

| Option | Description | Default |
|---|---|---|
| `layout` | Layout mode (`dense`, `semantic`, `adaptive`) | `dense` |
| `features.usage` | Show Anthropic API usage rate limit bar (see [privacy note](#privacy)) | `false` |
| `features.learning` | Show recall/learn/instinct status badges (for custom learning loop integration) | `false` |
| `features.cctg` | Show [cctg](https://github.com/laveez/cctg) (Claude Code Telegram Gate) status badge | `false` |

---

## How It Works

```mermaid
flowchart TD
    A[Claude Code<br/>Status hook] --> B[stdin JSON]
    B --> C[ccsl]
    C --> D[Git info]
    C --> E[Transcript]
    C --> F[Config counts]
    C --> G[Usage API*]
    D --> H[Render badges]
    E --> H
    F --> H
    G --> H
    H --> I[stdout ANSI]

    style A fill:#2d4a2d
    style C fill:#38608c
    style I fill:#2d4a2d
    style G fill:#5f3a1c
```

ccsl is a [StatusLine command](https://code.claude.com/docs/en/settings) — Claude Code pipes a JSON object to stdin on every status update. ccsl gathers additional context (git state, transcript history, config files, optionally the usage API), renders everything as ANSI-colored badges, and writes the result to stdout.

\* Usage API is optional and requires `features.usage: true` in config.

---

## Privacy

When `features.usage` is **disabled** (the default), ccsl reads only local files (git state, transcript, config). No network requests are made and no credentials are accessed.

When `features.usage` is **enabled**, ccsl reads your Claude OAuth token from `~/.claude/.credentials.json` (or macOS Keychain) to query the Anthropic usage API. The token is used solely for this request and is never stored, logged, or transmitted elsewhere.

---

## See Also

- **[cctg](https://github.com/laveez/cctg)** — Claude Code Telegram Gate. Approve tool calls, answer questions, and send follow-up instructions from your phone. When installed, ccsl shows the cctg mode as a statusline badge (enable with `features.cctg: true`).

## Acknowledgments

Based on work by [Aaro Korhonen](https://github.com/aarokorhonen).

---

## Contributing

Contributions are welcome! This is a small project — open an issue or submit a PR.

```bash
git clone https://github.com/laveez/ccsl.git
cd ccsl
npm install
npm run dev    # Watch mode — rebuilds on change
```

## License

[MIT](LICENSE)
