// Longest-processing-time-first assignment of units to runners, weighted by free parallel slots.
// A runner with S slots finishes its load L in about ceil(L / S) of wall time; we minimise the largest finish time.
export function plan(units, runners, { timings = {} } = {}) {
  const live = runners.filter((r) => r.enabled !== false)
  if (!live.length) throw new Error('no enabled runner')
  const est = (u) => Math.max(1, Number(timings[u.id] ?? u.estMinutes ?? 10))
  const slots = (r) => Math.max(1, Number(r.freeSlots ?? r.maxParallel ?? 20))
  const state = live.map((r) => ({ runner: r, units: [], lanes: Array(slots(r)).fill(0) }))
  const sorted = [...units].sort((a, b) => est(b) - est(a) || a.id.localeCompare(b.id))
  for (const u of sorted) {
    const allowed = state.filter((s) => !(u.avoidRunners ?? []).includes(s.runner.name))
    const pool = allowed.length ? allowed : state
    let best = null, bestLane = 0, bestEnd = Infinity
    for (const s of pool) {
      const lane = s.lanes.indexOf(Math.min(...s.lanes))
      const end = s.lanes[lane] + est(u)
      // ties (several idle runners): spread over runners, fewest units first
      if (end < bestEnd || (end === bestEnd && s.units.length < best.units.length)) { best = s; bestLane = lane; bestEnd = end }
    }
    best.lanes[bestLane] = bestEnd
    best.units.push(u)
  }
  const out = state.filter((s) => s.units.length).map((s) => ({ runner: s.runner.name, units: s.units.map((u) => u.id), estWallMinutes: Math.max(...s.lanes), slots: s.lanes.length }))
  return { assignments: out, estWallMinutes: Math.max(0, ...out.map((a) => a.estWallMinutes)), units: units.length }
}
