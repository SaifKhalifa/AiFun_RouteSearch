/*
 * search.js — BFS, DFS, UCS, Greedy Best-First and A*, written from scratch
 * (no search / graph library is used).
 *
 * KEY IDEA: all five algorithms share ONE loop (graphSearch below).
 * The only thing that differs is the FRONTIER — the data structure that decides
 * which node is removed next:
 *
 *      BFS     -> Queue (FIFO)
 *      DFS     -> Stack (LIFO)
 *      UCS     -> Priority queue ordered by g(n)          (cost so far)
 *      Greedy  -> Priority queue ordered by h(n)          (guess to the goal)
 *      A*      -> Priority queue ordered by g(n) + h(n)
 *
 * Assignment rules implemented here
 *   - Graph search: a city is never expanded twice (explored set).
 *   - Goal test is applied when a node is REMOVED from the frontier, not when generated.
 *   - Ties: equal priority -> the city that comes first alphabetically.
 *   - h(n) = straight-line distance to the goal, rounded down (see graph.js).
 *   - Steps = number of nodes removed from the frontier and processed
 *     (goal test + expansion). The goal node itself is removed, so it counts as a step.
 *     Stale duplicates (a city already explored) are skipped and NOT counted.
 *
 * Works both in the browser (window.RouteSearch) and in Node (require) for the tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RouteSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-9;

  // ------------------------------------------------------------------
  // Frontiers. Each one exposes: isEmpty(), pushAll(nodes), pop()
  // `nodes` passed to pushAll are the children of one expansion,
  // already sorted alphabetically.
  // ------------------------------------------------------------------

  /** FIFO queue (BFS). Oldest node first. */
  class QueueFrontier {
    constructor() {
      this.items = [];
      this.head = 0;
    }
    isEmpty() {
      return this.head >= this.items.length;
    }
    pushAll(nodes) {
      for (const n of nodes) this.items.push(n);
    }
    pop() {
      return this.items[this.head++];
    }
  }

  /** LIFO stack (DFS). Newest node first. */
  class StackFrontier {
    constructor() {
      this.items = [];
    }
    isEmpty() {
      return this.items.length === 0;
    }
    pushAll(nodes) {
      // Push in REVERSE alphabetical order, so the alphabetically-first child
      // ends up on top of the stack and is explored first.
      for (let i = nodes.length - 1; i >= 0; i--) this.items.push(nodes[i]);
    }
    pop() {
      return this.items.pop();
    }
  }

  /**
   * Binary min-heap priority queue (UCS, Greedy, A*).
   * Order: smaller priority first; if equal -> alphabetical city name;
   * if still equal -> the one inserted first (so results are deterministic).
   */
  class PriorityFrontier {
    constructor(priorityOf, compareNames) {
      this.heap = [];
      this.priorityOf = priorityOf; // node -> number
      this.compareNames = compareNames;
      this.counter = 0; // insertion order
    }
    isEmpty() {
      return this.heap.length === 0;
    }
    less(a, b) {
      if (Math.abs(a.key - b.key) > EPS) return a.key < b.key;
      const c = this.compareNames(a.node.city, b.node.city);
      if (c !== 0) return c < 0;
      return a.seq < b.seq;
    }
    pushAll(nodes) {
      for (const node of nodes) {
        this.heap.push({ key: this.priorityOf(node), node, seq: this.counter++ });
        this.siftUp(this.heap.length - 1);
      }
    }
    pop() {
      const h = this.heap;
      const top = h[0];
      const last = h.pop();
      if (h.length > 0) {
        h[0] = last;
        this.siftDown(0);
      }
      return top.node;
    }
    siftUp(i) {
      const h = this.heap;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!this.less(h[i], h[p])) break;
        [h[i], h[p]] = [h[p], h[i]];
        i = p;
      }
    }
    siftDown(i) {
      const h = this.heap;
      const n = h.length;
      for (;;) {
        let s = i;
        const l = 2 * i + 1;
        const r = l + 1;
        if (l < n && this.less(h[l], h[s])) s = l;
        if (r < n && this.less(h[r], h[s])) s = r;
        if (s === i) break;
        [h[i], h[s]] = [h[s], h[i]];
        i = s;
      }
    }
  }

  // ------------------------------------------------------------------
  // The shared search loop
  // ------------------------------------------------------------------

  /** Rebuild the route by following parent links from the goal back to the start. */
  function buildPath(node) {
    const path = [];
    for (let n = node; n; n = n.parent) path.push(n.city);
    return path.reverse();
  }

  const round6 = (v) => Math.round(v * 1e6) / 1e6;

  /**
   * Generic graph search.
   * node = { city, parent, g }   (g = total km from the start along this path)
   */
  function graphSearch(graph, start, goal, frontier, label) {
    if (!graph.adj.has(start)) throw new Error(`Unknown start city: ${start}`);
    if (!graph.adj.has(goal)) throw new Error(`Unknown goal city: ${goal}`);

    const explored = new Set(); // cities already expanded
    const visited = []; // order in which nodes were removed from the frontier (and processed)
    let steps = 0;

    frontier.pushAll([{ city: start, parent: null, g: 0 }]);

    while (!frontier.isEmpty()) {
      const node = frontier.pop(); // remove from the frontier

      if (explored.has(node.city)) continue; // stale duplicate: never expand a city twice

      steps++;
      visited.push(node.city);

      // Goal test happens HERE (on removal), not when the node was generated.
      if (node.city === goal) {
        return {
          algorithm: label,
          found: true,
          path: buildPath(node),
          cost: round6(node.g),
          steps,
          visited,
        };
      }

      // Expand: mark explored, create children (neighbours are already alphabetical).
      explored.add(node.city);
      const children = [];
      for (const edge of graph.adj.get(node.city)) {
        if (explored.has(edge.to)) continue;
        children.push({ city: edge.to, parent: node, g: node.g + edge.km });
      }
      frontier.pushAll(children);
    }

    // Frontier ran out: the goal is not reachable from the start.
    return { algorithm: label, found: false, path: [], cost: null, steps, visited };
  }

  // ------------------------------------------------------------------
  // The five algorithms
  // ------------------------------------------------------------------

  function bfs(graph, start, goal) {
    return graphSearch(graph, start, goal, new QueueFrontier(), 'BFS');
  }

  function dfs(graph, start, goal) {
    return graphSearch(graph, start, goal, new StackFrontier(), 'DFS');
  }

  function ucs(graph, start, goal) {
    const f = new PriorityFrontier((n) => n.g, graph.compareNames);
    return graphSearch(graph, start, goal, f, 'UCS');
  }

  function greedy(graph, start, goal) {
    const f = new PriorityFrontier((n) => graph.straightLine(n.city, goal), graph.compareNames);
    return graphSearch(graph, start, goal, f, 'Greedy');
  }

  function astar(graph, start, goal) {
    const f = new PriorityFrontier(
      (n) => n.g + graph.straightLine(n.city, goal),
      graph.compareNames
    );
    return graphSearch(graph, start, goal, f, 'A*');
  }

  const ALGORITHMS = [
    { id: 'bfs', label: 'BFS', long: 'Breadth-First Search', fn: bfs },
    { id: 'dfs', label: 'DFS', long: 'Depth-First Search', fn: dfs },
    { id: 'ucs', label: 'UCS', long: 'Uniform-Cost Search', fn: ucs },
    { id: 'greedy', label: 'Greedy', long: 'Greedy Best-First Search', fn: greedy },
    { id: 'astar', label: 'A*', long: 'A* Search', fn: astar },
  ];

  /** Run one algorithm by id ("bfs" | "dfs" | "ucs" | "greedy" | "astar"). */
  function run(id, graph, start, goal) {
    const algo = ALGORITHMS.find((a) => a.id === id);
    if (!algo) throw new Error(`Unknown algorithm: ${id}`);
    return algo.fn(graph, start, goal);
  }

  /**
   * Run every algorithm on the same start/goal and mark which results are optimal
   * (their cost equals the lowest cost found by any algorithm).
   */
  function compareAll(graph, start, goal) {
    const results = ALGORITHMS.map((a) => ({ id: a.id, long: a.long, ...a.fn(graph, start, goal) }));
    const costs = results.filter((r) => r.found).map((r) => r.cost);
    const best = costs.length ? Math.min(...costs) : null;
    for (const r of results) r.optimal = r.found && Math.abs(r.cost - best) < EPS;
    return results;
  }

  return { ALGORITHMS, run, compareAll, bfs, dfs, ucs, greedy, astar };
});
