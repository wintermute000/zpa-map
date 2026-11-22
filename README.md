# zpa-map

A Claude Code skill that draws your Zscaler Private Access (ZPA) tenant as an interactive map and a static diagram, and tells you what changed each time you run it.

It shows how access policy rules, segment groups, application segments (with the apps and ports inside them), server groups, the individual servers in them and app connector groups connect.

- `zpa-explorer.html`: a self-contained web app. Drag boxes around, click one to highlight everything upstream and downstream of it, search by name, domain or port, pan and zoom. No network or dependencies needed to open it.
- `zpa-map.svg` / `zpa-map.png` / `zpa-map.dot`: a static Graphviz diagram (needs Graphviz installed).
- A change report against the previous run: segments, servers, server groups and rules added, removed or modified, plus warnings (for example a server group with no connector group, or a server that is in no server group).

## Read-only

The skill only reads your tenant. A `PreToolUse` hook (`scripts/readonly-guard.js`) is registered in the skill's frontmatter and blocks every Zscaler MCP call (any server name) except five list tools:

`zpa_list_segment_groups`, `zpa_list_application_segments`, `zpa_list_server_groups`, `zpa_list_application_servers`, `zpa_list_access_policy_rules`

It is an allowlist, so new or renamed write tools are denied by default. Limits: it only covers Zscaler MCP tools, so it does not stop a `curl` to the Zscaler API from Bash; the skill text forbids that but nothing enforces it. The guard script has been tested on its own (allowed and blocked tool names, bad input). After installing, confirm once that Claude Code runs the frontmatter hook: run `/zpa-map`, then ask it to activate the ZIA config and check the call is blocked.

## Requirements

- [Claude Code](https://claude.com/claude-code) with the [Zscaler MCP server](https://github.com/zscaler/zscaler-mcp-server) connected
- MCP server name: the hook and skill text work with any server name, but `allowed-tools` in `SKILL.md` lists full tool names and ships with `mcp__plugin_zscaler_zs__*`. Check yours with `/mcp` or the tool list (`mcp__<server>__zpa_list_segment_groups`) and edit `allowed-tools` to match (e.g. `mcp__zs__zpa_list_segment_groups`). Without a match you just get permission prompts; the guard still enforces read-only.
  I register the server myself as `zs`: the default Claude plugin install gives it a long name (`plugin_zscaler_zs`), and the resulting long tool names break tool calls.
- Node.js (runs `scripts/build.js` and the guard)
- Graphviz `dot` (optional): without it you get no svg/png and the explorer starts with an unsorted layout

## Install

```
git clone https://github.com/wintermute000/zpa-map ~/.claude/skills/zpa-map
```

Restart Claude Code (or reload skills) so it picks up the skill. The `SKILL.md` frontmatter hook and the build command assume the path `~/.claude/skills/zpa-map`. If you install somewhere else, update both.

## Use

In a folder where you want the output, tell Claude "refresh the ZPA map" or run `/zpa-map`. Claude will:

1. Copy the existing `zpa-data.json` (if any) to `zpa-data.prev.json`, which the change report compares against. The first run has nothing to compare.
2. Pull the five datasets from the tenant (read-only, `page_size: 500`).
3. Write `zpa-data.json`, a plain snapshot of the tenant.
4. Run `scripts/build.js`, which writes the outputs and prints the change report and warnings.

Outputs are written to the folder you run it in, not into the skill folder. Open `zpa-explorer.html` in a browser. Boxes you drag keep their positions across rebuilds (stored in that browser, keyed by box name). "Reset layout" restores the generated layout.

To rebuild from an existing snapshot without re-pulling, for example after editing it by hand:

```
node ~/.claude/skills/zpa-map/scripts/build.js zpa-data.json . --prev zpa-data.prev.json
```

## Data format

`zpa-data.json` is a plain JSON snapshot: `segmentGroups`, `segments` (with `serverGroups`, domains and ports), `serverGroups` (connector groups and static vs dynamic), `servers`, and `rules` (action, who, targets). The exact schema and an example are at the bottom of `SKILL.md`. Snapshots from earlier versions of the skill still build.

## Files

| File | Purpose |
|---|---|
| `SKILL.md` | The instructions Claude follows: exact tool calls, the data format, how to summarise rule conditions, the read-only rules |
| `scripts/build.js` | Reads `zpa-data.json` and writes the outputs. Validates references and diffs against an older snapshot |
| `scripts/readonly-guard.js` | The hook that blocks any Zscaler call outside the allowlist |
| `assets/explorer.tpl.html` | Template for the interactive app; the snapshot is embedded at build time |

## Data and privacy

`zpa-data.json` and the generated files contain your internal hostnames, IPs and policy structure, so keep them local. They are written to your working folder, not this repository. The `.gitignore` in the skill folder is only a safety net in case you run the build from inside a clone. If you commit your own outputs, use a private repository.

## Known gotcha

ZPA list calls return a partial page by default with no error (one real run returned 19 of 44 segments). The skill always asks for `page_size: 500` and `build.js` warns when references do not resolve, which is the usual sign of a truncated pull.
