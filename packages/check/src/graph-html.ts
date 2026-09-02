import type { ComponentGraph } from "./graph";

/**
 * The graph as one self-contained HTML file.
 *
 * `--graph` already writes everything this needs — 168 nodes and 259 edges on `apps/docs` — and a
 * JSON file of that size answers a question nobody can hold in their head. This is a READER for it,
 * not a second analysis: it adds no data and computes nothing the checker did not already decide.
 *
 * ## Why one file, and why no dependency
 *
 * A graph is looked at when something is wrong, which is often the moment there is no network and
 * no patience for a server. One `.html` opened by double-click has neither problem. It also travels:
 * attached to an issue, it is the same picture the reporter saw.
 *
 * No layout library, and that is a size decision rather than a purity one — a force-directed graph
 * of 168 nodes is a cloud, and the thing worth seeing here is DEPTH FROM THE ROOTS. That is a
 * layered layout, which is a breadth-first walk and some arithmetic.
 *
 * ## What the picture says that the JSON does not
 *
 * - **Distance from a root**, as the row a node sits in. The graph's own question — "what mounts
 *   this?" — is read by going up.
 * - **What nothing reaches.** Unreachable nodes have no row, so they get a band of their own rather
 *   than being drawn at depth 0 as if they were roots. That distinction is the whole point of the
 *   `unreachable` report, and drawing them together would erase it.
 * - **A conditional render.** `always: false` is an edge the analyzer already distinguishes and
 *   nothing else surfaces. Drawn dashed: a path that exists in the source and may never be taken.
 */
export function graphHtml(graph: ComponentGraph): string {
  const data = JSON.stringify(graph);
  return `<!doctype html>
<meta charset="utf-8">
<title>${escapeHtml(graph.package.name)} — component graph</title>
<style>
  :root {
    --bg: #fff; --fg: #24292e; --line: #d0d7de; --muted: #57606a; --panel: #f6f8fa;
    --root: #0969da; --component: #1a7f37; --hook: #8250df; --context: #bf3989; --helper: #6e7781;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1117; --fg: #e6edf3; --line: #30363d; --muted: #8b949e; --panel: #161b22;
      --root: #58a6ff; --component: #3fb950; --hook: #bc8cff; --context: #f778ba; --helper: #8b949e;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
         font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  header { position: sticky; top: 0; z-index: 2; background: var(--panel);
           border-bottom: 1px solid var(--line); padding: 10px 14px;
           display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  h1 { font-size: 14px; margin: 0; font-weight: 600; }
  .count { color: var(--muted); }
  label { display: inline-flex; gap: 5px; align-items: center; cursor: pointer; user-select: none; }
  .key { display: inline-flex; gap: 12px; color: var(--muted); flex-wrap: wrap; }
  .key i { font-style: normal; display: inline-flex; gap: 4px; align-items: center; }
  .swatch { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
  #wrap { overflow: auto; }
  text { fill: var(--fg); font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .band { fill: var(--muted); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
  .edge { stroke: var(--line); fill: none; }
  .edge.sometimes { stroke-dasharray: 3 3; }
  .edge.unresolved { stroke: #d1242f; }
  .node rect { rx: 3; fill: var(--panel); stroke: var(--line); cursor: pointer; }
  .node.on rect { stroke-width: 2; }
  .node.dim { opacity: .18; }
  .edge.dim { opacity: .06; }
  #detail { position: fixed; right: 12px; bottom: 12px; max-width: 42ch; padding: 10px 12px;
            background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
            display: none; }
  #detail b { display: block; margin-bottom: 4px; }
  #detail code { color: var(--muted); font-size: 11px; word-break: break-all; }
</style>
<header>
  <h1>${escapeHtml(graph.package.name)} <span class="count" id="tally"></span></h1>
  <label><input type="checkbox" id="hideHelpers"> hide helpers</label>
  <label><input type="checkbox" id="onlyLost"> only what nothing reaches</label>
  <span class="key">
    <i><span class="swatch" style="background:var(--root)"></span>root</i>
    <i><span class="swatch" style="background:var(--component)"></span>component</i>
    <i><span class="swatch" style="background:var(--hook)"></span>hook</i>
    <i><span class="swatch" style="background:var(--context)"></span>context</i>
    <i><span class="swatch" style="background:var(--helper)"></span>helper</i>
    <i>— always · <span style="letter-spacing:2px">┄</span> sometimes</i>
  </span>
</header>
<div id="wrap"><svg id="svg"></svg></div>
<div id="detail"></div>
<script id="graph" type="application/json">${data.replace(/</g, "\\u003c")}</script>
<script>
${VIEWER}
</script>
`;
}

/**
 * The viewer, inlined.
 *
 * A template literal rather than a separate asset because the point of the output is that it is ONE
 * file — a build step that stitched two would be the same file with a way to get it wrong.
 */
const VIEWER = String.raw`
const graph = JSON.parse(document.getElementById("graph").textContent);
const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const out = new Map();
for (const e of graph.edges) {
  if (!byId.has(e.from) || !byId.has(e.to)) continue;
  (out.get(e.from) ?? out.set(e.from, []).get(e.from)).push(e);
}

/**
 * Depth from the nearest root, breadth-first.
 *
 * BFS rather than the longest path: a node's row should say how FAR it can be from the entry, and
 * the shortest way in is the one a reader traces. Anything the walk never reaches has no depth at
 * all, which is a different fact from depth 0 and is drawn as its own band.
 */
const depth = new Map();
const queue = graph.nodes.filter((n) => n.kind === "root").map((n) => n.id);
for (const id of queue) depth.set(id, 0);
for (let i = 0; i < queue.length; i++) {
  const here = queue[i];
  for (const e of out.get(here) ?? []) {
    if (depth.has(e.to)) continue;
    depth.set(e.to, depth.get(here) + 1);
    queue.push(e.to);
  }
}

/**
 * What to write in the box.
 *
 * A ROOT has no name — the type says so and means it: a root is a CALL, not a declaration, so
 * there is no binding to name. Its id ends in the call that made it, which is the useful half.
 * Assumed a name here first, and the whole picture rendered empty on one localeCompare.
 *
 * No backticks in here, and that is not a style note: this whole viewer is a template literal, and
 * a backtick in a comment closes it. Cost one build.
 */
function labelOf(node) {
  const own = node.id.slice(node.id.lastIndexOf("#") + 1);
  const name = node.name ?? own;
  // A ROUTE OUTLET SITE is minted as file#RouteOutlet@n and carries kind "component" plus the
  // component's own name, so two boxes read RouteOutlet and one of them is a USE rather than a
  // declaration. Found by drawing a second app: in playground-ssr the router's component and the
  // outlet written in App.tsx sat side by side, identical. The ordinal is what tells them apart.
  const site = /@(\d+)$/.exec(own);
  return site === null ? name : name + " @" + site[1];
}

/**
 * A LIBRARY graph answers a different question, and saying otherwise would be a lie the analyzer
 * refuses to tell.
 *
 * ComponentGraph.scope says it: "an app has roots and can be judged whole. A library has none —
 * unreachable and no-provider-above cannot be decided without knowing what mounts it." A library
 * therefore has NO ROOTS, so every node lands at no depth at all — and the first version of this
 * drew all of them under "nothing reaches these", asserting exactly what the graph says cannot be
 * decided. Measured on packages/router: six nodes, zero roots, six false claims.
 *
 * So depth is not the axis for a library. What an app can NAME is: only an exported declaration can
 * be mounted from outside, which the node already carries.
 */
const LIBRARY = graph.scope === "library";

const COLOR = { root: "--root", component: "--component", hook: "--hook", context: "--context", helper: "--helper" };
const ROW = 74, PAD = 28, CHAR = 6.6, BOX = 22, GAP = 18;

let selected = null;

function draw() {
  const hideHelpers = document.getElementById("hideHelpers").checked;
  const onlyLost = document.getElementById("onlyLost").checked;
  const shown = graph.nodes.filter((n) => {
    if (hideHelpers && n.kind === "helper") return false;
    if (onlyLost && depth.has(n.id)) return false;
    return true;
  });
  const visible = new Set(shown.map((n) => n.id));

  // One band per depth, and a final band for what the walk never reached. A LIBRARY has neither:
  // see LIBRARY above for why depth is not a question its graph can answer.
  const bands = new Map();
  for (const n of shown) {
    const key = LIBRARY ? (n.exported ? 0 : 1) : depth.has(n.id) ? depth.get(n.id) : Infinity;
    (bands.get(key) ?? bands.set(key, []).get(key)).push(n);
  }
  const order = [...bands.keys()].sort((a, b) => a - b);

  const place = new Map();
  let y = PAD + 18, width = 0;
  for (const key of order) {
    const row = bands.get(key).sort((a, b) => labelOf(a).localeCompare(labelOf(b)));
    let x = PAD;
    for (const n of row) {
      const w = Math.max(46, labelOf(n).length * CHAR + 16);
      place.set(n.id, { x, y, w, node: n });
      x += w + GAP;
    }
    width = Math.max(width, x);
    y += ROW;
  }

  const svg = document.getElementById("svg");
  svg.setAttribute("width", Math.max(width + PAD, 320));
  svg.setAttribute("height", y + PAD);
  const parts = [];

  for (const key of order) {
    const first = place.get(bands.get(key)[0].id);
    const label = LIBRARY
      ? key === 0 ? "exported — an app can mount these" : "internal to the package"
      : key === Infinity ? "nothing reaches these" : key === 0 ? "roots" : "depth " + key;
    parts.push('<text class="band" x="' + PAD + '" y="' + (first.y - 8) + '">' + label + "</text>");
  }

  for (const e of graph.edges) {
    const a = place.get(e.from), b = place.get(e.to);
    if (!a || !b || !visible.has(e.from) || !visible.has(e.to)) continue;
    const x1 = a.x + a.w / 2, y1 = a.y + BOX, x2 = b.x + b.w / 2, y2 = b.y;
    const mid = (y1 + y2) / 2;
    const cls = "edge" + (e.always === false ? " sometimes" : "") + (e.kind === "unresolved" ? " unresolved" : "");
    parts.push('<path class="' + cls + '" data-from="' + e.from + '" data-to="' + e.to +
      '" d="M' + x1 + ' ' + y1 + ' C' + x1 + ' ' + mid + ' ' + x2 + ' ' + mid + ' ' + x2 + ' ' + y2 + '"/>');
  }

  for (const [id, p] of place) {
    const c = "var(" + (COLOR[p.node.kind] ?? "--helper") + ")";
    parts.push('<g class="node" data-id="' + id + '">' +
      '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + BOX + '" style="stroke:' + c + '"/>' +
      '<text x="' + (p.x + 8) + '" y="' + (p.y + 15) + '">' + esc(labelOf(p.node)) + "</text></g>");
  }

  svg.innerHTML = parts.join("");
  document.getElementById("tally").textContent =
    shown.length + " of " + graph.nodes.length + " nodes · " + graph.edges.length + " edges · " + graph.scope;
  if (selected) highlight(selected);
}

function esc(s) {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
}

/** Everything one hop either way stays lit; the rest dims. Two hops was noise at this size. */
function highlight(id) {
  const near = new Set([id]);
  for (const e of graph.edges) {
    if (e.from === id) near.add(e.to);
    if (e.to === id) near.add(e.from);
  }
  for (const g of document.querySelectorAll(".node")) {
    g.classList.toggle("dim", !near.has(g.dataset.id));
    g.classList.toggle("on", g.dataset.id === id);
  }
  for (const p of document.querySelectorAll(".edge")) {
    p.classList.toggle("dim", p.dataset.from !== id && p.dataset.to !== id);
  }
}

function clearHighlight() {
  for (const el of document.querySelectorAll(".dim, .on")) el.classList.remove("dim", "on");
}

document.getElementById("svg").addEventListener("click", (event) => {
  const g = event.target.closest(".node");
  const detail = document.getElementById("detail");
  if (!g) {
    selected = null;
    clearHighlight();
    detail.style.display = "none";
    return;
  }
  selected = g.dataset.id;
  const n = byId.get(selected);
  const reaches = graph.edges.filter((e) => e.from === selected).length;
  const from = graph.edges.filter((e) => e.to === selected).length;
  detail.style.display = "block";
  detail.innerHTML = "<b>" + esc(labelOf(n)) + " · " + n.kind + "</b><code>" + esc(n.at) + "</code><br>" +
    from + " in · " + reaches + " out" + (depth.has(selected) ? "" : " · nothing reaches it");
  highlight(selected);
});

for (const id of ["hideHelpers", "onlyLost"]) {
  document.getElementById(id).addEventListener("change", draw);
}

if (LIBRARY) {
  // The same lie in a checkbox: a library cannot say what nothing reaches, so it may not offer to
  // filter by it. Disabled with the reason on it rather than removed, so the absence is explained.
  const lost = document.getElementById("onlyLost");
  lost.checked = false;
  lost.disabled = true;
  lost.closest("label").title =
    "A library has no roots, so nothing here can say what an app does or does not mount.";
  lost.closest("label").style.opacity = ".45";
}
draw();
`;

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
