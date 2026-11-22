import { Fragment, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type { Diff } from '@/lib/types';
import { visibleWhitespace } from '@/lib/whitespace';
import { minimapPositions } from '@/lib/charts';

const changeClass = (file: Diff) =>
  file.change === 'A' ? 'added' : file.change === 'D' ? 'deleted' : 'modified';
export function DiffPanel({
  files,
  showWhitespace = false,
}: {
  files: Diff[];
  showWhitespace?: boolean;
}) {
  const [active, setActive] = useState(files[0]?.path);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const hunks = useRef(new Map<string, HTMLDivElement>());
  const marks = minimapPositions(files);
  function jump(path: string, hunk: number) {
    setActive(path);
    collapse(path, true);
    requestAnimationFrame(() =>
      hunks.current.get(`${path}/${hunk}`)?.scrollIntoView({ block: 'start' }),
    );
  }
  function collapse(path: string, open: boolean) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (open) next.delete(path);
      else next.add(path);
      return next;
    });
  }
  return (
    <>
      {files.length > 0 && (
        <nav className="file-list" aria-label="Changed files">
          {files.map((file) => (
            <button
              key={file.path}
              className={`file-tab mono ${active === file.path ? 'selected' : ''}`}
              aria-pressed={active === file.path}
              title={file.path}
              onClick={() => {
                setActive(file.path);
                collapse(file.path, true);
                nodes.current.get(file.path)?.scrollIntoView({ block: 'start' });
              }}
            >
              <span className={changeClass(file)}>{file.change}</span>
              <span className="path ellipsis">{file.path}</span>
              <span className="added">+{file.added_lines}</span>
              <span className="deleted">-{file.deleted_lines}</span>
            </button>
          ))}
        </nav>
      )}
      <div className="diff-layout">
        <div id="diff" className="scroll diff-body">
          {!files.length && <div className="empty">No file changes in this step.</div>}
          {files.map((file) => (
            <Collapsible
              key={file.path}
              className="file"
              open={!collapsed.has(file.path)}
              onOpenChange={(open) => collapse(file.path, open)}
              ref={(node) => {
                if (node) nodes.current.set(file.path, node);
                else nodes.current.delete(file.path);
              }}
            >
              <CollapsibleTrigger className="file-head mono" title={file.path}>
                {collapsed.has(file.path) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className={changeClass(file)}>{file.change}</span>
                <span className="ellipsis">{file.path}</span>
                <span className="end added">+{file.added_lines}</span>
                <span className="deleted">-{file.deleted_lines}</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {file.note && <div className="empty">{file.note}</div>}
                <div className="file-code">
                  <div className="diff-table mono">
                    {file.hunks.map((hunk, index) => (
                      <Fragment key={index}>
                        <div
                          className="hunk"
                          ref={(node) => {
                            const key = `${file.path}/${index}`;
                            if (node) hunks.current.set(key, node);
                            else hunks.current.delete(key);
                          }}
                        >
                          {hunk.header}
                        </div>
                        {hunk.lines.map((line, n) => (
                          <div key={n} className={`diff-line ${line.kind}`}>
                            <span className="ln">{line.old_line ?? ''}</span>
                            <span className="ln">{line.new_line ?? ''}</span>
                            <span className="sign">
                              {line.kind === 'insert' ? '+' : line.kind === 'delete' ? '-' : ' '}
                            </span>
                            <span className="code">
                              {showWhitespace
                                ? visibleWhitespace(line.text.replace(/\n$/, ''))
                                : line.text.replace(/\n$/, '')}
                            </span>
                          </div>
                        ))}
                      </Fragment>
                    ))}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ))}
        </div>
        {marks.length > 0 && (
          <nav className="change-minimap" aria-label="Diff change minimap">
            <svg
              viewBox="0 0 20 1000"
              preserveAspectRatio="none"
              role="group"
              aria-label="Changed line positions"
            >
              {marks.map((mark, index) => (
                <g
                  key={index}
                  role="button"
                  tabIndex={0}
                  aria-label={`Jump to ${mark.path} hunk ${mark.hunk + 1} ${mark.kind}`}
                  onClick={() => jump(mark.path, mark.hunk)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      jump(mark.path, mark.hunk);
                    }
                  }}
                >
                  <title>
                    {mark.path} · hunk {mark.hunk + 1} · {mark.kind}
                  </title>
                  <rect
                    x="3"
                    y={20 + mark.start * 960}
                    width="14"
                    height={Math.max(5, mark.size * 960)}
                    fill={mark.kind === 'insert' ? 'var(--green)' : 'var(--red)'}
                    opacity="0.7"
                  />
                </g>
              ))}
            </svg>
          </nav>
        )}
      </div>
    </>
  );
}
