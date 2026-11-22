---
name: zpa-map
description: Rebuild the ZPA map from the live tenant. Pulls segment groups, app segments, server groups and access policy rules through the Zscaler MCP plugin (read-only), then generates an interactive HTML explorer (drag boxes, click to highlight a chain) plus a static Graphviz diagram, and reports what changed since the last run. Use when asked to draw, refresh, update or diff the ZPA diagram or segment map.
allowed-tools: mcp__plugin_zscaler_zs__zpa_list_segment_groups mcp__plugin_zscaler_zs__zpa_list_application_segments mcp__plugin_zscaler_zs__zpa_list_server_groups mcp__plugin_zscaler_zs__zpa_list_access_policy_rules
hooks:
  PreToolUse:
    - matcher: "mcp__plugin_zscaler_zs__.*"
      hooks:
        - type: command
          command: "node \"$HOME/.claude/skills/zpa-map/scripts/readonly-guard.js\""
---

# ZPA map

Snapshot the tenant into one JSON file, then build outputs from it with a script. Claude does the pulling and summarising; `scripts/build.js` does all rendering, so the outputs are identical every run.

## Hard rules

- **Read-only, enforced.** A `PreToolUse` hook in this skill's frontmatter (`scripts/readonly-guard.js`) blocks every Zscaler MCP call except the four list tools below, so a write attempt fails with an error instead of reaching the tenant. It is an allowlist: new or renamed tools are denied by default. Do not try to work around a block. The hook only covers Zscaler MCP tools, so also never call the Zscaler API through Bash/curl. Use only the `list`/`get` tools below. Never call any `zpa_create_*`, `zpa_update_*`, `zpa_delete_*`, `zpa_bulk_*` or any `zia_*` write tool, even if asked mid-run. If the user wants a change made to the tenant, stop and say it is outside this skill.
- The output contains internal hostnames, IPs and policy structure. Keep it as local files. Do not publish it as an artifact or paste it anywhere external unless the user asks.
- Do not put secrets in the data file. The rule/segment queries below do not return any; keep it that way.

## Step 1: choose the folder

Use the current directory unless the user names one. If `zpa-data.json` already exists there, copy it to `zpa-data.prev.json` first (overwrite the old prev). That file is what the change report compares against.

## Step 2: pull the four datasets

All four calls need `page_size: 500`. The default page silently returns only a partial list (a real run returned 19 of 44 segments with no error). After each pull, sanity check the count with a second call using `query: "length(@)"` if the result looks smaller than expected.

Tool prefix: `mcp__plugin_zscaler_zs__`

1. `zpa_list_segment_groups`, `page_size: 500`, `query: "[*].name"`
2. `zpa_list_application_segments`, `page_size: 500`, `query: "[*].{n:name,g:segment_group_name,s:server_groups[0].name,d:domain_names,t:tcp_port_ranges,u:udp_port_ranges,on:enabled}"`
3. `zpa_list_server_groups`, `page_size: 500`, `query: "[*].{n:name,c:app_connector_groups[*].name}"`
4. `zpa_list_access_policy_rules`, `page_size: 500`, `query: "[*].{o:rule_order,n:name,a:action,off:disabled,tgt:conditions[].operands[?object_type=='APP_GROUP' || object_type=='APP'][].[object_type,name],who:conditions[].operands[?object_type!='APP_GROUP' && object_type!='APP'][].[object_type,name,idp_name]}"`

If a result is too big to show and the tool prints a file path for the full output, read that file (for example with `node -e`) instead of retyping or re-running the call.

## Step 3: write `zpa-data.json`

Schema (see the example at the bottom):

- `generated`: today's date, `YYYY-MM-DD`
- `segmentGroups`: array of names (from call 1)
- `segments`: `{name, group, serverGroup, domains[], tcp[], udp[]}` from call 2 (`n, g, s, d, t, u`). `tcp`/`udp` stay as ZPA gives them: a flat list of from/to pairs, `["22","22","80","80"]`. `serverGroup` is `null` if the segment has none. Skip segments where `on` is false only if the user asks; otherwise keep them.
- `serverGroups`: object mapping server group name to an array of connector group names (call 3). Empty array when none.
- `rules`: `{order, name, action, who, targets[], disabled}` from call 4, sorted by `o` as a number.
  - `action`: `"ALLOW"` or `"DENY"`.
  - `disabled`: `true` when `off` is `"1"`.
  - `targets`: segment group names from `APP_GROUP` entries, and `"app:<segment name>"` for `APP` entries. Leave `[]` when the rule has no app condition (it then applies to any app).
  - `who`: one short human line built from the `who` entries, de-duplicated:
    - `SCIM_GROUP` / `SAML_GROUP`: `SCIM groups: <unique IdP names>`
    - `CLIENT_TYPE`: translate (`zpn_client_type_zapp` Client Connector, `..._browser_isolation` Browser isolation, `..._exporter` exporter, `..._machine_tunnel` machine tunnel, `..._edge_connector` Cloud Connector, `..._branch_connector` Branch Connector, `..._vdi` VDI, `..._ip_anchoring` IP anchoring). If there are more than 4 types, write `N client types (a, b, ...)`.
    - `BRANCH_CONNECTOR_GROUP`: `Branch connector grps: <names>`
    - `EDGE_CONNECTOR_GROUP`: `N Cloud Connector groups`
    - `MACHINE_GRP`: `Machine group: <name>`
    - `EXTRANET_LOCATION_GROUP`: `Extranet location grp: <name>`
    - anything else (posture, trusted network, country, platform): `<TYPE>: <names>`
    - join several kinds with ` + `. No non-app conditions: `any user`. No app conditions: append ` (no app condition: any app)`.
- Long port lists: merge consecutive ports into ranges before writing (50000 to 50049 becomes `["50000","50049"]`). The builder also collapses them for display, but this keeps the file small.

## Step 4: build

```
node ~/.claude/skills/zpa-map/scripts/build.js zpa-data.json . --prev zpa-data.prev.json
```

Omit `--prev` on the first run. This writes `zpa-explorer.html`, `zpa-map.dot`, and (if Graphviz is installed) `zpa-map.svg` and `zpa-map.png`.

## Step 5: report

- Show the "Changes since" block from the script output (added/removed/changed segments, server groups, rules). If nothing changed, say so.
- Show the WARNINGS. They are real findings about the tenant (for example a server group with no connector group) or signs of a truncated pull (a segment whose group is missing). If it looks like truncation, redo Step 2 for that dataset with `page_size: 500` and rebuild.
- Tell the user to open `zpa-explorer.html`. Mention the png/svg if made.
- Optionally view `zpa-map.png` to check the static diagram rendered sensibly.

## Notes

- Layout positions the user drags in the explorer are saved in that browser, keyed by box name. After a rebuild, existing boxes keep their positions and new ones are placed automatically. "Reset layout" restores the generated layout.
- `dot` (Graphviz) is optional. Without it the explorer still works but starts with an unsorted layout.
- Segment names must be unique; the builder warns on duplicates.

## Example `zpa-data.json`

```json
{
  "generated": "2026-11-22",
  "segmentGroups": ["Web SegGrp", "Zscaler Deception"],
  "segments": [
    {"name": "Intranet Wiki", "group": "Web SegGrp", "serverGroup": "Web SrvGrp",
     "domains": ["wiki.example.com"], "tcp": ["80","80","443","443"], "udp": []}
  ],
  "serverGroups": {"Web SrvGrp": ["Web ConnGrp"]},
  "rules": [
    {"order": 13, "name": "Allow Staff to Web Apps", "action": "ALLOW",
     "who": "SCIM groups: Okta", "targets": ["Web SegGrp"], "disabled": false}
  ]
}
```
