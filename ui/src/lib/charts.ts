const latency = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

export function waterfall(values: number[]) {
  let total = 0;
  const spans = values.map((value) => {
    const start = total;
    total += latency(value);
    return { start, end: total };
  });
  return { total, spans };
}

export function sparklinePath(values: number[], width = 80, height = 24): string {
  const clean = values.map(latency);
  const max = Math.max(1, ...clean);
  return clean
    .map((value, index) => {
      const x = clean.length === 1 ? width / 2 : 2 + (index / (clean.length - 1)) * (width - 4);
      const y = height - 2 - (value / max) * (height - 4);
      return `${index ? 'L' : 'M'}${Number(x.toFixed(2))} ${Number(y.toFixed(2))}`;
    })
    .join(' ');
}

export function forkLanes(runs: { id: string; parent_run_id: string | null }[]) {
  const rows = new Map(runs.map((run, row) => [run.id, row]));
  const lanes = new Map<string, number>();
  function lane(id: string, visited = new Set<string>()): number {
    if (lanes.has(id)) return lanes.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);
    const parent = runs[rows.get(id)!]?.parent_run_id;
    const value = parent && rows.has(parent) ? lane(parent, visited) + 1 : 0;
    lanes.set(id, value);
    return value;
  }
  return runs.map((run) => ({
    id: run.id,
    lane: lane(run.id),
    parentRow: rows.get(run.parent_run_id ?? '') ?? null,
  }));
}

type MapFile = { path: string; hunks: { lines: { kind: string }[] }[] };
export function minimapPositions(files: MapFile[]) {
  const total = files.reduce(
    (sum, file) => sum + file.hunks.reduce((n, hunk) => n + hunk.lines.length, 0),
    0,
  );
  const result: { path: string; hunk: number; kind: string; start: number; size: number }[] = [];
  let row = 0;
  for (const file of files)
    file.hunks.forEach((hunk, index) => {
      let previous: (typeof result)[number] | undefined;
      for (const line of hunk.lines) {
        if (line.kind !== 'context') {
          if (previous?.kind === line.kind) previous.size += 1 / total;
          else {
            previous = {
              path: file.path,
              hunk: index,
              kind: line.kind,
              start: row / total,
              size: 1 / total,
            };
            result.push(previous);
          }
        } else previous = undefined;
        row++;
      }
    });
  return result;
}
