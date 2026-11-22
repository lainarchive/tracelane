import { Component, Fragment, type ReactNode } from 'react';
import { Wrench } from 'lucide-react';
import type { StepDetail } from '@/lib/types';
import { transcript, type Message } from '@/lib/transcript';

class TranscriptBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="empty">
        Unable to render this transcript. Select Raw to inspect the original request and response.
      </div>
    ) : (
      this.props.children
    );
  }
}

export function HighlightedJson({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2) ?? 'null';
  const pattern =
    /"(?:\\.|[^"\\])*"\s*:|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    parts.push(text.slice(cursor, match.index));
    const token = match[0];
    const kind = token.endsWith(':')
      ? 'key'
      : token.startsWith('"')
        ? 'string'
        : /^(true|false|null)$/.test(token)
          ? 'literal'
          : 'number';
    parts.push(
      <span key={match.index} className={`json-${kind}`}>
        {token}
      </span>,
    );
    cursor = match.index + token.length;
  }
  parts.push(text.slice(cursor));
  return <pre>{parts}</pre>;
}

function MessageView({ message, subtitle }: { message: Message; subtitle?: string }) {
  let files: { path: string; content: string }[] = [];
  try {
    const action = JSON.parse(message.text);
    if (action?.path && typeof action.content === 'string')
      files = [action, ...(Array.isArray(action.edits) ? action.edits : [])].filter(
        (file) => file && typeof file.path === 'string' && typeof file.content === 'string',
      );
  } catch {}
  return (
    <section className={`message ${subtitle === 'response' ? 'response-message' : ''}`}>
      <div className="message-role">
        <span className="label">{message.role}</span>
        <span className="muted label">{subtitle}</span>
      </div>
      {files.length
        ? files.map((file, index) => (
            <Fragment key={index}>
              <div className="message-file mono">{file.path}</div>
              <pre className="message-body">{file.content}</pre>
            </Fragment>
          ))
        : message.text && <pre className="message-body">{message.text}</pre>}
      {message.tools.map((tool, index) => {
        let args = tool.arguments;
        try {
          args = JSON.stringify(JSON.parse(args), null, 2);
        } catch {}
        return (
          <div key={index} className="tool-call mono">
            <span className="label tool-call-head">
              <Wrench size={12} aria-hidden="true" />
              Tool call · {tool.name}
            </span>
            <pre>{args}</pre>
          </div>
        );
      })}
    </section>
  );
}

function ConversationView({ detail }: { detail: StepDetail }) {
  const conversation = transcript(detail.request, detail.response, detail.response_content_type);
  const usage = conversation.usage;
  const meta = [conversation.model, conversation.finish && `finish: ${conversation.finish}`];
  if (usage.input_tokens !== undefined || usage.prompt_tokens !== undefined)
    meta.push(`${usage.input_tokens ?? usage.prompt_tokens} input tokens`);
  if (usage.output_tokens !== undefined || usage.completion_tokens !== undefined)
    meta.push(`${usage.output_tokens ?? usage.completion_tokens} output tokens`);
  if (usage.total_tokens !== undefined) meta.push(`${usage.total_tokens} total tokens`);
  if (conversation.warning) meta.push(conversation.warning);
  let current = conversation.messages.findLastIndex((message) => message.role === 'user');
  if (current < 0) current = Math.max(0, conversation.messages.length - 1);
  return (
    <>
      {meta.some(Boolean) && <div className="io-meta">{meta.filter(Boolean).join(' · ')}</div>}
      <div id="io" className="io-body scroll">
        {current > 0 && (
          <details className="history">
            <summary>Earlier context · {current} messages</summary>
            {conversation.messages.slice(0, current).map((message, index) => (
              <MessageView key={index} message={message} />
            ))}
          </details>
        )}
        {conversation.messages.slice(current).map((message, index) => (
          <MessageView key={index} message={message} subtitle="request" />
        ))}
        <MessageView message={conversation.response} subtitle="response" />
      </div>
    </>
  );
}

export function Transcript({
  detail,
  raw,
  tab = 'conversation',
}: {
  detail: StepDetail;
  raw: boolean;
  tab?: 'conversation' | 'request' | 'response';
}) {
  if (!raw && tab !== 'conversation')
    return (
      <div id="io" className="io-body scroll">
        <section className="message">
          <div className="label">{tab}</div>
          <HighlightedJson value={detail[tab]} />
        </section>
      </div>
    );
  if (raw)
    return (
      <div id="io" className="io-body scroll">
        {(['request', 'response'] as const).map((name) => (
          <section key={name} className="message">
            <div className="label">{name}</div>
            <HighlightedJson value={detail[name]} />
          </section>
        ))}
      </div>
    );
  return (
    <TranscriptBoundary>
      <ConversationView detail={detail} />
    </TranscriptBoundary>
  );
}
