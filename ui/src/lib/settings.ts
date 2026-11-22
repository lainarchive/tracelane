export interface Settings {
  theme: 'dark' | 'light' | 'system';
  density: 'compact' | 'comfortable';
  diffWrap: boolean;
  showWhitespace: boolean;
  timestamps: 'relative' | 'absolute';
  accent: string;
}
export const accents = [
  { name: 'Orange', color: '#ff7a1a', light: '#c64b0c' },
  { name: 'Teal', color: '#2dd4bf', light: '#0f766e' },
  { name: 'Sky', color: '#38bdf8', light: '#0369a1' },
  { name: 'Neutral', color: '#ededed', light: '#303033' },
];
export function themeAccent(accent: string, theme: 'light' | 'dark') {
  const swatch = accents.find((swatch) => swatch.color === accent.toLowerCase()) ?? accents[0];
  return theme === 'light' ? swatch.light : swatch.color;
}
export const defaultSettings: Settings = {
  theme: 'dark',
  density: 'compact',
  diffWrap: false,
  showWhitespace: false,
  timestamps: 'relative',
  accent: '#ff7a1a',
};
export function parseSettings(value: string | null): Settings {
  const settings = { ...defaultSettings };
  try {
    const data = JSON.parse(value || '{}');
    if (!data || typeof data !== 'object') return settings;
    if (['dark', 'light', 'system'].includes(data.theme)) settings.theme = data.theme;
    if (['compact', 'comfortable'].includes(data.density)) settings.density = data.density;
    if (typeof data.diffWrap === 'boolean') settings.diffWrap = data.diffWrap;
    if (typeof data.showWhitespace === 'boolean') settings.showWhitespace = data.showWhitespace;
    if (['relative', 'absolute'].includes(data.timestamps)) settings.timestamps = data.timestamps;
    if (
      typeof data.accent === 'string' &&
      accents.some((accent) => accent.color === data.accent.toLowerCase())
    )
      settings.accent = data.accent;
  } catch {}
  return settings;
}
export function saveSettings(storage: Pick<Storage, 'setItem'>, settings: Settings) {
  try {
    storage.setItem('tracelane.settings', JSON.stringify(settings));
  } catch {}
}
export function resolvedTheme(theme: Settings['theme'], dark: boolean): 'dark' | 'light' {
  return theme === 'system' ? (dark ? 'dark' : 'light') : theme;
}
