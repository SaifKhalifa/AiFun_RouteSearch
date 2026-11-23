/*
 * app.js — the user interface.
 * Loads the map, fills the dropdowns, runs the algorithms from search.js,
 * draws the map as SVG and shows the result / comparison table.
 *
 * All text that comes from a map file is inserted with textContent (never innerHTML).
 */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const DEFAULT_MAP_URL = 'data/westbank_map.json';

  let graph = null; // current graph (see graph.js)
  let view = { path: [], visited: [], start: null, goal: null }; // what the map currently highlights
  let compareResults = null;

  // ---------------------------------------------------------------- helpers
  function svgEl(tag, attrs, text) {
    const e = document.createElementNS(SVG_NS, tag);
    for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function el(tag, props, text) {
    const e = document.createElement(tag);
    for (const k in props || {}) e[k] = props[k];
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }
  function fmt(n) {
    return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
  }
  function showMessage(text, isError) {
    const m = $('message');
    m.textContent = text;
    m.className = isError ? 'error' : '';
    m.hidden = !text;
  }

  // ---------------------------------------------------------------- map loading
  async function loadDefaultMap() {
    let obj;
    let note = '';
    try {
      const res = await fetch(DEFAULT_MAP_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      obj = await res.json();
    } catch (e) {
      // Opening index.html directly from disk (file://) blocks fetch(); use the embedded copy.
      obj = window.DEFAULT_MAP;
      note = 'Loaded the built-in copy of the default map (the browser blocked reading data/westbank_map.json from disk). Run a local server to read the file itself — see README.';
    }
    setMap(obj, note);
  }

  /** Validate and install a map. On error the old map is kept. Returns true on success. */
  function setMap(obj, note) {
    let g;
    try {
      g = RouteGraph.fromMap(obj);
    } catch (e) {
      if (e instanceof RouteGraph.MapError) {
        showMessage('That map file is not valid:\n• ' + e.errors.join('\n• '), true);
      } else {
        showMessage('Could not use that map: ' + e.message, true);
      }
      return false;
    }
    graph = g;
    compareResults = null;
    view = { path: [], visited: [], start: null, goal: null };

    $('mapName').textContent = g.name;
    $('mapStats').textContent = `${g.cities.length} cities · ${g.roads.length} roads`;
    fillSelects();
    $('resultCard').hidden = true;
    $('compareCard').hidden = true;
    const lines = [];
    if (note) lines.push(note);
    lines.push(...g.warnings);
    showMessage(lines.join('\n'), false);
    drawMap();
    return true;
  }

  function fillSelects() {
    const sorted = graph.cities.slice().sort(graph.compareNames);
    for (const id of ['start', 'goal']) {
      const sel = $(id);
      clear(sel);
      for (const c of sorted) sel.appendChild(el('option', { value: c }, c));
    }
    // Sensible defaults: first and last city of the file.
    $('start').value = graph.cities[0];
    $('goal').value = graph.cities[graph.cities.length - 1];
  }

  function fillAlgorithms() {
    const sel = $('algo');
    for (const a of RouteSearch.ALGORITHMS) {
      sel.appendChild(el('option', { value: a.id }, `${a.label} — ${a.long}`));
    }
    sel.value = 'astar';
  }

  // ---------------------------------------------------------------- drawing
  function drawMap() {
    const svg = $('map');
    clear(svg);
    if (!graph) return;

    // Fit the real coordinates into the drawing area (y is flipped so north is up).
    const xs = graph.cities.map((c) => graph.coords.get(c).x);
    const ys = graph.cities.map((c) => graph.coords.get(c).y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 1e-6);
    const spanY = Math.max(maxY - minY, 1e-6);
    const padX = 120, padY = 50, maxW = 900, maxH = 860;
    const scale = Math.min((maxW - 2 * padX) / spanX, (maxH - 2 * padY) / spanY);
    const W = spanX * scale + 2 * padX;
    const H = spanY * scale + 2 * padY;
    svg.setAttribute('viewBox', `0 0 ${W.toFixed(1)} ${H.toFixed(1)}`);
    const pos = (c) => {
      const p = graph.coords.get(c);
      return { x: padX + (p.x - minX) * scale, y: padY + (maxY - p.y) * scale };
    };
    const midX = padX + (spanX * scale) / 2;

    const onPath = new Set(view.path);
    const pathEdges = new Set();
    for (let i = 0; i + 1 < view.path.length; i++) {
      pathEdges.add(view.path[i] + '|' + view.path[i + 1]);
      pathEdges.add(view.path[i + 1] + '|' + view.path[i]);
    }
    const visited = new Set(view.visited);

    // roads (route roads are drawn last so they sit on top)
    const roads = graph.roads.slice().sort((a, b) => {
      const pa = pathEdges.has(a.from + '|' + a.to) ? 1 : 0;
      const pb = pathEdges.has(b.from + '|' + b.to) ? 1 : 0;
      return pa - pb;
    });
    const labels = svgEl('g');

    // Boxes already taken by city names, so road-length labels can slide out of their way.
    const taken = graph.cities.map((c) => {
      const p = pos(c);
      const w = c.length * 8 + 4;
      const left = p.x < midX;
      return { x1: left ? p.x - 18 - w : p.x + 14, x2: left ? p.x - 14 : p.x + 18 + w, y1: p.y - 11, y2: p.y + 11 };
    });
    const hits = (x, y, w) => taken.some((t) => x - w / 2 < t.x2 && x + w / 2 > t.x1 && y - 9 < t.y2 && y + 9 > t.y1);

    for (const r of roads) {
      const a = pos(r.from), b = pos(r.to);
      const hot = pathEdges.has(r.from + '|' + r.to);
      const line = svgEl('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'edge' + (hot ? ' onpath' : '') });
      svg.appendChild(line);
      const txt = fmt(r.km);
      const w = txt.length * 7 + 8;
      // Prefer the middle of the road; otherwise try nearby spots that don't cover a city name.
      let mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      for (const t of [0.5, 0.4, 0.6, 0.33, 0.67, 0.25, 0.75]) {
        const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        if (!hits(x, y, w)) { mx = x; my = y; break; }
      }
      taken.push({ x1: mx - w / 2, x2: mx + w / 2, y1: my - 9, y2: my + 9 });
      const g = svgEl('g');
      g.appendChild(svgEl('rect', { x: mx - w / 2, y: my - 9, width: w, height: 18, rx: 4, class: 'elabel-bg' + (hot ? ' onpath' : '') }));
      g.appendChild(svgEl('text', { x: mx, y: my, class: 'elabel' + (hot ? ' onpath' : '') }, txt));
      const tip = svgEl('title', {}, `${r.from} – ${r.to}: ${txt} ${graph.unit}`);
      g.appendChild(tip);
      if (hot) labels.appendChild(g);
      else svg.appendChild(g);
    }
    svg.appendChild(labels); // route road labels above everything else

    // cities
    for (const c of graph.cities) {
      const p = pos(c);
      const cls = ['node'];
      if (onPath.has(c)) cls.push('onpath');
      if (c === view.start) cls.push('start');
      if (c === view.goal) cls.push('goal');
      const g = svgEl('g');
      if (visited.has(c)) g.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r: 13, class: 'vring' }));
      const circle = svgEl('circle', { cx: p.x, cy: p.y, r: 8, class: cls.join(' ') });
      circle.appendChild(svgEl('title', {}, c));
      g.appendChild(circle);
      const left = p.x < midX;
      g.appendChild(svgEl('text', { x: p.x + (left ? -18 : 18), y: p.y + 4, 'text-anchor': left ? 'end' : 'start', class: 'clabel' }, c));
      svg.appendChild(g);
    }
  }

  // ---------------------------------------------------------------- results
  function showResult(r, start, goal) {
    view = { path: r.path, visited: r.visited, start, goal };
    $('resultTitle').textContent = `${r.long || longName(r.algorithm)} — ${start} → ${goal}`;
    const pathEl = $('resPath');
    if (r.found) {
      pathEl.textContent = r.path.join(' → ');
      pathEl.style.color = '';
      $('resCost').textContent = `${fmt(r.cost)} km`;
    } else {
      pathEl.textContent = `No route: ${goal} cannot be reached from ${start}.`;
      pathEl.style.color = 'var(--err)';
      $('resCost').textContent = '—';
    }
    $('resSteps').textContent = String(r.steps);
    const chips = $('resVisited');
    clear(chips);
    r.visited.forEach((c, i) => {
      const chip = el('span', { className: 'chip' });
      chip.appendChild(el('b', {}, String(i + 1)));
      chip.appendChild(document.createTextNode(c));
      chips.appendChild(chip);
    });
    $('resultCard').hidden = false;
    drawMap();
  }

  function longName(label) {
    const a = RouteSearch.ALGORITHMS.find((x) => x.label === label);
    return a ? a.long : label;
  }

  function currentSelection() {
    return { start: $('start').value, goal: $('goal').value, algo: $('algo').value };
  }

  function onRun() {
    if (!graph) return;
    const { start, goal, algo } = currentSelection();
    const r = RouteSearch.run(algo, graph, start, goal);
    r.long = longName(r.algorithm);
    $('compareCard').hidden = true;
    compareResults = null;
    showResult(r, start, goal);
  }

  function onCompare() {
    if (!graph) return;
    const { start, goal } = currentSelection();
    compareResults = RouteSearch.compareAll(graph, start, goal);
    const body = $('compareTable').querySelector('tbody');
    clear(body);
    compareResults.forEach((r, i) => {
      const tr = el('tr', { className: r.optimal ? 'optimal' : '' });
      tr.appendChild(el('td', {}, r.algorithm));
      tr.appendChild(el('td', {}, r.found ? r.path.join(' → ') : 'No route'));
      tr.appendChild(el('td', { className: 'r' }, r.found ? fmt(r.cost) : '—'));
      tr.appendChild(el('td', { className: 'r' }, String(r.steps)));
      const td = el('td');
      const label = !r.found ? 'No route' : r.optimal ? '✓ Optimal' : 'Not optimal';
      td.appendChild(el('span', { className: 'badge ' + (!r.found ? 'na' : r.optimal ? 'yes' : 'no') }, label));
      tr.appendChild(td);
      tr.addEventListener('click', () => selectRow(i));
      body.appendChild(tr);
    });
    $('compareCard').hidden = false;
    // Show the first optimal result on the map by default (or the first row if none found a route).
    const first = compareResults.findIndex((r) => r.optimal);
    selectRow(first >= 0 ? first : 0);
  }

  function selectRow(i) {
    const { start, goal } = currentSelection();
    const rows = $('compareTable').querySelectorAll('tbody tr');
    rows.forEach((tr, j) => tr.classList.toggle('selected', i === j));
    showResult(compareResults[i], start, goal);
  }

  // ---------------------------------------------------------------- events
  function onFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = ''; // allow choosing the same file again
    if (!file) return;
    file.text().then((text) => {
      let obj;
      try {
        obj = JSON.parse(text);
      } catch (e) {
        showMessage(`"${file.name}" is not valid JSON: ${e.message}`, true);
        return;
      }
      if (setMap(obj)) {
        const extra = $('message').textContent;
        showMessage(`Loaded "${file.name}".` + (extra ? '\n' + extra : ''), false);
      }
    }, () => showMessage(`Could not read "${file.name}".`, true));
  }

  function init() {
    fillAlgorithms();
    $('run').addEventListener('click', onRun);
    $('compare').addEventListener('click', onCompare);
    $('mapFile').addEventListener('change', onFile);
    $('resetMap').addEventListener('click', loadDefaultMap);
    $('swap').addEventListener('click', () => {
      const s = $('start').value;
      $('start').value = $('goal').value;
      $('goal').value = s;
    });
    loadDefaultMap();
  }

  init();
})();
