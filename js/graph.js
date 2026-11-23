/*
 * graph.js — turns a map JSON object into a graph the search code can use.
 *
 * Responsibilities
 *   1. Validate the map (so ANY valid map works, and a bad one gives a clear message).
 *   2. Build an adjacency list where every city's neighbours are sorted alphabetically
 *      (this is how the "ties -> alphabetical" rule is applied to expansion order).
 *   3. Provide the heuristic h(n): straight-line distance from city n to the goal,
 *      computed from the x/y coordinates and rounded DOWN to a whole number.
 *
 * Works both in the browser (window.RouteGraph) and in Node (require) for the tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RouteGraph = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Case-insensitive alphabetical comparison, with a case-sensitive tie-break so it is a total order. */
  function compareNames(a, b) {
    const la = a.toLowerCase();
    const lb = b.toLowerCase();
    if (la < lb) return -1;
    if (la > lb) return 1;
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

  /** Error type that carries every problem found in a map file. */
  class MapError extends Error {
    constructor(errors) {
      super(errors.join('\n'));
      this.name = 'MapError';
      this.errors = errors;
    }
  }

  const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

  /**
   * Validate + build a graph from a parsed JSON map.
   * Returns { name, unit, cities, coords, adj, roads, warnings, compareNames, straightLine }.
   * Throws MapError listing all problems if the map is invalid.
   */
  function fromMap(obj) {
    const errors = [];
    const warnings = [];

    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      throw new MapError(['The file must contain a JSON object with "cities" and "roads".']);
    }
    if (!Array.isArray(obj.cities)) errors.push('"cities" must be an array.');
    if (!Array.isArray(obj.roads)) errors.push('"roads" must be an array.');
    if (errors.length) throw new MapError(errors);

    // ---- cities ----
    const coords = new Map(); // name -> {x, y}
    const cities = []; // names, in file order
    obj.cities.forEach((c, i) => {
      const where = `cities[${i}]`;
      if (c === null || typeof c !== 'object') {
        errors.push(`${where} must be an object like { "name": "A", "x": 0, "y": 0 }.`);
        return;
      }
      const name = typeof c.name === 'string' ? c.name.trim() : '';
      if (!name) {
        errors.push(`${where} has no "name" (needs a non-empty text).`);
        return;
      }
      if (!isNum(c.x) || !isNum(c.y)) {
        errors.push(`${where} ("${name}") needs numeric "x" and "y" coordinates.`);
        return;
      }
      if (coords.has(name)) {
        errors.push(`City name "${name}" appears more than once.`);
        return;
      }
      coords.set(name, { x: c.x, y: c.y });
      cities.push(name);
    });
    if (cities.length < 2 && errors.length === 0) errors.push('The map needs at least 2 cities.');

    // ---- roads ----
    const edgeKm = new Map(); // "A|B" (sorted) -> km (smallest if duplicated)
    const roads = [];
    obj.roads.forEach((r, i) => {
      const where = `roads[${i}]`;
      if (r === null || typeof r !== 'object') {
        errors.push(`${where} must be an object like { "from": "A", "to": "B", "km": 10 }.`);
        return;
      }
      const from = typeof r.from === 'string' ? r.from.trim() : '';
      const to = typeof r.to === 'string' ? r.to.trim() : '';
      if (!from || !to) {
        errors.push(`${where} needs "from" and "to" city names.`);
        return;
      }
      if (!coords.has(from)) errors.push(`${where}: unknown city "${from}".`);
      if (!coords.has(to)) errors.push(`${where}: unknown city "${to}".`);
      if (!isNum(r.km) || r.km <= 0) {
        errors.push(`${where} (${from} – ${to}) needs a positive number for "km".`);
      }
      if (!coords.has(from) || !coords.has(to) || !isNum(r.km) || r.km <= 0) return;
      if (from === to) {
        warnings.push(`Ignored road ${from} – ${to}: it connects a city to itself.`);
        return;
      }
      const key = compareNames(from, to) <= 0 ? `${from}|${to}` : `${to}|${from}`;
      if (edgeKm.has(key)) {
        warnings.push(`Road ${from} – ${to} is listed twice; the shorter one is used.`);
        edgeKm.set(key, Math.min(edgeKm.get(key), r.km));
      } else {
        edgeKm.set(key, r.km);
      }
    });

    if (errors.length) {
      const shown = errors.slice(0, 10);
      if (errors.length > 10) shown.push(`…and ${errors.length - 10} more problem(s).`);
      throw new MapError(shown);
    }

    // ---- adjacency list (roads are two-way, neighbours sorted alphabetically) ----
    const adj = new Map(cities.map((c) => [c, []]));
    for (const [key, km] of edgeKm) {
      const [a, b] = key.split('|');
      adj.get(a).push({ to: b, km });
      adj.get(b).push({ to: a, km });
      roads.push({ from: a, to: b, km });
    }
    for (const list of adj.values()) list.sort((p, q) => compareNames(p.to, q.to));

    /** h(a, b): straight-line distance in km between two cities, rounded down. */
    function straightLine(a, b) {
      const p = coords.get(a);
      const q = coords.get(b);
      return Math.floor(Math.hypot(p.x - q.x, p.y - q.y));
    }

    return {
      name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : 'Custom map',
      unit: typeof obj.unit === 'string' ? obj.unit : 'km',
      cities,
      coords,
      adj,
      roads,
      warnings,
      compareNames,
      straightLine,
    };
  }

  return { fromMap, compareNames, MapError };
});
