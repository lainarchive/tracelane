export interface Message {
  role: string;
  text: string;
  tools: { name: string; arguments: string }[];
}
export interface Conversation {
  messages: Message[];
  response: Message;
  model: string;
  finish: string;
  usage: Record<string, number>;
  warning: string;
}

export function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (typeof block === 'string') return block;
      if (!block || typeof block !== 'object') return '';
      if (block.type === 'refusal') return typeof block.refusal === 'string' ? block.refusal : '';
      if (typeof block.text === 'string') return block.text;
      if (block.type === 'tool_result')
        return `Tool result ${block.tool_use_id || ''}\n${contentText(block.content)}`;
      if (block.type === 'tool_use') return '';
      return '[' + (block.type || 'non-text content') + ']';
    })
    .filter(Boolean)
    .join('\n');
}

export function messageData(message: any): Message {
  if (!message || typeof message !== 'object') message = {};
  const tools = (Array.isArray(message.tool_calls) ? message.tool_calls : [])
    .filter((call: Record<string, any> | null) => call && typeof call === 'object')
    .map((call: Record<string, any>) => ({
      name: call.function?.name || call.name || 'tool',
      arguments: call.function?.arguments || call.arguments || '',
    }));
  for (const block of Array.isArray(message.content) ? message.content : []) {
    if (block?.type === 'tool_use')
      tools.push({ name: block.name, arguments: JSON.stringify(block.input, null, 2) });
  }
  return { role: message.role || 'assistant', text: contentText(message.content), tools };
}

export function transcript(request: any, response: any, contentType?: string | null): Conversation {
  request = request || {};
  const messages = [];
  if (request.system) messages.push(messageData({ role: 'system', content: request.system }));
  if (request.instructions)
    messages.push(messageData({ role: 'system', content: request.instructions }));
  if (typeof request.input === 'string')
    messages.push(messageData({ role: 'user', content: request.input }));
  for (const item of Array.isArray(request.input) ? request.input : []) {
    if (item && typeof item === 'object' && 'content' in item)
      messages.push(messageData({ ...item, role: item.role || 'user' }));
  }
  for (const message of Array.isArray(request.messages) ? request.messages : [])
    messages.push(messageData(message));
  let model = response?.model || request.model || '';
  let finish = '',
    usage: Record<string, number> = {},
    warning = '';
  let answer: Message = { role: 'assistant', text: '', tools: [] };
  const stream =
    contentType == null
      ? typeof response === 'string' && /^\s*(data:|event:)/m.test(response)
      : typeof contentType === 'string' &&
        contentType.split(';')[0].trim().toLowerCase() === 'text/event-stream';
  if (typeof response === 'string' && stream) {
    const tools = new Map();
    for (const event of response.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data || data.trim() === '[DONE]') continue;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        warning = 'Some stream events could not be decoded. See Raw for the original body.';
        continue;
      }
      if (!chunk || typeof chunk !== 'object') {
        warning = 'Some stream events could not be decoded. See Raw for the original body.';
        continue;
      }
      model = chunk.model || chunk.message?.model || chunk.response?.model || model;
      Object.assign(usage, chunk.message?.usage, chunk.response?.usage, chunk.usage);
      if (chunk.type === 'response.output_text.delta' && typeof chunk.delta === 'string')
        answer.text += chunk.delta;
      if (['response.completed', 'response.incomplete', 'response.failed'].includes(chunk.type)) {
        finish = chunk.response?.status || chunk.type.slice('response.'.length);
        if (!answer.text) answer.text = outputText(chunk.response?.output);
        if (chunk.response?.error) answer.text += JSON.stringify(chunk.response.error, null, 2);
      }
      const choice = Array.isArray(chunk.choices)
        ? chunk.choices.find(
            (choice: Record<string, any> | null) => choice && (choice.index ?? 0) === 0,
          )
        : undefined;
      finish = choice?.finish_reason || chunk.delta?.stop_reason || finish;
      answer.text += contentText(choice?.delta?.content);
      for (const call of choice?.delta?.tool_calls || []) {
        const key = 'openai-' + (call.index ?? 0);
        const tool = tools.get(key) || { name: '', arguments: '' };
        tool.name += call.function?.name || '';
        tool.arguments += call.function?.arguments || '';
        tools.set(key, tool);
      }
      if (chunk.type === 'content_block_start') {
        answer.text += contentText([chunk.content_block]);
        if (chunk.content_block?.type === 'tool_use') {
          tools.set('anthropic-' + chunk.index, {
            name: chunk.content_block.name,
            arguments: '',
          });
        }
      }
      if (chunk.type === 'content_block_delta') {
        answer.text += chunk.delta?.text || '';
        if (chunk.delta?.partial_json) {
          const tool = tools.get('anthropic-' + chunk.index);
          if (tool) tool.arguments += chunk.delta.partial_json;
        }
      }
      if (chunk.error) answer.text += JSON.stringify(chunk.error, null, 2);
    }
    answer.tools = [...tools.values()];
  } else if (response && typeof response === 'object') {
    const choice = Array.isArray(response.choices)
      ? response.choices.find(
          (choice: Record<string, any> | null) => choice && (choice.index ?? 0) === 0,
        )
      : undefined;
    answer = messageData(choice?.message || { role: 'assistant', content: response.content });
    if (Array.isArray(response.output)) {
      answer.text = outputText(response.output);
      answer.tools.push(
        ...response.output
          .filter((item: Record<string, any> | null) => item?.type === 'function_call')
          .map((item: Record<string, any>) => ({
            name: item.name || 'tool',
            arguments: item.arguments || '',
          })),
      );
    }
    finish = choice?.finish_reason || response.stop_reason || response.status || '';
    usage = response.usage || {};
    if (
      !answer.text &&
      !answer.tools.length &&
      Object.keys(response).length &&
      (!Array.isArray(response.output) || response.error)
    )
      answer.text = JSON.stringify(response, null, 2);
  } else if (typeof response === 'string') answer.text = response;
  if (!answer.text && !answer.tools.length) answer.text = 'No assistant text returned.';
  return { messages, response: answer, model, finish, usage, warning };
}

function outputText(output: unknown): string {
  return (Array.isArray(output) ? output : [])
    .map((item) => contentText(item?.content))
    .filter(Boolean)
    .join('\n');
}
