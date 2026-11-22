import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup } from 'radix-ui';
import { motion, useReducedMotion } from 'motion/react';
import type { Settings } from '@/lib/settings';

const accents = [
  { name: 'Blue', color: '#3b82f6' },
  { name: 'Indigo', color: '#6366f1' },
  { name: 'Slate', color: '#64748b' },
  { name: 'Green', color: '#16a34a' },
];
const shortcuts = [
  ['Next/prev step', ['j', 'k']],
  ['Next/prev run', [']', '[']],
  ['Focus filter', ['/']],
  ['Toggle raw view', ['r']],
  ['Open settings', [',']],
] as const;

export function SettingsDialog({
  open,
  onOpenChange,
  settings,
  onChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Settings;
  onChange: (settings: Settings) => void;
}) {
  const reduced = useReducedMotion();
  function choice<K extends 'theme' | 'density' | 'timestamps'>(
    key: K,
    title: string,
    options: Settings[K][],
  ) {
    return (
      <div className="setting-row">
        <span id={`setting-${key}`}>{title}</span>
        <ToggleGroup.Root
          type="single"
          className="segmented-control"
          aria-labelledby={`setting-${key}`}
          value={settings[key]}
          onValueChange={(value) => {
            if (value) onChange({ ...settings, [key]: value });
          }}
        >
          {options.map((value) => (
            <ToggleGroup.Item key={value} value={value} className="segmented-button">
              {value[0].toUpperCase() + value.slice(1)}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>
      </div>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="settings-shell"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.querySelector<HTMLButtonElement>('[aria-label="Inspector settings"]')?.focus();
        }}
      >
        <motion.div
          className="settings-content"
          initial={reduced ? false : { scale: 0.97, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: reduced ? 0 : 0.18 }}
        >
          <DialogHeader className="settings-header">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription className="sr-only">
              Inspector preferences saved in this browser.
            </DialogDescription>
          </DialogHeader>
          <div className="settings-body scroll">
            <section className="setting-group" aria-labelledby="appearance-title">
              <h3 id="appearance-title">Appearance</h3>
              {choice('theme', 'Theme', ['light', 'dark', 'system'])}
              {choice('density', 'Density', ['compact', 'comfortable'])}
              <div className="setting-row">
                <span id="accent-label">Accent Color</span>
                <div className="accent-swatches" role="group" aria-labelledby="accent-label">
                  {accents.map((accent) => (
                    <button
                      key={accent.name}
                      type="button"
                      className="accent-swatch"
                      aria-label={`${accent.name} accent`}
                      aria-pressed={settings.accent.toLowerCase() === accent.color}
                      title={accent.name}
                      style={{ '--swatch': accent.color } as React.CSSProperties}
                      onClick={() => onChange({ ...settings, accent: accent.color })}
                    />
                  ))}
                </div>
              </div>
            </section>
            <section className="setting-group" aria-labelledby="diff-settings-title">
              <h3 id="diff-settings-title">Diff viewer</h3>
              <div className="setting-row">
                <label htmlFor="setting-wrap">Wrap long lines</label>
                <Switch
                  id="setting-wrap"
                  checked={settings.diffWrap}
                  onCheckedChange={(diffWrap) => onChange({ ...settings, diffWrap })}
                />
              </div>
              <div className="setting-row">
                <label htmlFor="setting-whitespace">Show whitespace characters</label>
                <Switch
                  id="setting-whitespace"
                  checked={settings.showWhitespace}
                  onCheckedChange={(showWhitespace) => onChange({ ...settings, showWhitespace })}
                />
              </div>
            </section>
            <section className="setting-group" aria-labelledby="time-settings-title">
              <h3 id="time-settings-title">Time &amp; formatting</h3>
              {choice('timestamps', 'Timestamp format', ['relative', 'absolute'])}
            </section>
            <section className="setting-group" aria-labelledby="shortcuts-title">
              <h3 id="shortcuts-title">Keyboard shortcuts</h3>
              <div className="shortcuts-list">
                {shortcuts.map(([label, keys]) => (
                  <div key={label} className="shortcut">
                    <span>{label}</span>
                    <span className="shortcut-keys">
                      {keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
