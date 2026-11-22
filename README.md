# zpa-map

A Claude Code skill that draws your Zscaler Private Access (ZPA) tenant as an interactive map and a static diagram, and tells you what changed each time you run it.

It shows how access policy rules, segment groups, application segments (with the apps and ports inside them), server groups and app connector groups connect.

- `zpa-explorer.html`: a self-contained web app. Drag boxes around, click one to highlight everything upstream and downstream of it, search by name, domain or port, pan and zoom. No network or dependencies needed to open it.
- `zpa-map.svg` / `zpa-map.png` / `zpa-map.dot`: a static Graphviz diagram (needs Graphviz installed).
- A change report against the previous run: segments, server groups and rules added, removed or modified, plus warnings (for example a server group with no connector group).

## Read-only

The skill only reads your tenant. A `PreToolUse` hook (`scripts/readonly-guard.js`) is registered in the skill's frontmatter and blocks every Zscaler MCP call except four list tools:

`zpa_list_segment_groups`, `zpa_list_application_segments`, `zpa_list_server_groups`, `zpa_list_access_policy_rules`

It is an allowlist, so new or renamed write tools are denied by default. Limits: it only covers Zscaler MCP tools, so it does not stop a `curl` to the Zscaler API from Bash; the skill text forbids that but nothing enforces it.

## Requirements

- [Claude Code](https://claude.com/claude-code) with the Zscaler MCP plugin connected (tools named `mcp__plugin_zscaler_zs__*`)
- Node.js (runs `scripts/build.js` and the guard)
- Graphviz `dot` (optional): without it you get no svg/png and the explorer starts with an unsorted layout

## Install

```
git clone https://github.com/wintermute000/zpa-map ~/.claude/skills/zpa-map
```

Restart Claude Code (or reload skills) so it picks up the skill. If you install somewhere else, update the hook path in the `SKILL.md` frontmatter and the `build.js` command in the steps.

## Use

In a folder where you want the output, tell Claude "refresh the ZPA map" or run `/zpa-map`. Claude will:

1. Copy the existing `zpa-data.json` to `zpa-data.prev.json`.
2. Pull the four datasets from the tenant (read-only, `page_size: 500`).
3. Write `zpa-data.json`, a plain snapshot of the tenant.
4. Run `scripts/build.js`, which writes the outputs and prints the change report and warnings.

Open `zpa-explorer.html` in a browser. Boxes you drag keep their positions across rebuilds (stored in that browser, keyed by box name). "Reset layout" restores the generated layout.

To rebuild from an existing snapshot without re-pulling, for example after editing it by hand:

```
node ~/.claude/skills/zpa-map/scripts/build.js zpa-data.json . --prev zpa-data.prev.json
```

## Files

| File | Purpose |
|---|---|
| `SKILL.md` | The instructions Claude follows: exact tool calls, the data format, how to summarise rule conditions, the read-only rules |
| `scripts/build.js` | Reads `zpa-data.json` and writes the outputs. Validates references and diffs against an older snapshot |
| `scripts/readonly-guard.js` | The hook that blocks any Zscaler call outside the allowlist |
| `assets/explorer.tpl.html` | Template for the interactive app; the snapshot is embedded at build time |

## Data and privacy

`zpa-data.json` and the generated files contain your internal hostnames, IPs and policy structure. They are listed in `.gitignore` so they are not committed by accident. Keep them local.

## Known gotcha

ZPA list calls return a partial page by default with no error (one real run returned 19 of 44 segments). The skill always asks for `page_size: 500` and `build.js` warns when references do not resolve, which is the usual sign of a truncated pull.
