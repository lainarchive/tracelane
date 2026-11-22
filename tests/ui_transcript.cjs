const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../src/ui.html'), 'utf8');
const source = html.slice(html.indexOf('function contentText('), html.indexOf('function renderIO()'));
const context = vm.createContext({});
vm.runInContext(source, context);
const parse = (request, response) => JSON.parse(JSON.stringify(context.transcript(request, response)));

test('OpenAI messages, tool calls, assistant text and usage are retained', () => {
    const value = parse({ model: 'requested', messages: [
        { role: 'system', content: 'Be concise.' },
        { role: 'user', content: [{ type: 'text', text: 'Read this.' }, { type: 'image_url' }] },
        { role: 'assistant', content: null, tool_calls: [{ function: { name: 'read', arguments: '{"path":"a"}' } }] },
        { role: 'tool', content: 'contents' },
    ] }, { model: 'returned', choices: [{ message: { content: 'Done.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 4 } });
    assert.equal(value.messages[0].role, 'system');
    assert.equal(value.messages[1].text, 'Read this.\n[image_url]');
    assert.equal(value.messages[2].tools[0].name, 'read');
    assert.equal(value.messages[3].role, 'tool');
    assert.equal(value.response.text, 'Done.');
    assert.equal(value.model, 'returned');
    assert.equal(value.finish, 'stop');
    assert.equal(value.usage.prompt_tokens, 10);
});

test('Anthropic system, text blocks, tool results and usage are retained', () => {
    const value = parse({ system: [{ type: 'text', text: 'System prompt' }], messages: [
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'one', content: 'result' }] },
    ] }, { model: 'claude', content: [{ type: 'text', text: 'First' }, { type: 'text', text: 'Second' }, { type: 'tool_use', name: 'write', input: { path: 'a' } }], stop_reason: 'tool_use', usage: { input_tokens: 8, output_tokens: 3 } });
    assert.equal(value.messages[0].text, 'System prompt');
    assert.ok(value.messages[1].text.includes('result'));
    assert.equal(value.response.text, 'First\nSecond');
    assert.equal(value.response.tools[0].name, 'write');
    assert.equal(value.finish, 'tool_use');
    assert.equal(value.usage.output_tokens, 3);
});

test('OpenAI SSE joins deltas and tool arguments with final finish and usage events', () => {
    const chunks = [
        { model: 'streamed', choices: [{ delta: { content: 'Hel', tool_calls: [{ index: 0, function: { name: 'read', arguments: '{"pa' } }] } }] },
        { choices: [{ delta: { content: 'lo', tool_calls: [{ index: 0, function: { arguments: 'th":"a"}' } }] }, finish_reason: 'stop' }] },
        { choices: [], usage: { total_tokens: 12 } },
    ];
    const stream = chunks.map(chunk => 'data: ' + JSON.stringify(chunk)).join('\r\n\r\n') + '\r\n\r\ndata: [DONE]\r\n\r\n';
    const value = parse({}, stream);
    assert.equal(value.response.text, 'Hello');
    assert.equal(value.response.tools[0].arguments, '{"path":"a"}');
    assert.equal(value.model, 'streamed');
    assert.equal(value.finish, 'stop');
    assert.equal(value.usage.total_tokens, 12);
});

test('Anthropic SSE joins text and final metadata', () => {
    const events = [
        { type: 'message_start', message: { model: 'streamed-claude', usage: { input_tokens: 5 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello ' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    ];
    const value = parse({}, events.map(event => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n').join(''));
    assert.equal(value.response.text, 'Hello world');
    assert.equal(value.finish, 'end_turn');
    assert.equal(value.usage.input_tokens, 5);
    assert.equal(value.usage.output_tokens, 2);
});

test('OpenAI SSE selects choice zero even when alternatives arrive first or alone', () => {
    const chunks = [
        { choices: [{ index: 1, delta: { content: 'Wrong', tool_calls: [{ index: 0, function: { name: 'wrong' } }] } }] },
        { choices: [{ index: 1, delta: { content: 'Wrong again' } }, { index: 0, delta: { content: 'Hel' } }] },
        { choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: 'stop' }, { index: 1, finish_reason: 'length' }] },
        { choices: [{ index: 1, delta: { content: 'Still wrong' }, finish_reason: 'length' }] },
    ];
    const stream = chunks.map(chunk => 'data: ' + JSON.stringify(chunk) + '\n\n').join('');
    const value = parse({}, stream);
    assert.equal(value.response.text, 'Hello');
    assert.equal(value.finish, 'stop');
    assert.deepEqual(value.response.tools, []);
});

test('empty, plain-text, error and malformed stream responses remain inspectable', () => {
    assert.equal(parse({}, null).response.text, 'No assistant text returned.');
    assert.equal(parse({}, 'plain text').response.text, 'plain text');
    assert.ok(parse({}, { error: { message: 'Not authorized' } }).response.text.includes('Not authorized'));
    const broken = parse({}, 'data: not-json\n\ndata: [DONE]\n\n');
    assert.ok(broken.warning);
    assert.equal(broken.response.text, 'No assistant text returned.');
    assert.ok(parse({}, 'data: null\n\n').warning);
});

test('malformed content blocks and tool calls do not discard valid transcript text', () => {
    const value = parse({ messages: [null, { role: 'user', content: [null, 7, false, { type: 'text', text: 'Keep this' }], tool_calls: [null, 8] }] }, { content: [null, { type: 'text', text: 'Answer' }] });
    assert.equal(value.messages[1].text, 'Keep this');
    assert.deepEqual(value.messages[1].tools, []);
    assert.equal(value.response.text, 'Answer');
});

test('transcript rendering failures leave the diff and raw rendering available', () => {
    const nodes = new Map();
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, { hidden: false, textContent: '', children: [], replaceChildren(...children) { this.children = children; }, append(...children) { this.children.push(...children); }, setAttribute() {} });
        return nodes.get(id);
    };
    const state = vm.createContext({
        $: node,
        detail: { request: { model: 'test' }, response: 'answer' }, raw: false,
        el: (tag, className, text) => ({ tag, className, text, append() {} }),
        empty: (target, message) => { target.textContent = message; },
        transcript: () => { throw Error('render failure'); },
        highlightedJson: value => ({ json: value }),
    });
    const render = html.slice(html.indexOf('function renderIO()'), html.indexOf('function toggleRaw()'));
    node('diff').textContent = 'existing diff';
    vm.runInContext(render + ';renderIO()', state);
    assert.equal(node('diff').textContent, 'existing diff');
    assert.match(node('io').textContent, /Raw/);
    state.raw = true;
    vm.runInContext('renderIO()', state);
    assert.equal(node('io').children.length, 2);
});
