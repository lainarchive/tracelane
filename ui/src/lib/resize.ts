export interface Sizes {
  sidebar: number;
  timeline: number;
  diff: number;
}
export function parseSizes(value: string | null): Partial<Sizes> {
  try {
    const parsed = JSON.parse(value || '{}');
    return Object.fromEntries(
      ['sidebar', 'timeline', 'diff']
        .filter((key) => typeof parsed?.[key] === 'number' && Number.isFinite(parsed[key]))
        .map((key) => [key, parsed[key]]),
    );
  } catch {
    return {};
  }
}
export function clampSizes(sizes: Partial<Sizes>, width: number): Sizes {
  const sidebar = Math.max(
    170,
    Math.min(sizes.sidebar ?? (width <= 1300 ? 224 : 260), width - 760),
  );
  const timeline = Math.max(
    240,
    Math.min(sizes.timeline ?? (width <= 1300 ? 300 : 320), width - sidebar - 426),
  );
  return { sidebar, timeline, diff: Math.max(22, Math.min(76, sizes.diff ?? 51)) };
}
export function saveSizes(storage: Pick<Storage, 'setItem'>, sizes: Partial<Sizes>) {
  try {
    storage.setItem('tracelane.panes', JSON.stringify(sizes));
  } catch {}
}
