# Route Search Web App

**Fundamentals of Artificial Intelligence (10672224)** · Assignment 1 · Fall 2026
Faculty of Engineering and Information Technology · Instructor: Nadeem Zaid Kilani

A web app that finds a route between any two cities on a road map using **BFS, DFS, UCS, Greedy Best-First and A\***, draws the result on the map, and compares all five algorithms side by side.

## Group members

| Name | Student ID |
|------|-----------|
| Saif Khalifa | 12010798 |
| Momen Raddad | 12221022 |

## How to run

The app is plain HTML + JavaScript. There is **nothing to install**.

**Option A — local server (recommended, reads `data/westbank_map.json` directly):**

```bash
cd AiFun_RouteSearch
python -m http.server 8000      # or: python3 -m http.server 8000
```

Then open <http://localhost:8000> in any modern browser.

**Option B — just double-click `index.html`.** Browsers block reading files from disk, so the app falls back to a built-in copy of the default map (`js/default_map.js`) and tells you so. Everything else, including uploading your own JSON map, works the same.

**Run the tests (needs Node.js 16+):**

```bash
node tests/test_search.js
```

## How to use

1. **Map** – the default West Bank map loads automatically. Click *Upload a JSON map…* to use your own (same format as the Appendix). Invalid files are rejected with a list of what is wrong and the current map is kept. *Reset* brings back the default.
2. **Route** – choose the start city, goal city (any to any) and algorithm.
3. **Run search** – draws the route in blue and shows the path, total cost (km), number of steps and the order in which cities were removed from the frontier. Cities the search expanded get a yellow ring.
4. **Compare all** – runs all five algorithms on the same start/goal and shows a table of path, cost and steps with the optimal ones (lowest cost) marked. Click a row to draw that algorithm's route.

## Map file format

```json
{
  "name": "My map",
  "unit": "km",
  "cities": [ { "name": "A", "x": 0, "y": 0 }, { "name": "B", "x": 3, "y": 4 } ],
  "roads":  [ { "from": "A", "to": "B", "km": 5 } ]
}
```

Roads are two-way. `x`/`y` are in km and are only used for the heuristic. Rules checked on upload: at least 2 cities, unique names, numeric coordinates, every road connects known cities and has `km > 0`. A road listed twice keeps the shorter one; a road from a city to itself is ignored (both give a warning).

## Project structure

```
AiFun_RouteSearch/
├── index.html            page layout
├── css/style.css         styling
├── js/
│   ├── graph.js          map validation, adjacency list, heuristic h(n)
│   ├── search.js         BFS, DFS, UCS, Greedy, A*  (no libraries)
│   ├── app.js            UI: dropdowns, SVG map, results, compare table
│   └── default_map.js    built-in copy of the default map (fallback for Option B)
├── data/westbank_map.json  default map
├── tests/test_search.js    automated checks
└── README.md
```

## How the algorithms follow the assignment rules

All five algorithms share **one search loop** (`graphSearch` in `js/search.js`). Only the *frontier* (the structure that decides which node comes out next) changes:

| Algorithm | Frontier | Order by |
|-----------|----------|----------|
| BFS | FIFO queue | oldest first |
| DFS | LIFO stack | newest first |
| UCS | priority queue | g(n) |
| Greedy | priority queue | h(n) |
| A\* | priority queue | g(n) + h(n) |

* **Heuristic** – h(n) is the straight-line distance from city n to the goal from the x/y coordinates, rounded **down** (`Math.floor`).
* **Ties** – equal priority → the city that comes first alphabetically (case-insensitive). Neighbours are always generated in alphabetical order; the DFS stack pushes them in reverse so the alphabetically first one is explored first.
* **Goal test** – done when a node is *removed* from the frontier, not when it is generated.
* **Graph search** – an explored set guarantees a city is never expanded twice. Stale duplicates still sitting in the frontier are skipped.
* **Steps** – number of nodes removed from the frontier and processed (goal test + expansion). The goal node is removed from the frontier, so it **counts as one step** (e.g. BFS Jenin → Jericho = 5 steps: Jenin, Nablus, Tubas, Tulkarm, Jericho). Skipped duplicates do not count. If your instructor counts differently, change it in one place: the `steps++` line in `graphSearch`.
* **Optimal marking** – in *Compare all*, a result is optimal when its cost equals the lowest cost found among the algorithms.
* **Unreachable goal** – returns "No route", nothing crashes.

## Tests

`tests/test_search.js` checks, for all 121 start/goal pairs of the default map and all five algorithms: the route only uses real roads, the cost equals the sum of its roads, UCS matches an independent Floyd–Warshall shortest-distance calculation, A\* matches UCS, and BFS uses the fewest roads. It also checks hand-traced examples, tie-breaking, a custom map, an unreachable city, start = goal, and rejection of invalid maps.
