import { useEffect, useState } from 'react';
import { Search, CornerDownLeft, Copy } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { filterCommands, type PaletteEntry } from '@/lib/studio';

export interface Command extends PaletteEntry {
  run: () => void;
}
export function CommandPalette({
  open,
  onOpenChange,
  commands,
  replay,
  onReplayClose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
  replay?: string;
  onReplayClose?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const [copyState, setCopyState] = useState('');
  const results = filterCommands(commands, query);
  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      setCopyState('');
    }
  }, [open, replay]);
  useEffect(() => {
    document.getElementById(`palette-option-${index}`)?.scrollIntoView({ block: 'nearest' });
  }, [index, query]);
  function execute(command: Command) {
    onOpenChange(false);
    command.run();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="command-palette"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          document.querySelector<HTMLButtonElement>('[aria-label="Open command menu"]')?.focus();
        }}
      >
        <DialogTitle className="sr-only">
          {replay ? 'Replay from selected step' : 'Command menu'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Search actions, runs, steps and files. Replay commands are copied, never executed by the
          browser.
        </DialogDescription>
        {replay ? (
          <div className="replay-command">
            <h2>Replay from this step</h2>
            <p>The UI cannot execute commands. Run this in your workspace terminal.</p>
            <p className="replay-warning" role="note">
              Restores the workspace snapshot: overwrites edits and deletes newer non-ignored files.
            </p>
            <textarea
              aria-label="Replay command"
              readOnly
              value={replay}
              onFocus={(event) => event.target.select()}
            />
            <div className="replay-copy">
              <button
                className="studio-button primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(replay);
                    setCopyState('Copied to clipboard');
                  } catch {
                    setCopyState('Copy unavailable. Select and copy the command above.');
                  }
                }}
              >
                <Copy size={14} />
                Copy command
              </button>
              <button className="studio-button" onClick={onReplayClose}>
                Back to commands
              </button>
            </div>
            <p role="status">{copyState}</p>
          </div>
        ) : (
          <>
            <div className="palette-search">
              <Search size={18} />
              <input
                aria-label="Search commands"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-results"
                aria-autocomplete="list"
                aria-activedescendant={results[index] ? `palette-option-${index}` : undefined}
                placeholder="Search actions, runs, steps, files…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    setIndex((current) =>
                      Math.max(
                        0,
                        Math.min(
                          results.length - 1,
                          current + (event.key === 'ArrowDown' ? 1 : -1),
                        ),
                      ),
                    );
                  }
                  if (event.key === 'Enter' && results[index]) {
                    event.preventDefault();
                    execute(results[index]);
                  }
                }}
              />
              <kbd>esc</kbd>
            </div>
            <div
              className="palette-results"
              id="palette-results"
              role="listbox"
              aria-label="Commands"
            >
              {!results.length && (
                <div className="empty">
                  No matching commands. Try a run id, step number or file path.
                </div>
              )}
              {results.map((command, i) => (
                <button
                  id={`palette-option-${i}`}
                  key={command.id}
                  role="option"
                  aria-selected={i === index}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => execute(command)}
                >
                  <span>{command.label}</span>
                  {i === index && <CornerDownLeft size={14} />}
                </button>
              ))}
            </div>
            <div className="palette-footer">
              <span>
                <kbd>↑</kbd> <kbd>↓</kbd> navigate
              </span>
              <span>
                <kbd>↵</kbd> choose
              </span>
              <span className="end">tracelane</span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
