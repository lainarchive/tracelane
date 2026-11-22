import { useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { railLayout } from '@/lib/studio';
import type { Run, RunDetail } from '@/lib/types';
import { duration } from '@/lib/format';

export function ReplayRail({
  details,
  runs,
  runId,
  stepIndex,
  onSelect,
  runNavigation,
}: {
  details: RunDetail[];
  runs: Run[];
  runId: string | null;
  stepIndex: number | null;
  onSelect: (id: string, step?: number) => void;
  runNavigation: (heights: Map<string, number>) => React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const byId = new Map(details.map((detail) => [detail.run.id, detail]));
  const layout = railLayout(
    runs.map((run) => byId.get(run.id) ?? { run, steps: [] }),
    runId ?? '',
    true,
  );
  const selected = layout.lanes
    .find((lane) => lane.run.id === runId)
    ?.clips.find((clip) => clip.step.step_index === stepIndex);
  const tracks = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    const navigation = root.current?.querySelector<HTMLElement>('#runs');
    const timeline = tracks.current;
    if (!navigation || !timeline) return;
    const fromNavigation = () => {
      timeline.scrollTop = navigation.scrollTop;
    };
    const fromTimeline = () => {
      navigation.scrollTop = timeline.scrollTop;
    };
    navigation.addEventListener('scroll', fromNavigation, { passive: true });
    timeline.addEventListener('scroll', fromTimeline, { passive: true });
    return () => {
      navigation.removeEventListener('scroll', fromNavigation);
      timeline.removeEventListener('scroll', fromTimeline);
    };
  }, []);
  useEffect(() => {
    tracks.current?.querySelector('.replay-lane.selected')?.scrollIntoView({ block: 'nearest' });
  }, [runId, layout.lanes.length, layout.height]);
  return (
    <section ref={root} className="replay-rail" aria-label="Replay timeline">
      <div className="run-navigation">
        {runNavigation(new Map(layout.lanes.map((lane) => [lane.run.id, lane.height])))}
      </div>
      <div className="rail-ruler">
        <div className="rail-heading" aria-hidden="true" />
        <div
          className="time-ruler"
          title="Cumulative request latency; cached clips show reused parent context, not elapsed replay time"
        >
          {layout.ticks.map((tick) => (
            <span key={tick} style={{ left: `${(tick / layout.maximum) * 100}%` }} className="mono">
              {duration(tick)}
            </span>
          ))}
          {selected && (
            <motion.div
              className="ruler-playhead"
              initial={false}
              animate={{ left: `${(selected.end / layout.maximum) * 100}%` }}
              transition={{ duration: reduced ? 0 : 0.2 }}
              aria-hidden="true"
            >
              <span className="mono">{duration(selected.end)}</span>
            </motion.div>
          )}
        </div>
      </div>
      <div
        ref={tracks}
        className="replay-tracks scroll"
        style={{ height: Math.max(84, layout.height) }}
      >
        {!layout.lanes.length && (
          <div className="empty">Select a recorded run to inspect its replay timeline.</div>
        )}
        {layout.lanes.map((lane, laneIndex) => (
          <div
            key={lane.run.id}
            className={`replay-lane ${lane.run.id === runId ? 'selected' : ''}`}
            style={
              {
                height: lane.height,
                '--lane-color': `var(--lane-${laneIndex % 3})`,
              } as React.CSSProperties
            }
          >
            <div className="lane-label" aria-hidden="true" />
            <div className="lane-clips">
              {!lane.clips.length && (
                <span className="muted mono lane-empty">
                  {lane.run.step_count ? 'Requests not loaded' : 'No recorded requests'}
                </span>
              )}
              {layout.ticks.map((tick) => (
                <i
                  className="rail-gridline"
                  key={tick}
                  style={{ left: `${(tick / layout.maximum) * 100}%` }}
                />
              ))}
              {lane.clips.map((clip) => {
                const active = lane.run.id === runId && clip.step.step_index === stepIndex;
                const count =
                  clip.step.files.added + clip.step.files.modified + clip.step.files.deleted;
                return (
                  <button
                    key={clip.step.step_index}
                    className={`replay-clip ${clip.start === clip.end ? 'zero' : ''} ${clip.step.cached ? 'cached' : 'live'} ${active ? 'active' : ''}`}
                    style={{
                      left: `${(clip.start / layout.maximum) * 100}%`,
                      width: `max(24px, calc(${((clip.end - clip.start) / layout.maximum) * 100}% - 6px))`,
                      top: 8 + clip.row * 34,
                    }}
                    aria-label={`Select ${lane.run.id} step ${clip.step.step_index}`}
                    aria-current={active ? 'step' : undefined}
                    title={`${clip.step.endpoint} · ${clip.step.cached ? 'cached' : duration(clip.step.latency_ms)} · ${count} file changes`}
                    onClick={() => onSelect(lane.run.id, clip.step.step_index)}
                  >
                    <span className="clip-number mono">
                      {String(clip.step.step_index).padStart(2, '0')} ·
                    </span>
                    <span className="clip-endpoint">
                      {clip.step.cached
                        ? 'reused parent state'
                        : clip.step.endpoint.replace('/v1', '')}
                    </span>
                    <span className="clip-latency mono">
                      {clip.step.cached ? 'cached' : duration(clip.step.latency_ms)}
                    </span>
                    {count > 0 && (
                      <span className="file-ticks" aria-label={`${count} file changes`}>
                        {Object.entries(clip.step.files)
                          .flatMap(([kind, n]) =>
                            Array.from({ length: Math.min(6, n) }, (_, i) => (
                              <i key={`${kind}-${i}`} className={kind} />
                            )),
                          )
                          .slice(0, 6)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <div className="rail-geometry" aria-hidden="true" style={{ height: layout.height }}>
          <svg viewBox={`0 0 1000 ${Math.max(1, layout.height)}`} preserveAspectRatio="none">
            {layout.lanes.map((lane, index) => {
              const parent = layout.lanes.find((p) => p.run.id === lane.parent);
              const first = lane.clips.find((clip) => !clip.step.cached) ?? lane.clips[0];
              if (!parent || !first) return null;
              const x = (first.start / layout.maximum) * 1000;
              const origin =
                parent.clips.findLast((clip) => clip.step.step_index < first.step.step_index) ??
                parent.clips[0];
              const fromY = parent.top + (origin?.row ?? 0) * 34 + 22;
              const toY = lane.top + first.row * 34 + 22;
              return (
                <path
                  key={lane.run.id}
                  d={`M${x} ${fromY} C${x} ${toY} ${x + 24} ${toY} ${x + 30} ${toY}`}
                  fill="none"
                  stroke={`var(--lane-${index % 3})`}
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
          {selected && (
            <motion.div
              className="rail-playhead"
              initial={false}
              animate={{ left: `${(selected.end / layout.maximum) * 100}%` }}
              transition={{ duration: reduced ? 0 : 0.2 }}
            />
          )}
        </div>
      </div>
    </section>
  );
}
