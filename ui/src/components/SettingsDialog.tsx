import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { Settings } from '@/lib/settings';

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
  function choice<K extends 'theme' | 'density' | 'timestamps'>(
    key: K,
    title: string,
    options: Settings[K][],
  ) {
    return (
      <div className="setting-row">
        <label htmlFor={`setting-${key}`}>{title}</label>
        <Select
          value={settings[key]}
          onValueChange={(value) => onChange({ ...settings, [key]: value })}
        >
          <SelectTrigger id={`setting-${key}`} className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((value) => (
              <SelectItem key={value} value={value}>
                {value[0].toUpperCase() + value.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="settings-content"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.querySelector<HTMLButtonElement>('[aria-label="Inspector settings"]')?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Inspector settings</DialogTitle>
          <DialogDescription>
            Saved in this browser. Press comma to open settings.
          </DialogDescription>
        </DialogHeader>
        {choice('theme', 'Theme', ['dark', 'light', 'system'])}
        {choice('density', 'Density', ['compact', 'comfortable'])}
        {choice('timestamps', 'Timestamps', ['relative', 'absolute'])}
        <div className="setting-row">
          <label htmlFor="setting-wrap">Wrap diff lines</label>
          <Switch
            id="setting-wrap"
            checked={settings.diffWrap}
            onCheckedChange={(value) => onChange({ ...settings, diffWrap: value })}
          />
        </div>
        <div className="setting-row">
          <label htmlFor="setting-accent">Selection accent</label>
          <input
            id="setting-accent"
            type="color"
            value={settings.accent}
            onChange={(event) => onChange({ ...settings, accent: event.target.value })}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
