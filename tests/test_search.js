/*
 * Run with:  node tests/test_search.js
 *
 * Checks the search code against independent references:
 *   - every route is a real walk over existing roads, and its cost is the sum of its roads
 *   - UCS cost == shortest distance from Floyd-Warshall (independent algorithm)
 *   - A* cost == UCS cost on the default map
 *   - BFS finds the fewest-roads route
 *   - hand-traced examples (tie-breaking, step counting)
 *   - bad maps are rejected with clear messages; disconnected maps / start==goal behave
 */
const fs = require('fs');
const path = require('path');
const RouteGraph = require('../js/graph.js');
const RouteSearch = require('../js/search.js');

let passed = 0;
let failed = 0;
function check(cond, msg) {
  if (cond) passed++;
  else {
    failed++;
    console.log('  FAIL: ' + msg);
  }
}
function section(t) {
  console.log('\n' + t);
}

const mapObj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'westbank_map.json'), 'utf8'));
const graph = RouteGraph.fromMap(mapObj);
const cities = graph.cities;

// ---- independent reference: Floyd-Warshall shortest distances ----
const idx = new Map(cities.map((c, i) => [c, i]));
const N = cities.length;
const D = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? 0 : Infinity)));
for (const r of graph.roads) {
  D[idx.get(r.from)][idx.get(r.to)] = r.km;
  D[idx.get(r.to)][idx.get(r.from)] = r.km;
}
for (let k = 0; k < N; k++)
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) if (D[i][k] + D[k][j] < D[i][j]) D[i][j] = D[i][k] + D[k][j];

// hop counts (for BFS) via Floyd-Warshall with weight 1
const H = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? 0 : Infinity)));
for (const r of graph.roads) {
  H[idx.get(r.from)][idx.get(r.to)] = 1;
  H[idx.get(r.to)][idx.get(r.from)] = 1;
}
for (let k = 0; k < N; k++)
  for (let i = 0; i < N; i++)
    for (let j = 0; j < N; j++) if (H[i][k] + H[k][j] < H[i][j]) H[i][j] = H[i][k] + H[k][j];

function roadKm(a, b) {
  const e = graph.adj.get(a).find((x) => x.to === b);
  return e ? e.km : null;
}

section('Default map: all ' + N * N + ' start/goal pairs x 5 algorithms');
let astarSuboptimal = [];
for (const s of cities) {
  for (const g of cities) {
    const results = RouteSearch.compareAll(graph, s, g);
    for (const r of results) {
      const tag = `${r.algorithm} ${s}->${g}`;
      check(r.found, `${tag}: should find a route (map is connected)`);
      if (!r.found) continue;
      check(r.path[0] === s && r.path[r.path.length - 1] === g, `${tag}: path endpoints`);
      check(new Set(r.path).size === r.path.length, `${tag}: path repeats a city`);
      let sum = 0;
      let ok = true;
      for (let i = 0; i + 1 < r.path.length; i++) {
        const km = roadKm(r.path[i], r.path[i + 1]);
        if (km === null) ok = false;
        else sum += km;
      }
      check(ok, `${tag}: path uses a road that does not exist`);
      check(Math.abs(sum - r.cost) < 1e-9, `${tag}: cost ${r.cost} != sum of roads ${sum}`);
      check(r.steps >= 1 && r.steps <= N, `${tag}: steps ${r.steps} out of range`);
      check(r.visited.length === r.steps, `${tag}: visited list length != steps`);
      check(new Set(r.visited).size === r.visited.length, `${tag}: a city was processed twice`);
    }
    const by = Object.fromEntries(results.map((r) => [r.id, r]));
    check(by.ucs.cost === D[idx.get(s)][idx.get(g)], `UCS ${s}->${g}: ${by.ucs.cost} != Floyd-Warshall ${D[idx.get(s)][idx.get(g)]}`);
    if (by.astar.cost !== by.ucs.cost) astarSuboptimal.push(`${s}->${g} (A* ${by.astar.cost} vs ${by.ucs.cost})`);
    check(by.bfs.path.length - 1 === H[idx.get(s)][idx.get(g)], `BFS ${s}->${g}: not fewest roads`);
    check(by.ucs.optimal, `UCS ${s}->${g} must be flagged optimal`);
    check(results.some((r) => r.optimal), `${s}->${g}: someone must be optimal`);
  }
}
check(astarSuboptimal.length === 0, 'A* differs from UCS on: ' + astarSuboptimal.join(', '));

section('Hand-traced examples');
{
  // Jenin -> Jericho
  const r = RouteSearch.compareAll(graph, 'Jenin', 'Jericho');
  const by = Object.fromEntries(r.map((x) => [x.id, x]));
  // BFS: Jenin, Nablus, Tubas, Tulkarm, Jericho  -> 5 steps, via Nablus (42+70)
  check(by.bfs.path.join('>') === 'Jenin>Nablus>Jericho' && by.bfs.cost === 112 && by.bfs.steps === 5, 'BFS Jenin->Jericho: ' + JSON.stringify(by.bfs));
  check(by.ucs.path.join('>') === 'Jenin>Tubas>Jericho' && by.ucs.cost === 97, 'UCS Jenin->Jericho: ' + JSON.stringify(by.ucs));
  check(by.astar.cost === 97, 'A* Jenin->Jericho cost');
  check(!by.bfs.optimal && by.ucs.optimal, 'optimal flags Jenin->Jericho');
}
{
  const r = RouteSearch.ucs(graph, 'Jenin', 'Hebron');
  check(r.cost === 144 && r.path.join('>') === 'Jenin>Nablus>Ramallah>Jerusalem>Bethlehem>Hebron', 'UCS Jenin->Hebron: ' + JSON.stringify(r));
}
{
  // heuristic is floor of straight-line distance
  check(graph.straightLine('Jerusalem', 'Bethlehem') === Math.floor(Math.hypot(22.231 - 19.109, 30.858 - 22.755)), 'heuristic floor');
  check(graph.straightLine('Jerusalem', 'Bethlehem') === 8, 'h(Jerusalem, Bethlehem) = 8');
  check(graph.straightLine('Hebron', 'Hebron') === 0, 'h(goal) = 0');
}
{
  // DFS tie-break: alphabetical first. From Jenin: Jenin -> Nablus (alphabetical first neighbour)
  const r = RouteSearch.dfs(graph, 'Jenin', 'Hebron');
  check(r.visited[0] === 'Jenin' && r.visited[1] === 'Nablus', 'DFS goes to alphabetically-first neighbour first: ' + r.visited.slice(0, 3));
}

section('Edge cases');
{
  const r = RouteSearch.run('astar', graph, 'Nablus', 'Nablus');
  check(r.found && r.path.join() === 'Nablus' && r.cost === 0 && r.steps === 1, 'start == goal');
}
{
  const m = {
    cities: [
      { name: 'A', x: 0, y: 0 },
      { name: 'B', x: 3, y: 4 },
      { name: 'C', x: 10, y: 10 },
      { name: 'Z', x: 0, y: 1 },
    ],
    roads: [
      { from: 'A', to: 'B', km: 5 },
      { from: 'B', to: 'C', km: 9 },
      { from: 'A', to: 'C', km: 20 },
    ],
  };
  const g = RouteGraph.fromMap(m);
  const res = RouteSearch.compareAll(g, 'A', 'C');
  check(res.find((r) => r.id === 'ucs').cost === 14, 'custom map UCS cost 14');
  check(res.find((r) => r.id === 'astar').cost === 14, 'custom map A* cost 14');
  const un = RouteSearch.compareAll(g, 'A', 'Z');
  check(un.every((r) => !r.found && r.path.length === 0 && r.cost === null && !r.optimal), 'unreachable city: no route, none optimal');
  check(un.every((r) => r.steps >= 1), 'unreachable: steps still counted');
  // tie: A -> D via B (cost 2+2) or via C (cost 2+2); alphabetical B first
  const t = RouteGraph.fromMap({
    cities: [
      { name: 'A', x: 0, y: 0 },
      { name: 'C', x: 1, y: 1 },
      { name: 'B', x: 1, y: -1 },
      { name: 'D', x: 2, y: 0 },
    ],
    roads: [
      { from: 'A', to: 'C', km: 2 },
      { from: 'A', to: 'B', km: 2 },
      { from: 'B', to: 'D', km: 2 },
      { from: 'C', to: 'D', km: 2 },
    ],
  });
  check(RouteSearch.ucs(t, 'A', 'D').path.join('') === 'ABD', 'UCS tie -> alphabetical (A,B,D)');
  check(RouteSearch.bfs(t, 'A', 'D').path.join('') === 'ABD', 'BFS tie -> alphabetical');
  check(RouteSearch.dfs(t, 'A', 'D').path.join('') === 'ABD', 'DFS tie -> alphabetical');
  check(RouteSearch.astar(t, 'A', 'D').path.join('') === 'ABD', 'A* tie -> alphabetical');
}

section('Invalid maps are rejected');
function rejects(label, obj, expectText) {
  try {
    RouteGraph.fromMap(obj);
    check(false, label + ': should have been rejected');
  } catch (e) {
    check(e instanceof RouteGraph.MapError, label + ': wrong error type ' + e);
    if (expectText) check(e.message.includes(expectText), `${label}: message "${e.message}" lacks "${expectText}"`);
  }
}
rejects('null', null);
rejects('array', []);
rejects('no cities', { roads: [] }, 'cities');
rejects('no roads', { cities: [] }, 'roads');
rejects('one city', { cities: [{ name: 'A', x: 0, y: 0 }], roads: [] }, 'at least 2');
rejects('dup city', { cities: [{ name: 'A', x: 0, y: 0 }, { name: 'A', x: 1, y: 1 }], roads: [] }, 'more than once');
rejects('bad coords', { cities: [{ name: 'A', x: 'a', y: 0 }, { name: 'B', x: 1, y: 1 }], roads: [] }, 'numeric');
rejects('unknown city', { cities: [{ name: 'A', x: 0, y: 0 }, { name: 'B', x: 1, y: 1 }], roads: [{ from: 'A', to: 'Q', km: 3 }] }, 'unknown city "Q"');
rejects('bad km', { cities: [{ name: 'A', x: 0, y: 0 }, { name: 'B', x: 1, y: 1 }], roads: [{ from: 'A', to: 'B', km: -3 }] }, 'positive');
{
  const g = RouteGraph.fromMap({
    cities: [{ name: 'A', x: 0, y: 0 }, { name: 'B', x: 1, y: 1 }],
    roads: [{ from: 'A', to: 'B', km: 7 }, { from: 'B', to: 'A', km: 5 }, { from: 'A', to: 'A', km: 1 }],
  });
  check(g.warnings.length === 2, 'duplicate + self-loop produce warnings');
  check(RouteSearch.ucs(g, 'A', 'B').cost === 5, 'duplicate road: shorter kept');
}

console.log(`\n${passed} checks passed, ${failed} failed.`);
process.exit(failed ? 1 : 0);
