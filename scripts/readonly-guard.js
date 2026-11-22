#!/usr/bin/env node
// PreToolUse guard for the zpa-map skill. Runs before every Zscaler MCP call
// made while the skill is active and blocks anything not on the allowlist.
// Allowlist, not blocklist: a new or renamed write tool is denied by default.
// Exit 2 = block the call and show stderr to Claude.
// Server name varies by install ("zs" if you registered it yourself, a long
// plugin_zscaler_... name from the default plugin), so match on the tool suffix.
const ALLOWED = new Set([
  "zpa_list_segment_groups",
  "zpa_list_application_segments",
  "zpa_list_server_groups",
  "zpa_list_access_policy_rules",
  "zpa_list_application_servers",
]);
let raw = "";
process.stdin.on("data", c => raw += c);
process.stdin.on("end", () => {
  let name = "";
  try { name = JSON.parse(raw).tool_name || ""; } catch (e) {
    console.error("zpa-map guard: could not parse hook input, blocking to be safe");
    process.exit(2);
  }
  const m = name.match(/^mcp__.+?__(zpa_[a-z_]+)$/);
  if (m && ALLOWED.has(m[1])) process.exit(0);
  console.error(`zpa-map is read-only. Blocked ${name}. Allowed tools: ${[...ALLOWED].join(", ")}. ` +
    "Tell the user this change is outside the zpa-map skill; do not retry or use another tool to make it.");
  process.exit(2);
});
