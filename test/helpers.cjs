const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Database = require('better-sqlite3');

function loadCompiled(name, dependencies, extra = {}) {
    const exports = {};
    const filename = path.join(__dirname, '..', 'dist', `${name}.js`);
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
        exports,
        Error,
        require(id) {
            if (Object.hasOwn(dependencies, id)) return dependencies[id];
            throw new Error(`Unexpected dependency: ${id}`);
        },
        ...extra
    }, { filename });
    return exports;
}

function loadDatabase() {
    const database = new Database(':memory:');
    let now = 1_700_000_000_000;
    const db = loadCompiled('db', {
        'better-sqlite3': function () { return database; },
        fs: { existsSync: () => true }
    }, { Date: class extends Date { static now() { return now; } } });

    return { db, database, advance(seconds) { now += seconds * 1000; } };
}

module.exports = { loadCompiled, loadDatabase };
