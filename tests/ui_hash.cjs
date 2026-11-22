const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../src/ui.html'), 'utf8');
const start = html.indexOf('function fromHash()');
const end = html.indexOf("window.addEventListener('hashchange'", start);
const source = html.slice(start, end);

for (const hash of ['#%ZZ/2', '#%/2', '#%E0%A4/2']) {
    test(`malformed hash ${hash} selects the first run without a requested step`, () => {
        const selections = [];
        vm.runInNewContext(source + ';fromHash()', {
            location: { hash }, runs: [{ id: 'first' }, { id: 'second' }],
            selectRun: (...args) => selections.push(args),
            notice: (error) => { throw error; },
        });
        assert.deepEqual(selections, [['first']]);
    });
}

test('valid encoded hash preserves the requested run and step', () => {
    const selections = [];
    vm.runInNewContext(source + ';fromHash()', {
        location: { hash: '#run%20two/2' }, runs: [{ id: 'first' }, { id: 'run two' }],
        selectRun: (...args) => selections.push(args),
        notice: (error) => { throw error; },
    });
    assert.deepEqual(selections, [['run two', 2]]);
});

test('malformed hash with no runs leaves the empty selection alone', () => {
    vm.runInNewContext(source + ';fromHash()', {
        location: { hash: '#%ZZ/2' }, runs: [],
        selectRun: () => assert.fail('no run should be selected'),
        notice: (error) => { throw error; },
    });
});
