export function selectionFromHash(
  hash: string,
  runs: { id: string }[],
): { run: string; step?: number } | null {
  if (!runs.length) return null;
  try {
    const [id, step] = hash.replace(/^#/, '').split('/');
    const run = runs.find((run) => run.id === decodeURIComponent(id || '')) || runs[0];
    const index = Number(step);
    return { run: run.id, ...(Number.isInteger(index) && index > 0 ? { step: index } : {}) };
  } catch {
    return { run: runs[0].id };
  }
}
