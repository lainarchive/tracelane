export interface Run {
  id: string;
  parent_run_id: string | null;
  forked_from_step: number | null;
  command: string;
  display_command: string;
  started_at: string;
  finished_at: string | null;
  exit_code: number | null;
  step_count: number;
  target: string;
}
export interface Step {
  step_index: number;
  endpoint: string;
  status: number;
  latency_ms: number;
  cached: boolean;
  files: { added: number; modified: number; deleted: number };
  pre_snapshot_id: string;
  post_snapshot_id: string;
}
export interface Diff {
  path: string;
  change: 'A' | 'M' | 'D';
  added_lines: number;
  deleted_lines: number;
  note: string | null;
  hunks: {
    header: string;
    lines: {
      kind: 'insert' | 'delete' | 'context';
      old_line: number | null;
      new_line: number | null;
      text: string;
    }[];
  }[];
}
export interface StepDetail {
  step_index: number;
  request: unknown;
  response: unknown;
  response_content_type?: string | null;
  diffs: Diff[];
}
export interface RunDetail {
  run: Run;
  steps: Step[];
}
