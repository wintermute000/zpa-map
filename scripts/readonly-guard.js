#!/usr/bin/env node
// PreToolUse guard for the zpa-map skill. Runs before every Zscaler MCP call
// made while the skill is active and blocks anything not on the allowlist.
// Allowlist, not blocklist: a new or renamed write tool is denied by default.
// Exit 2 = block the call and show stderr to Claude.
const ALLOWED = new Set([
  "mcp__plugin_zscaler_zs__zpa_list_segment_groups",
  "mcp__plugin_zscaler_zs__zpa_list_application_segments",
  "mcp__plugin_zscaler_zs__zpa_list_server_groups",
  "mcp__plugin_zscaler_zs__zpa_list_access_policy_rules",
  "mcp__plugin_zscaler_zs__zpa_list_application_servers",
]);
let raw = "";
process.stdin.on("data", c => raw += c);
process.stdin.on("end", () => {
  let name = "";
  try { name = JSON.parse(raw).tool_name || ""; } catch (e) {
    console.error("zpa-map guard: could not parse hook input, blocking to be safe");
    process.exit(2);
  }
  if (ALLOWED.has(name)) process.exit(0);
  console.error(`zpa-map is read-only. Blocked ${name}. Allowed tools: ${[...ALLOWED].map(t => t.split("__").pop()).join(", ")}. ` +
    "Tell the user this change is outside the zpa-map skill; do not retry or use another tool to make it.");
  process.exit(2);
});
