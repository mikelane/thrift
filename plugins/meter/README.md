# meter

A side pane that shows what a session costs while you work: context fill, how fast you are
burning the 5-hour and weekly rate-limit windows, the session cost, and the largest parts of the
context. The pane is drawn outside the model's context, so it adds no tokens to any turn.

It needs Claude Code 2.1.302 or newer, whose `$.session.usage()`, `session.measure` event and
`$.ui.open` pane it uses.

```
┌ meter ─────────────────────────────────────────┐
│ ◔ CONTEXT   142k / 200k   85% of 167k           │  yellow
│   compacts at 167k  ·  cache hit 96%            │
│                                                 │
│ ◷ 5-HOUR   48%  ·  62% of window elapsed        │  green
│   pace 0.77×  ●  resets 4:15pm                  │
│                                                 │
│ ⧖ WEEKLY   71%  ·  43% of window elapsed        │  red
│   pace 1.66×  ●  hits 100% Wed 2:25pm, resets Sat 9:00am
│                                                 │
│ ¢ COST   $4.82 this session                     │
│                                                 │
│ TOP CONTEXT  ↻ [r] refresh  · 3m ago            │
│   Messages      88k  ██████                     │
│   MCP tools     21k  █▌                         │
│   Custom agents 14k  █                          │
│   Skills         8k  ▌                          │
│   Memory files   6k  ▌                          │
│   ⬡ mcp servers: github 9k, ha 6k               │
└─────────────────────────────────────────────────┘
```

## Opening and closing

- `/meter` toggles the pane. If a `meter` pane is listed by `$.ui.panes()`, placed or not, it
  closes. Otherwise it opens. A pane opened from `/meter` counts as asked, so the engine places it
  from 110 terminal columns. Narrower than that it waits undrawn, which is not an error and writes
  nothing to the debug log.
- `/meter refresh` takes a full count (see Refresh policy). It works without focus. While the pane
  is closed it opens the pane and takes the full count in place of the open-time summary.
- Any other argument answers with a usage line and changes nothing.
- The setting `meterAutoOpen` (default `false`) opens the pane at session start. An unasked pane is
  placed only from 144 columns; narrower, it waits for `/meter`.
- In non-interactive runs (`-p`) no command is registered and nothing opens.
- `/clear` fires `session.end` with `reason: "clear"` and no `session.start` follows, so the plugin
  registers `/meter` again inside `$.clock.after(0, ...)`. The cost ledger and `startedAt` restart
  at a clear, so the COST row restarts too. Whether the pane itself stays open across a clear is
  not stated by the declarations and has not been checked live.

## Definitions

- **Elapsed share** of a window: `(windowLength - (resetsAt - now)) / windowLength`, with
  `windowLength` 5 h for `five_hour` and 7 d for `seven_day`. A `resetsAt` in the past, missing, or
  not a date gives no elapsed share. The share is clamped to [0, 1], so a `resetsAt` more than one
  window ahead (clock skew) gives 0, which reads as too early.
- **Too early**: elapsed share below 0.05. At exactly 0.05 pace is computed. The row shows the
  percent and `too early` in place of pace, and is uncolored.
- **Pace**: `percentUsed / (100 x elapsed share)`. Colored from the unrounded value: green below
  0.9, yellow from 0.9 to 1.1 inclusive, red above 1.1. Displayed rounded to two places.
- **Projection**: only when pace is above 1, which is exactly when the limit runs out before the
  reset: `now + (100 - percentUsed) x (elapsedTime / percentUsed)`, drawn as `hits 100% <time>`.
- **Limit reached**: a `five_hour` or `seven_day` window at `percentUsed` 100 or more is red and
  reads `limit reached` with its reset time. No pace and no projection are shown. This wins over a
  missing or past `resetsAt`: the row is still red and reads `limit reached`, with no reset time.
- **A window with no usable reset time** shows its percent only: no pace, color or projection.
- **`spend_limit`** and any other window kind have no known length, so no pace or projection. Red
  when `percentUsed` is 100 or more, otherwise uncolored.
- **Context color**: fill is `tokens / threshold` when an auto-compact threshold is cached from a
  breakdown, else `tokens / window`. Green below 70%, yellow from 70% to 90% inclusive, red above
  90%. The plain call's `tokens` is compared, never the breakdown's `totalTokens`. The percent is
  not capped, so a context over the window reads above 100%. Before the first response the row
  reads `waiting for first response` and is uncolored.
- **Without color**: every band is computed from a figure the row prints (the context percent, the
  pace), so the thresholds above give the band in a monochrome terminal or to a screen reader. The
  band name itself is not printed, and the `●` after the pace carries only the band color.
- **Cache hit**: `cache_read_input_tokens / (input_tokens + cache_read_input_tokens +
  cache_creation_input_tokens)`, as a whole percent. Shown as `cache hit —` when `apiUsage` is
  null, no breakdown has been taken, or the denominator is 0.
- **TOP CONTEXT rows**: categories with `kind === "used"` (never matched by name), largest first,
  ties by name in code-point order, at most 5. Each row shows the category's name unchanged, as
  `/context` prints it. A bar is drawn per row, scaled to the largest row, in half blocks.
- **MCP servers line**: its own line under the rows. It sums `mcpTools[].tokens` per server,
  counting only tools with `isLoaded: true`, and lists the 2 largest, ties by server name. It is
  drawn whether or not the MCP category is used, deferred or absent, and omitted when no loaded
  tool remains.
- **Age label** of the breakdown: `<n>s ago` under 60 s, `<n>m ago` under 60 min, `<n>h ago`
  beyond.
- **Clock labels**: `h:mma` when the time is today, `ddd h:mma` otherwise, in local time, rounded
  to the nearest minute with half a minute rounding up.

## Refresh policy

- **On open**: one plain `$.session.usage()` call for the headline figures and one
  `breakdown: "summary"` call for the cached figures. A summary is a local estimate with no
  network request.
- **On `session.measure`** (while the pane is open): the headline rows redraw from the event's own
  `context`, `rateLimits` and `cost`. No `$.session.usage()` call.
- **Throttled summary**: when the event's `changed` includes `context` and the last breakdown is
  60 s old or older, a `breakdown: "summary"` call refreshes the cached figures. The threshold, the
  cache hit and TOP CONTEXT come only from a breakdown.
- **Explicit refresh**: the `[r] refresh` button and `/meter refresh` call `breakdown: "full"`.
  A full count sends one token-count API request per tool and per memory file, as `/context`
  does. The `r` hotkey fires only while the pane has focus (ctrl+x tab, a click, or opening with
  focus); typing `r` in the composer does nothing.
- **A failed reading** (the plain call on open, a summary or a full breakdown) goes to the debug
  log as `meter: ...` and marks the TOP CONTEXT header `stale`. The pane keeps its last figures,
  and the turn is never affected. The marker clears on the next successful breakdown.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `meterAutoOpen` | `false` | Opens the pane at session start. |
| `meterGlyphs` | `unicode` | `unicode` or `nerd`. Any other stored value is treated as unset by the engine, so the default applies. |

## Glyph sets

Each slot is preceded by its glyph and one space. A plugin cannot detect the terminal's font and
Nerd Font glyphs draw as boxes without a patched font, so `unicode` is the default and `nerd` is
opt-in. Glyphs sit only at the start of a slot's text, never between a value and the bar or figure
after it; the TOP CONTEXT category rows get none. The bars and the status dot are the same in both
sets. Every glyph is a single code point.

| Slot | `unicode` | `nerd` (Nerd Fonts class, codepoint) |
|---|---|---|
| CONTEXT label | `◔` U+25D4 | `nf-fa-database` U+F1C0 |
| 5-HOUR label | `◷` U+25F7 | `nf-fa-clock_o` U+F017 |
| WEEKLY label | `⧖` U+29D6 | `nf-fa-calendar` U+F073 |
| COST label | `¢` U+00A2 | `nf-fa-dollar` U+F155 |
| Refresh button label | `↻` U+21BB | `nf-fa-refresh` U+F021 |
| MCP servers line | `⬡` U+2B21 | `nf-fa-plug` U+F1E6 |
| `stale` marker | `⚠` U+26A0 | `nf-fa-warning` U+F071 |
| `limit reached` | `✕` U+2715 | `nf-fa-ban` U+F05E |

All `nf-fa-*` codepoints are unchanged between Nerd Fonts v2 and v3. The Nerd Font codepoints and
the shared `█ ▌ ●` are East Asian Width ambiguous, so they may take two cells in a CJK locale; the
plugin does not correct for that.

## What it does not do

It makes no decisions, so it has no `off`/`ask`/`act` mode and writes nothing to
`decisions.jsonl`. It writes nothing into the model's context. It shows the live session only: no
history, no charts, no cache-expiry countdown, no action such as compaction or handoff. Layout and
thresholds are fixed.

## What has been verified live

Nothing yet. The unit and testing-kit tests cover the numbers, the text each row draws, the
refresh policy and the hooks. These still need a check in a real terminal:

- `/meter` opens the pane, and a second `/meter` closes it.
- The pane redraws after a turn.
- `r` refreshes it while the pane has focus.
- Both glyph sets draw with the labels aligned (`unicode` in the default font, `nerd` in a Nerd
  Font).
- Whether the pane stays open across `/clear`.
