# pi-token-count

A focused Pi extension that shows the current context token count on Pi's extension status line, colored by a raw token threshold.

```text
84,000 tok   <other extension statuses>   <usage readout>
```

This is a fork of [oscabriel/pi-token-count](https://github.com/oscabriel/pi-token-count) that publishes the count through `ctx.ui.setStatus()` instead of replacing Pi's footer with `ctx.ui.setFooter()`. Pi has no API to patch individual built-in footer fields, and a replacement footer shadows every upstream footer change, so the count lives on the status line and Pi's built-in footer stays authoritative.

The current token count changes color based on a raw token threshold, not based on the context-window percentage:

- dim/default: below the warning threshold
- warning/yellow: at or above 75% of the dumb-zone token count by default
- error/red: at or beyond the dumb-zone token count

By default, the dumb-zone token count is computed the same way Pi's auto-compaction threshold is computed:

```text
contextWindow - compaction.reserveTokens
```

`compaction.reserveTokens` and `compaction.enabled` are read from Pi settings, including project overrides. You can also set an explicit raw dumb-zone token count for this extension.

## Configuration

### `/dumb-zone` command

Run the extension command from Pi's slash menu:

```text
/dumb-zone
```

With no arguments, it prompts for where to save the setting and then asks for the raw token count where the dumb zone starts.

You can also set it directly:

```text
/dumb-zone 160000
/dumb-zone project 160000
/dumb-zone global 160000
/dumb-zone project 160k
/dumb-zone global 1m
```

The command writes `piTokenCount.dumbZoneStartTokens` to either `.pi/settings.json` for the current project or `~/.pi/agent/settings.json` globally.

### Settings JSON

Use Pi's existing compaction settings when you want this extension to infer the dumb-zone boundary from the active model's context window:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 16384,
    "keepRecentTokens": 20000
  }
}
```

Or set an explicit raw token threshold for this extension manually:

```json
{
  "piTokenCount": {
    "dumbZoneStartTokens": 160000,
    "warningRatio": 0.75
  }
}
```

With that config, the current-token field turns yellow at `120,000 tok` and red at `160,000 tok`, regardless of the selected model's context-window percentage.

Global settings live at `~/.pi/agent/settings.json`; project settings live at `.pi/settings.json`. Project settings override global settings.

## Behavior notes

- The count is published with `ctx.ui.setStatus()` under the key `context-tokens` rather than replacing the footer with `ctx.ui.setFooter()`.
- Pi sorts the extension status line alphabetically by key. `context-tokens` is chosen to sort before pi-quotas' `pi-quotas-usage` entry, so the token count leads the line and the usage readout follows it.
- Because Pi's built-in footer is left in place, its own fields keep working and keep tracking upstream: input/output/cache token totals, cache-hit rate, subscription and auto-compaction markers, the experimental marker, and the routed-model indicator.
- Right after compaction, Pi may not know the current post-compaction token count until the next assistant response. In that case the status shows `? tok`.
