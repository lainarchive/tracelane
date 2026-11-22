export interface Settings {
  theme: 'dark' | 'light' | 'system';
  density: 'compact' | 'comfortable';
  diffWrap: boolean;
  timestamps: 'relative' | 'absolute';
  accent: string;
}
export const defaultSettings: Settings = {
  theme: 'dark',
  density: 'compact',
  diffWrap: false,
  timestamps: 'relative',
  accent: '#5e6ad2',
};
export function parseSettings(value: string | null): Settings {
  const settings = { ...defaultSettings };
  try {
    const data = JSON.parse(value || '{}');
    if (!data || typeof data !== 'object') return settings;
    if (['dark', 'light', 'system'].includes(data.theme)) settings.theme = data.theme;
    if (['compact', 'comfortable'].includes(data.density)) settings.density = data.density;
    if (typeof data.diffWrap === 'boolean') settings.diffWrap = data.diffWrap;
    if (['relative', 'absolute'].includes(data.timestamps)) settings.timestamps = data.timestamps;
    if (typeof data.accent === 'string' && /^#[0-9a-f]{6}$/i.test(data.accent))
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
