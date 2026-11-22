import { useState } from 'react';
import { ChevronDown, ChevronRight, File, Folder } from 'lucide-react';
import { fileTree, type FileNode } from '@/lib/studio';
import type { Diff } from '@/lib/types';

export function FileTree({
  files,
  selected,
  onSelect,
}: {
  files: Diff[];
  selected?: string;
  onSelect: (path: string) => void;
}) {
  const [closed, setClosed] = useState(new Set<string>());
  const nodes = fileTree(files);
  const maximum = Math.max(1, ...files.map((file) => file.added_lines + file.deleted_lines));
  function branch(node: FileNode, depth: number): React.ReactNode {
    const hidden = !node.file && closed.has(node.path);
    return (
      <li key={node.path}>
        <button
          className={`tree-entry ${node.file && selected === node.path ? 'selected' : ''}`}
          style={{ paddingLeft: 14 + depth * 17 }}
          title={node.path}
          aria-expanded={node.file ? undefined : !hidden}
          onClick={() => {
            if (node.file) onSelect(node.path);
            else
              setClosed((current) => {
                const next = new Set(current);
                if (next.has(node.path)) next.delete(node.path);
                else next.add(node.path);
                return next;
              });
          }}
        >
          {node.file ? (
            <File size={13} />
          ) : (
            <>
              {hidden ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
              <Folder size={13} />
            </>
          )}
          <span className="mono ellipsis">{node.name}</span>
          {node.file && (
            <>
              <span
                className={`file-status ${node.file.change === 'A' ? 'added' : node.file.change === 'D' ? 'deleted' : 'modified'}`}
              >
                {node.file.change}
              </span>
              <span className="change-heat" aria-label={`${node.changes} changed lines`}>
                {Array.from({ length: 4 }, (_, i) => (
                  <i key={i} className={i < Math.ceil((node.changes / maximum) * 4) ? 'lit' : ''} />
                ))}
              </span>
            </>
          )}
        </button>
        {node.children.length > 0 && !hidden && (
          <ul>{node.children.map((child) => branch(child, depth + 1))}</ul>
        )}
      </li>
    );
  }
  return (
    <nav aria-label="Changed file tree" className="changed-tree">
      {!nodes.length ? (
        <div className="empty">No file changes in this step.</div>
      ) : (
        <ul>{nodes.map((node) => branch(node, 0))}</ul>
      )}
    </nav>
  );
}
