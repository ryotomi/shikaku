/* 生活習慣病 因果チャート — D3.js v7
   データ: data/lifestyle-disease.json（nodes: layer/system, edges: from/to/label/strength）
   レイアウト: 因果の深さ（longest-path, cycleエッジ除外）で x、系統(system)レーンで y。
   math-derivation-chart の設計を踏襲した自作実装。 */

(function () {
  "use strict";

  const DATA_URL = "data/lifestyle-disease.json";

  // レイアウト定数
  const COL_W = 236;      // 深さ1段あたりの横幅
  const ROW_H = 48;       // 縦スロット
  const MARGIN_LEFT = 150;
  const MARGIN_TOP = 44;
  const LANE_PAD = 16;
  const NODE_FONT = 11;
  const MAX_NODE_W = COL_W - 34;
  const LABEL_PAD = 14;

  const LAYER_BORDER = {
    habit: "#4f9d69", risk: "#c98a1e", disease: "#b8433f",
    complication: "#7d5aa0", outcome: "#444444",
  };

  // DOM
  const $ = (id) => document.getElementById(id);
  const svgEl = $("ldc-svg");
  const graphEl = $("ldc-graph");
  const wrapperEl = $("ldc-graph-wrapper");
  const loadingEl = $("ldc-loading");
  const panelEl = $("ldc-panel");
  const panelBody = $("ldc-panel-body");
  const legendEl = $("ldc-legend");
  const filterLayerEl = $("ldc-filter-layer");
  const filterSystemEl = $("ldc-filter-system");

  // テキスト計測
  const _canvas = document.createElement("canvas");
  const _ctx = _canvas.getContext("2d");
  _ctx.font = `${NODE_FONT}px "Noto Sans JP", sans-serif`;
  const textW = (s) => _ctx.measureText(s).width;

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const state = {
    hiddenLayers: new Set(),
    hiddenSystems: new Set(),
    selected: null,
  };

  let DATA, nodeById, systemColor, layerLabel, systemLabel;
  let outAdj, inAdj;           // {id: [{other, edge}]}
  let svg, root, gEdges, gNodes, gLanes;
  let contentW, contentH;

  function setLoading(on, msg) {
    if (!loadingEl) return;
    if (msg) loadingEl.querySelector(".ldc-loading-msg").textContent = msg;
    loadingEl.classList.toggle("is-hidden", !on);
  }

  fetch(DATA_URL, { cache: "no-cache" })
    .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then((data) => { DATA = data; init(); })
    .catch((err) => {
      console.error("[ldc] データ読込失敗", err);
      setLoading(true, "データの読み込みに失敗しました。GitHub Pages 上で開いてください。");
    });

  function init() {
    nodeById = new Map(DATA.nodes.map((n) => [n.id, n]));
    systemColor = new Map(DATA.systems.map((s) => [s.key, s.color]));
    systemLabel = new Map(DATA.systems.map((s) => [s.key, s.label]));
    layerLabel = new Map(DATA.layers.map((l) => [l.key, l.label]));

    // 隣接リスト
    outAdj = new Map(DATA.nodes.map((n) => [n.id, []]));
    inAdj = new Map(DATA.nodes.map((n) => [n.id, []]));
    DATA.edges.forEach((e) => {
      if (!nodeById.has(e.from) || !nodeById.has(e.to)) {
        console.warn("[ldc] 未知ノードのエッジ", e); return;
      }
      outAdj.get(e.from).push({ other: e.to, edge: e });
      inAdj.get(e.to).push({ other: e.from, edge: e });
    });

    computeDepths();
    layout();
    buildSVG();
    buildFilters();
    buildLegend();
    render();
    setLoading(false);
    bindGlobal();
  }

  /* ---- 深さ（最長経路, cycleエッジ除外, 循環はガードで打切り） ---- */
  function computeDepths() {
    const depth = new Map();
    const parents = new Map(DATA.nodes.map((n) => [n.id, []]));
    DATA.edges.forEach((e) => {
      if (e.strength === "cycle") return;              // 悪循環は依存から除外
      if (parents.has(e.to)) parents.get(e.to).push(e.from);
    });
    const visiting = new Set();
    function longest(id) {
      if (depth.has(id)) return depth.get(id);
      if (visiting.has(id)) return 0;                  // 循環ガード
      visiting.add(id);
      let d = 0;
      for (const p of parents.get(id)) d = Math.max(d, longest(p) + 1);
      visiting.delete(id);
      depth.set(id, d);
      return d;
    }
    DATA.nodes.forEach((n) => { n._depth = longest(n.id); });
  }

  /* ---- レイアウト（系統レーン × 深さ列） ---- */
  function layout() {
    const maxDepth = d3.max(DATA.nodes, (n) => n._depth);

    // ノード寸法（必要なら2行に折返し）
    DATA.nodes.forEach((n) => sizeNode(n));

    // 系統レーン（データ内に存在する system のみ、systems 定義順）
    const present = new Set(DATA.nodes.map((n) => n.system));
    const lanes = DATA.systems.filter((s) => present.has(s.key)).map((s) => ({
      key: s.key, label: s.label, nodes: DATA.nodes.filter((n) => n.system === s.key),
    }));

    let y = MARGIN_TOP;
    lanes.forEach((lane, li) => {
      // 深さごとにグループ化
      const byDepth = d3.group(lane.nodes, (n) => n._depth);
      let maxRows = 1;
      byDepth.forEach((arr) => { maxRows = Math.max(maxRows, arr.length); });
      lane.height = maxRows * ROW_H + LANE_PAD * 2;
      lane.y = y;
      lane.index = li;
      // 各深さグループを中央寄せで縦配置
      byDepth.forEach((arr) => {
        arr.forEach((n, i) => { n._row = i; n._groupSize = arr.length; });
      });
      lane.byDepth = byDepth;
      y += lane.height;
    });

    contentW = MARGIN_LEFT + (maxDepth + 1) * COL_W + 30;
    contentH = y + 20;

    const laneCenterY = (lane) => lane.y + lane.height / 2;
    const place = () => {
      lanes.forEach((lane) => {
        lane.byDepth.forEach((arr) => {
          const gs = arr.length;
          arr.forEach((n) => {
            n.x = MARGIN_LEFT + n._depth * COL_W + COL_W / 2;
            n.y = laneCenterY(lane) + (n._row - (gs - 1) / 2) * ROW_H;
          });
        });
      });
    };
    place();

    // 交差低減：レーン×深さグループ内をバリセンタ順に並べ替え（数回）
    for (let sweep = 0; sweep < 4; sweep++) {
      lanes.forEach((lane) => {
        lane.byDepth.forEach((arr) => {
          if (arr.length < 2) return;
          arr.forEach((n) => {
            const neigh = outAdj.get(n.id).concat(inAdj.get(n.id));
            const ys = neigh.map((a) => nodeById.get(a.other).y).filter((v) => v != null);
            n._bary = ys.length ? d3.mean(ys) : n.y;
          });
          arr.sort((a, b) => d3.ascending(a._bary, b._bary));
          arr.forEach((n, i) => { n._row = i; });
        });
      });
      place();
    }

    DATA._lanes = lanes;
  }

  function sizeNode(n) {
    const label = n.label;
    const one = textW(label);
    if (one + LABEL_PAD <= MAX_NODE_W) {
      n._lines = [label];
      n.w = Math.max(64, one + LABEL_PAD);
      n.h = 24;
      return;
    }
    // 2行に分割（「（」優先、なければ中央付近）
    let cut = label.indexOf("（");
    if (cut <= 1 || cut >= label.length - 1) {
      const seps = ["・", "／", "/"];
      cut = -1;
      for (const s of seps) { const i = label.indexOf(s, 3); if (i > 0) { cut = i + 1; break; } }
      if (cut < 0) cut = Math.ceil(label.length / 2);
    }
    const l1 = label.slice(0, cut), l2 = label.slice(cut);
    n._lines = [l1, l2];
    n.w = Math.min(MAX_NODE_W, Math.max(64, Math.max(textW(l1), textW(l2)) + LABEL_PAD));
    n.h = 36;
  }

  /* ---- SVG 構築 ---- */
  function buildSVG() {
    svg = d3.select(svgEl);
    svg.selectAll("*").remove();

    // 矢印マーカー
    const defs = svg.append("defs");
    const mk = (id, color) => defs.append("marker")
      .attr("id", id).attr("viewBox", "0 0 10 10")
      .attr("refX", 9).attr("refY", 5).attr("markerWidth", 7).attr("markerHeight", 7)
      .attr("orient", "auto-start-reverse")
      .append("path").attr("d", "M0,0 L10,5 L0,10 z").attr("fill", color);
    mk("ldc-arrow", "#9c968a");
    mk("ldc-arrow-hl", "#c0504d");
    mk("ldc-arrow-cycle", "#c0504d");

    // 原寸で描画し #ldc-graph のネイティブスクロールで移動（ノードを読める大きさに保つ）
    svg.attr("width", contentW).attr("height", contentH)
      .attr("viewBox", `0 0 ${contentW} ${contentH}`);

    root = svg.append("g").attr("class", "ldc-root");
    gLanes = root.append("g").attr("class", "ldc-lanes");
    gEdges = root.append("g").attr("class", "ldc-edges");
    gNodes = root.append("g").attr("class", "ldc-nodes");

    // レーン背景＋ラベル
    const laneSel = gLanes.selectAll("g.ldc-lane").data(DATA._lanes).enter()
      .append("g").attr("class", "ldc-lane");
    laneSel.append("rect")
      .attr("class", (d, i) => "ldc-lane-bg" + (i % 2 ? " alt" : ""))
      .attr("x", 0).attr("y", (d) => d.y).attr("width", contentW).attr("height", (d) => d.height);
    laneSel.append("text").attr("class", "ldc-lane-label")
      .attr("x", 10).attr("y", (d) => d.y + 16).text((d) => d.label);

    // 深さ列の区切り線
    const maxDepth = d3.max(DATA.nodes, (n) => n._depth);
    for (let d = 1; d <= maxDepth; d++) {
      const x = MARGIN_LEFT + d * COL_W;
      gLanes.append("line").attr("class", "ldc-col-sep")
        .attr("x1", x).attr("y1", MARGIN_TOP - 8).attr("x2", x).attr("y2", contentH - 10);
    }
  }

  /* ---- 描画 ---- */
  function render() {
    // エッジ
    const edges = DATA.edges.filter((e) => nodeById.has(e.from) && nodeById.has(e.to));
    const eSel = gEdges.selectAll("g.ldc-edge").data(edges, (d) => d.from + "->" + d.to);
    const eEnter = eSel.enter().append("g")
      .attr("class", (d) => "ldc-edge " + (d.strength || "moderate"));
    eEnter.append("path").attr("class", "ldc-edge-line")
      .attr("marker-end", (d) => d.strength === "cycle" ? "url(#ldc-arrow-cycle)" : "url(#ldc-arrow)");
    eEnter.append("text").attr("class", "ldc-edge-label").attr("text-anchor", "middle")
      .text((d) => d.label || "");
    const eAll = eEnter.merge(eSel);
    eAll.select("path.ldc-edge-line").attr("d", (d) => edgePath(d));
    eAll.select("text.ldc-edge-label").attr("x", (d) => edgeMid(d)[0]).attr("y", (d) => edgeMid(d)[1]);

    // ノード
    const nSel = gNodes.selectAll("g.ldc-node").data(DATA.nodes, (d) => d.id);
    const nEnter = nSel.enter().append("g").attr("class", "ldc-node")
      .attr("tabindex", 0)
      .on("click", (ev, d) => { ev.stopPropagation(); selectNode(d.id); })
      .on("mouseenter", (ev, d) => { if (!state.selected) hover(d.id); })
      .on("mouseleave", () => { if (!state.selected) clearHover(); });
    nEnter.append("title").text((d) => d.label + "｜" + (layerLabel.get(d.layer) || d.layer));
    nEnter.append("rect");
    nEnter.each(function (d) {
      const g = d3.select(this);
      d._lines.forEach((ln, i) => {
        g.append("text").attr("text-anchor", "middle").attr("font-size", NODE_FONT)
          .attr("dy", d._lines.length === 1 ? "0.34em" : (i === 0 ? "-0.15em" : "1.0em"))
          .text(ln);
      });
    });
    const nAll = nEnter.merge(nSel);
    nAll.attr("transform", (d) => `translate(${d.x},${d.y})`);
    nAll.select("rect")
      .attr("x", (d) => -d.w / 2).attr("y", (d) => -d.h / 2)
      .attr("width", (d) => d.w).attr("height", (d) => d.h).attr("rx", 4)
      .attr("fill", (d) => lighten(systemColor.get(d.system) || "#888", 0.8))
      .attr("stroke", (d) => LAYER_BORDER[d.layer] || "#666").attr("stroke-width", 1.6);
    nAll.selectAll("text").attr("fill", "#2a2a2a");

    applyFilter();
    applyHighlight();
  }

  /* ---- エッジのパス ---- */
  function anchors(e) {
    const s = nodeById.get(e.from), t = nodeById.get(e.to);
    const forward = t.x >= s.x;
    if (forward) {
      return { sx: s.x + s.w / 2, sy: s.y, tx: t.x - t.w / 2, ty: t.y, back: false };
    }
    // 後退（悪循環など）：下側を回す
    return { sx: s.x, sy: s.y + s.h / 2, tx: t.x, ty: t.y + t.h / 2, back: true };
  }
  function edgePath(e) {
    const a = anchors(e);
    if (a.back) {
      const dip = 46 + Math.abs(a.sx - a.tx) * 0.12;
      return `M${a.sx},${a.sy} C${a.sx},${a.sy + dip} ${a.tx},${a.ty + dip} ${a.tx},${a.ty}`;
    }
    const dx = Math.max(40, (a.tx - a.sx) * 0.45);
    return `M${a.sx},${a.sy} C${a.sx + dx},${a.sy} ${a.tx - dx},${a.ty} ${a.tx},${a.ty}`;
  }
  function edgeMid(e) {
    const a = anchors(e);
    if (a.back) return [(a.sx + a.tx) / 2, Math.max(a.sy, a.ty) + 40];
    return [(a.sx + a.tx) / 2, (a.sy + a.ty) / 2 - 5];
  }

  /* ---- フィルタ ---- */
  function buildFilters() {
    // 段階
    DATA.layers.forEach((l) => {
      const chip = document.createElement("button");
      chip.className = "ldc-chip";
      chip.dataset.layer = l.key;
      chip.innerHTML = `<span class="ldc-chip-dot" style="background:${LAYER_BORDER[l.key] || "#666"}"></span>${esc(l.label)}`;
      chip.addEventListener("click", () => {
        toggleSet(state.hiddenLayers, l.key); chip.classList.toggle("off");
        render();
      });
      filterLayerEl.appendChild(chip);
    });
    // 系統
    const present = new Set(DATA.nodes.map((n) => n.system));
    DATA.systems.filter((s) => present.has(s.key)).forEach((s) => {
      const chip = document.createElement("button");
      chip.className = "ldc-chip";
      chip.dataset.system = s.key;
      chip.innerHTML = `<span class="ldc-chip-dot" style="background:${s.color}"></span>${esc(s.label)}`;
      chip.addEventListener("click", () => {
        toggleSet(state.hiddenSystems, s.key); chip.classList.toggle("off");
        render();
      });
      filterSystemEl.appendChild(chip);
    });
    // プリセット
    document.querySelectorAll(".ldc-chip-action").forEach((btn) => {
      btn.addEventListener("click", () => {
        const on = btn.dataset.preset === "all";
        state.hiddenSystems.clear();
        if (!on) present.forEach((k) => state.hiddenSystems.add(k));
        filterSystemEl.querySelectorAll(".ldc-chip").forEach((c) => c.classList.toggle("off", !on));
        render();
      });
    });
  }
  function toggleSet(set, k) { set.has(k) ? set.delete(k) : set.add(k); }

  function nodeVisible(n) {
    return !state.hiddenLayers.has(n.layer) && !state.hiddenSystems.has(n.system);
  }
  function applyFilter() {
    gNodes.selectAll("g.ldc-node").classed("faded", (d) => !nodeVisible(d));
    gEdges.selectAll("g.ldc-edge").classed("faded", (d) =>
      !nodeVisible(nodeById.get(d.from)) || !nodeVisible(nodeById.get(d.to)));
  }

  /* ---- ハイライト（選択・ホバー） ---- */
  function traverse(startId, adj) {
    const seen = new Set(), stack = [startId];
    while (stack.length) {
      const cur = stack.pop();
      for (const { other } of adj.get(cur)) {
        if (!seen.has(other)) { seen.add(other); stack.push(other); }
      }
    }
    return seen;
  }
  function selectNode(id) {
    state.selected = id;
    applyHighlight();
    openPanel(id);
  }
  function clearSelection() {
    state.selected = null;
    applyHighlight();
    closePanel();
  }
  function applyHighlight() {
    const nodes = gNodes.selectAll("g.ldc-node");
    const edges = gEdges.selectAll("g.ldc-edge");
    if (!state.selected) {
      nodes.classed("selected", false).classed("dim", false);
      edges.classed("hl", false).classed("dim", false)
        .select("path.ldc-edge-line").attr("marker-end", (d) => d.strength === "cycle" ? "url(#ldc-arrow-cycle)" : "url(#ldc-arrow)");
      return;
    }
    const up = traverse(state.selected, inAdj);
    const down = traverse(state.selected, outAdj);
    const hl = new Set([state.selected, ...up, ...down]);
    nodes.classed("selected", (d) => d.id === state.selected)
      .classed("dim", (d) => !hl.has(d.id) && nodeVisible(d));
    edges.classed("hl", (d) => hl.has(d.from) && hl.has(d.to))
      .classed("dim", (d) => !(hl.has(d.from) && hl.has(d.to)))
      .select("path.ldc-edge-line").attr("marker-end", (d) =>
        (hl.has(d.from) && hl.has(d.to)) ? "url(#ldc-arrow-hl)" :
        (d.strength === "cycle" ? "url(#ldc-arrow-cycle)" : "url(#ldc-arrow)"));
    // 強調エッジを前面へ
    edges.filter((d) => hl.has(d.from) && hl.has(d.to)).raise();
  }
  function hover(id) {
    const nodes = gNodes.selectAll("g.ldc-node");
    const edges = gEdges.selectAll("g.ldc-edge");
    const neigh = new Set([id]);
    outAdj.get(id).forEach((a) => neigh.add(a.other));
    inAdj.get(id).forEach((a) => neigh.add(a.other));
    nodes.classed("dim", (d) => !neigh.has(d.id) && nodeVisible(d));
    edges.classed("hl", (d) => d.from === id || d.to === id)
      .classed("dim", (d) => d.from !== id && d.to !== id);
    edges.filter((d) => d.from === id || d.to === id).raise();
  }
  function clearHover() {
    gNodes.selectAll("g.ldc-node").classed("dim", false);
    gEdges.selectAll("g.ldc-edge").classed("hl", false).classed("dim", false);
  }

  /* ---- 詳細パネル ---- */
  function relItem(otherId, mech, dir) {
    const o = nodeById.get(otherId);
    const arrow = dir === "cause" ? "→" : "→";
    return `<li><a data-goto="${esc(otherId)}">
      <span class="ldc-rel-arrow">${arrow}</span> ${esc(o.label)}
      <span class="ldc-rel-mech">${mech ? "（" + esc(mech) + "）" : ""}</span>
    </a></li>`;
  }
  function openPanel(id) {
    const n = nodeById.get(id);
    const causes = inAdj.get(id).map((a) => relItem(a.other, a.edge.label, "cause")).join("");
    const effects = outAdj.get(id).map((a) => relItem(a.other, a.edge.label, "effect")).join("");
    panelBody.innerHTML = `
      <div class="ldc-panel-label">${esc(n.label)}</div>
      <div class="ldc-panel-badges">
        <span class="ldc-badge" style="border-color:${LAYER_BORDER[n.layer] || "#666"}">${esc(layerLabel.get(n.layer) || n.layer)}</span>
        <span class="ldc-badge" style="border-color:${systemColor.get(n.system) || "#888"}">${esc(systemLabel.get(n.system) || n.system)}</span>
      </div>
      <div class="ldc-panel-summary">${esc(n.summary || "")}</div>
      ${n.prevention ? `<div class="ldc-panel-section"><h4>予防・対策</h4><div class="ldc-panel-summary">${esc(n.prevention)}</div></div>` : ""}
      <div class="ldc-panel-section">
        <h4>主な原因（上流）</h4>
        ${causes ? `<ul class="ldc-rel">${causes}</ul>` : '<p style="color:var(--color-text-muted);font-size:.8rem">— 上流要因なし（起点）</p>'}
      </div>
      <div class="ldc-panel-section">
        <h4>主な結果（下流）</h4>
        ${effects ? `<ul class="ldc-rel">${effects}</ul>` : '<p style="color:var(--color-text-muted);font-size:.8rem">— 下流の帰結なし（終点）</p>'}
      </div>
      <p style="margin-top:.8rem;font-size:.72rem;color:var(--color-text-muted)">
        ※ 確立された一般的知見の簡略図。診断・治療の指針ではありません。
      </p>`;
    panelBody.querySelectorAll("a[data-goto]").forEach((a) => {
      a.addEventListener("click", () => selectNode(a.dataset.goto));
    });
    panelEl.classList.add("is-visible");
  }
  function closePanel() { panelEl.classList.remove("is-visible"); }

  /* ---- 凡例 ---- */
  function buildLegend() {
    const present = new Set(DATA.nodes.map((n) => n.system));
    const sysRows = DATA.systems.filter((s) => present.has(s.key)).map((s) =>
      `<div class="ldc-legend-row"><span class="ldc-legend-swatch" style="background:${lighten(s.color, 0.55)};border:1.5px solid ${s.color}"></span>${esc(s.label)}</div>`).join("");
    const layRows = DATA.layers.map((l) =>
      `<div class="ldc-legend-row"><span class="ldc-legend-swatch" style="background:#fff;border:2px solid ${LAYER_BORDER[l.key] || "#666"}"></span>${esc(l.label)}</div>`).join("");
    legendEl.innerHTML = `
      <div class="ldc-legend-head">
        <span class="ldc-legend-heading">凡例</span>
        <button class="ldc-legend-toggle" id="ldc-legend-toggle" aria-label="凡例の表示切替" title="凡例を折りたたむ">－</button>
      </div>
      <div class="ldc-legend-body">
        <div class="ldc-legend-col"><div class="ldc-legend-title">系統（塗り）</div>${sysRows}</div>
        <div class="ldc-legend-col"><div class="ldc-legend-title">段階（枠）</div>${layRows}</div>
      </div>`;
    $("ldc-legend-toggle").addEventListener("click", (ev) => {
      ev.stopPropagation();
      const collapsed = legendEl.classList.toggle("is-collapsed");
      ev.currentTarget.textContent = collapsed ? "＋" : "－";
      ev.currentTarget.title = collapsed ? "凡例を開く" : "凡例を折りたたむ";
    });
  }

  /* ---- ビュー操作 ---- */
  function bindGlobal() {
    // 背景クリックで選択解除（ノードクリックは stopPropagation 済み）
    svg.on("click", () => { if (state.selected) clearSelection(); });
    $("ldc-panel-close").addEventListener("click", clearSelection);
    $("ldc-btn-fullscreen").addEventListener("click", () => {
      if (!document.fullscreenElement) wrapperEl.requestFullscreen?.();
      else document.exitFullscreen?.();
    });
  }

  /* ---- utils ---- */
  function lighten(hex, t) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    const num = parseInt(m[1], 16);
    let r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
    r = Math.round(r + (255 - r) * t);
    g = Math.round(g + (255 - g) * t);
    b = Math.round(b + (255 - b) * t);
    return `rgb(${r},${g},${b})`;
  }
})();
