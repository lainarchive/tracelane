const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const html = fs.readFileSync(path.join(__dirname, '../src/ui.html'), 'utf8');
const source = html.slice(html.indexOf('function savedSizes()'), html.indexOf('for (const [name, value]'));

test('viewport clamping preserves preferred widths and restores them when widened', () => {
    let stored = JSON.stringify({ sidebar: 300, timeline: 400 });
    const styles = {};
    const viewport = { innerWidth: 1000 };
    const context = vm.createContext({
        localStorage: { getItem: () => stored, setItem: (key, value) => { stored = value; } },
        root: { style: { setProperty: (name, value) => { styles[name] = value; } } },
        window: viewport,
        $: () => ({ clientWidth: viewport.innerWidth - parseFloat(styles['--sidebar'] || '300') - 1 }),
    });
    vm.runInContext(source + ';resizePane("sidebar", 300);resizePane("timeline", 400)', context);
    assert.deepEqual(JSON.parse(stored), { sidebar: 300, timeline: 400 });
    assert.equal(styles['--sidebar'], '240px');
    context.window.innerWidth = 1440;
    vm.runInContext('resizePane("sidebar", savedSizes().sidebar);resizePane("timeline", savedSizes().timeline)', context);
    assert.equal(styles['--sidebar'], '300px');
    assert.equal(styles['--timeline'], '400px');
    vm.runInContext('resizePane("sidebar", 280, true)', context);
    assert.equal(JSON.parse(stored).sidebar, 280);
});
