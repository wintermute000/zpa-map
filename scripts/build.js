#!/usr/bin/env node
// Turns a zpa-data.json snapshot into:
//   zpa-explorer.html  interactive app (drag boxes, click to highlight a chain)
//   zpa-map.dot        static Graphviz source
//   zpa-map.svg/.png   rendered, only if `dot` is installed
// Usage: node build.js <zpa-data.json> [outDir] [--prev <older zpa-data.json>]
// Prints validation warnings (these usually mean the data pull was truncated)
// and, with --prev, a summary of what changed since the older snapshot.
const fs = require("fs"), path = require("path"), cp = require("child_process");

const args = process.argv.slice(2);
const pi = args.indexOf("--prev");
const prevPath = pi >= 0 ? args.splice(pi, 2)[1] : null;
const [dataPath, outDirArg] = args;
if (!dataPath) { console.error("usage: node build.js <zpa-data.json> [outDir] [--prev old.json]"); process.exit(2); }
const outDir = path.resolve(outDirArg || path.dirname(path.resolve(dataPath)));
// Accepts the older schema too: segment.serverGroup (string) and serverGroups[name] as a plain array.
function normalize(R) {
  const N = { ...R };
  N.segments = (R.segments || []).map(s => ({ ...s, serverGroups: s.serverGroups || (s.serverGroup ? [s.serverGroup] : []) }));
  N.serverGroups = Object.fromEntries(Object.entries(R.serverGroups || {}).map(([g, v]) =>
    [g, Array.isArray(v) ? { connectorGroups: v } : { connectorGroups: v.connectorGroups || [], dynamic: v.dynamic }]));
  N.servers = (R.servers || []).map(h => ({ enabled: true, groups: [], ...h }));
  return N;
}
const D = normalize(JSON.parse(fs.readFileSync(dataPath, "utf8")));
const here = path.dirname(__filename);

// ---------- validate ----------
const warn = [];
const sgSet = new Set(D.segmentGroups);
const names = new Set();
for (const s of D.segments) {
  if (names.has(s.name)) warn.push(`duplicate segment name "${s.name}" (boxes would collide)`);
  names.add(s.name);
  if (!sgSet.has(s.group)) warn.push(`segment "${s.name}": segment group "${s.group}" not in segmentGroups`);
  if (!s.serverGroups.length) warn.push(`segment "${s.name}" has no server group (no connector path)`);
  for (const g of s.serverGroups) if (!(g in D.serverGroups)) warn.push(`segment "${s.name}": server group "${g}" not in serverGroups`);
}
for (const r of D.rules) for (const t of r.targets) {
  if (t.startsWith("app:")) { if (!names.has(t.slice(4))) warn.push(`rule #${r.order}: app segment "${t.slice(4)}" not in segments`); }
  else if (!sgSet.has(t)) warn.push(`rule #${r.order}: segment group "${t}" not in segmentGroups`);
}
const hostNames = new Set();
for (const [g, o] of Object.entries(D.serverGroups)) {
  if (!o.connectorGroups.length) warn.push(`server group "${g}" has no connector group`);
  if (o.dynamic === false && !D.servers.some(h => h.groups.includes(g))) warn.push(`server group "${g}" is static but has no servers`);
}
for (const h of D.servers) {
  if (hostNames.has(h.name)) warn.push(`duplicate server name "${h.name}" (boxes would collide)`);
  hostNames.add(h.name);
  if (!h.groups.length) warn.push(`server "${h.name}" (${h.address}) is in no server group, so no segment can reach it`);
  for (const g of h.groups) if (!(g in D.serverGroups)) warn.push(`server "${h.name}": server group "${g}" not in serverGroups`);
}

// ---------- dot ----------
const id = (p, s) => p + "_" + String(s).replace(/[^A-Za-z0-9]/g, "_");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ports = a => { const r = []; for (let i = 0; i < a.length; i += 2) { const f = +a[i], t = +(a[i + 1] ?? a[i]); const l = r[r.length - 1]; if (l && f === l[1] + 1) l[1] = t; else r.push([f, t]); } return r.map(([f, t]) => f === t ? f : f + "-" + t).join(", "); };
const C = { fg: "#1b2430", muted: "#5d6b7d", sg: "#dbe7ff", sgb: "#5b86d6", seg: "#ffffff", segb: "#6b7a8f", head: "#e9edf3", srv: "#dff3e6", srvb: "#3f9a63", con: "#fdebd3", conb: "#c9822b", host: "#e2f3f6", hostb: "#3a8fa3", idle: "#f0f1f3", idleb: "#a3acb8", rule: "#f3ecfb", ruleb: "#8a5cc7", allow: "#2e8b57", deny: "#c0392b" };
function buildDot() {
  const usedSG = new Set(D.segments.map(s => s.group)), usedSrv = new Set(D.segments.flatMap(s => s.serverGroups));
  const ruled = new Set(D.rules.flatMap(r => r.targets));
  const sgs = D.segmentGroups.filter(g => usedSG.has(g) || ruled.has(g));
  const srvs = Object.keys(D.serverGroups).filter(g => usedSrv.has(g));
  const cons = [...new Set(srvs.flatMap(g => D.serverGroups[g].connectorGroups))];
  const hosts = D.servers.filter(h => h.groups.some(g => srvs.includes(g)));
  const box = (n, fill, line) => `${n[0]}[label="${n[1]}";shape=box;style="rounded,filled";fillcolor="${fill}";color="${line}";penwidth=1.5;fontsize=17;margin="0.25,0.15"];\n`;
  let d = `digraph G{rankdir=LR;bgcolor="white";splines=ortho;nodesep=0.7;ranksep=2.4;newrank=true;fontname="Arial";\nnode[fontname="Arial";fontsize=15;fontcolor="${C.fg}"];edge[color="${C.segb}";arrowsize=0.7;penwidth=1.5];\n`;
  for (const r of D.rules) {
    const dn = r.action === "DENY", col = dn ? C.deny : C.allow, nid = id("rule", r.order);
    const who = r.who + (r.disabled ? " [DISABLED]" : "");
    d += `${nid}[shape=plain;label=<<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="6" COLOR="${dn ? C.deny : C.ruleb}" BGCOLOR="${C.rule}"><TR><TD ALIGN="LEFT"><B>#${r.order} ${esc(r.name)}</B> <FONT COLOR="${col}" POINT-SIZE="14"><B>${r.action}</B></FONT></TD></TR><TR><TD ALIGN="LEFT"><FONT POINT-SIZE="13" COLOR="${C.muted}">${esc(who)}</FONT></TD></TR></TABLE>>];\n`;
    const hub = r.targets.length >= 3 ? id("hub", r.order) : null, sty = dn ? "dashed" : "solid";
    if (hub) d += `${hub}[shape=point;width=0.09;color="${col}"];\n${nid}->${hub}[color="${col}";style=${sty};penwidth=1.8;arrowhead=none];\n`;
    for (const t of r.targets) d += `${hub || nid}->${t.startsWith("app:") ? id("seg", t.slice(4)) : id("sg", t)}[color="${col}";style=${sty};penwidth=1.8];\n`;
  }
  for (const g of sgs) { const idle = !usedSG.has(g); d += box([id("sg", g), g], idle ? C.idle : C.sg, idle ? C.idleb : C.sgb); }
  for (const s of D.segments) {
    const rows = s.domains.map(x => `<TR><TD ALIGN="LEFT" BORDER="0"><FONT POINT-SIZE="14">${esc(x)}</FONT></TD></TR>`).join("");
    const pr = `TCP ${ports(s.tcp) || "-"}` + (s.udp.length ? ` | UDP ${ports(s.udp)}` : "");
    d += `${id("seg", s.name)}[shape=plain;label=<<TABLE BORDER="1" CELLBORDER="0" CELLSPACING="0" CELLPADDING="6" COLOR="${C.segb}" BGCOLOR="${C.seg}"><TR><TD BGCOLOR="${C.head}" ALIGN="LEFT"><B>${esc(s.name)}</B></TD></TR>${rows}<TR><TD ALIGN="LEFT" BORDER="0"><FONT POINT-SIZE="13" COLOR="${C.muted}">${esc(pr)}</FONT></TD></TR></TABLE>>];\n`;
    d += `${id("sg", s.group)}->${id("seg", s.name)};\n`;
    for (const g of s.serverGroups) d += `${id("seg", s.name)}->${id("srv", g)};\n`;
  }
  for (const g of srvs) { d += box([id("srv", g), g], C.srv, C.srvb); for (const c of D.serverGroups[g].connectorGroups) d += `${id("srv", g)}->${id("con", c)};\n`; }
  for (const h of hosts) { d += `${id("host", h.name)}[shape=box;style="rounded,filled";fillcolor="${C.host}";color="${C.hostb}";penwidth=1.5;fontsize=15;margin="0.25,0.15";label="${h.name}\\n${h.address}"];\n`; for (const g of h.groups) if (srvs.includes(g)) d += `${id("srv", g)}->${id("host", h.name)};\n`; }
  for (const c of cons) d += box([id("con", c), c], C.con, C.conb);
  d += `{rank=same;${D.rules.map(r => id("rule", r.order)).join(";")}}\n{rank=same;${sgs.map(g => id("sg", g)).join(";")}}\n{rank=same;${srvs.map(g => id("srv", g)).join(";")}}\n}`;
  return d;
}

// ---------- outputs ----------
fs.mkdirSync(outDir, { recursive: true });
const dotFile = path.join(outDir, "zpa-map.dot");
fs.writeFileSync(dotFile, buildDot());
const haveDot = cp.spawnSync("dot", ["-V"]).status === 0;
let ORDER = {};
if (haveDot) {
  for (const l of cp.execFileSync("dot", ["-Tplain", dotFile], { maxBuffer: 1 << 26 }).toString().split("\n")) {
    const p = l.split(" "); if (p[0] === "node") ORDER[p[1]] = +p[3];
  }
  cp.execFileSync("dot", ["-Tsvg", dotFile, "-o", path.join(outDir, "zpa-map.svg")]);
  cp.execFileSync("dot", ["-Tpng", "-Gdpi=90", dotFile, "-o", path.join(outDir, "zpa-map.png")]);
} else warn.push("graphviz `dot` not found: skipped svg/png, and the explorer opens with an unsorted starting layout (still fully draggable)");
const tpl = fs.readFileSync(path.join(here, "..", "assets", "explorer.tpl.html"), "utf8");
fs.writeFileSync(path.join(outDir, "zpa-explorer.html"),
  tpl.replace("/*__DATA__*/", () => JSON.stringify(D)).replace("/*__ORDER__*/", () => JSON.stringify(ORDER)));

console.log(`wrote ${outDir}: zpa-explorer.html, zpa-map.dot${haveDot ? ", zpa-map.svg, zpa-map.png" : ""}`);
console.log(`${D.segmentGroups.length} segment groups, ${D.segments.length} segments, ${Object.keys(D.serverGroups).length} server groups, ${D.servers.length} servers, ${D.rules.length} rules`);

// ---------- diff vs previous snapshot ----------
if (prevPath && fs.existsSync(prevPath)) {
  const P = normalize(JSON.parse(fs.readFileSync(prevPath, "utf8")));
  const diff = (label, a, b, key, sig) => {
    const A = new Map(a.map(x => [key(x), sig(x)])), B = new Map(b.map(x => [key(x), sig(x)]));
    const add = [...B.keys()].filter(k => !A.has(k)), del = [...A.keys()].filter(k => !B.has(k));
    const chg = [...B.keys()].filter(k => A.has(k) && A.get(k) !== B.get(k));
    if (add.length || del.length || chg.length) console.log(`${label}: +${add.length} -${del.length} ~${chg.length}` + [...add.map(k => `\n  + ${k}`), ...del.map(k => `\n  - ${k}`), ...chg.map(k => `\n  ~ ${k}`)].join(""));
  };
  console.log(`\nChanges since ${P.generated || prevPath}:`);
  diff("segment groups", P.segmentGroups, D.segmentGroups, x => x, x => "");
  diff("segments", P.segments, D.segments, s => s.name, s => JSON.stringify([s.group, s.serverGroups, s.domains, s.tcp, s.udp]));
  diff("server groups", Object.entries(P.serverGroups), Object.entries(D.serverGroups), e => e[0], e => JSON.stringify(e[1]));
  diff("servers", P.servers, D.servers, h => h.name, h => JSON.stringify([h.address, h.groups, h.enabled]));
  diff("rules", P.rules, D.rules, r => r.name, r => JSON.stringify([r.order, r.action, r.who, r.targets, !!r.disabled]));
  console.log("(end of changes)");
}
if (warn.length) console.log("\nWARNINGS:\n" + warn.map(w => "  - " + w).join("\n"));
