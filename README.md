# pi-token-count

A focused Pi extension that replaces Pi's default footer with a pipe-separated footer that gives the current context token count its own field.

The footer shows current context tokens first, followed by percentage/context-window used, cost spent, and active model/reasoning as separate fields:

```text
84,000 tok | 7.6%/1.1M used | $0.60 spent | gpt-5.5/high
```

Pi's other default footer information is still preserved where possible: cwd, git branch, session name, provider when needed, and extension status lines.

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

- This extension replaces the whole footer because Pi's extension API exposes footer replacement via `ctx.ui.setFooter()` rather than patching individual built-in footer fields.
- The replacement footer intentionally mirrors Pi's default footer around the requested stats line: cwd, git branch, session name, model/provider, reasoning level, and extension status lines are preserved. Model and reasoning are combined at the end as `model/reasoning`.
- Right after compaction, Pi may not know the current post-compaction token count until the next assistant response. In that case the footer shows `? tok`.
