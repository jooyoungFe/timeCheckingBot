const assert = require('node:assert/strict');
const test = require('node:test');
const { loadDatabase } = require('./helpers.cjs');

test('editing active study time includes elapsed time and continues from the edit', t => {
    const { db, database, advance } = loadDatabase();
    t.after(() => database.close());
    db.startStudy('guild', 'user');
    advance(120);
    assert.equal(db.getCurrentStudyTime('guild', 'user'), 120);
    const change = db.changeStudyTime('guild', 'user', 'admin', 'set', 3600, 'Correction');
    assert.equal(change.before, 120);
    assert.equal(change.after, 3600);
    assert.equal(db.getCurrentStudyTime('guild', 'user'), 3600);
    advance(60);
    db.saveGuild('guild');
    assert.equal(db.getStudyTime('guild', 'user'), 3660);
    advance(30);
    db.stopStudy('guild', 'user');
    assert.equal(db.getStudyTime('guild', 'user'), 3690);
    const row = db.getAdminTimeChanges('guild', 1).rows[0];
    assert.equal(row.admin_id, 'admin');
    assert.equal(row.before_seconds, 120);
    assert.equal(row.after_seconds, 3600);
    assert.equal(row.reason, 'Correction');
});

test('add, subtract, reset and no-record edits are isolated to the target server', t => {
    const { db, database, advance } = loadDatabase();
    t.after(() => database.close());
    db.changeStudyTime('other', 'user', 'admin', 'set', 999, 'Original');
    assert.equal(db.changeStudyTime('guild', 'user', 'admin', 'add', 60, 'Add').after, 60);
    assert.equal(db.changeStudyTime('guild', 'user', 'admin', 'subtract', 10, 'Subtract').after, 50);
    assert.equal(db.changeStudyTime('guild', 'user', 'admin', 'subtract', 100, 'Clamp').after, 0);
    db.startStudy('guild', 'user');
    advance(20);
    assert.equal(db.changeStudyTime('guild', 'user', 'admin', 'reset', 0, 'Reset').before, 20);
    advance(10);
    assert.equal(db.getCurrentStudyTime('guild', 'user'), 10);
    assert.equal(db.getStudyTime('other', 'user'), 999);
});

test('invalid durations and overflow do not change records or audit history', t => {
    const { db, database } = loadDatabase();
    t.after(() => database.close());
    for (const value of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        assert.throws(() => db.changeStudyTime('guild', 'user', 'admin', 'set', value, 'Invalid'));
    }
    assert.throws(() => db.changeStudyTime('guild', 'user', 'admin', 'add', 0, 'Invalid'));
    assert.throws(() => db.changeStudyTime('guild', 'user', 'admin', 'erase', 1, 'Invalid'));
    assert.equal(db.getAdminTimeChanges('guild', 1).total, 0);
    db.changeStudyTime('guild', 'user', 'admin', 'set', Number.MAX_SAFE_INTEGER, 'Maximum');
    assert.throws(() => db.changeStudyTime('guild', 'user', 'admin', 'add', 1, 'Overflow'));
    assert.equal(db.getStudyTime('guild', 'user'), Number.MAX_SAFE_INTEGER);
    assert.equal(db.getAdminTimeChanges('guild', 1).total, 1);
});

test('audit insertion failure rolls back both total time and active session baseline', t => {
    const { db, database, advance } = loadDatabase();
    t.after(() => database.close());
    db.startStudy('guild', 'user');
    advance(50);
    assert.throws(() => db.changeStudyTime('guild', 'user', 'admin', 'set', 999, null));
    assert.equal(db.getStudyTime('guild', 'user'), 0);
    assert.equal(db.getCurrentStudyTime('guild', 'user'), 50);
    assert.equal(db.getAdminTimeChanges('guild', 1).total, 0);
});

test('change history paginates and filters by server and user', t => {
    const { db, database } = loadDatabase();
    t.after(() => database.close());
    for (let n = 0; n < 7; n++) db.changeStudyTime('guild', 'user', 'admin', 'add', 1, String(n));
    db.changeStudyTime('guild', 'other', 'admin', 'add', 1, 'Other user');
    db.changeStudyTime('other', 'user', 'admin', 'add', 1, 'Other server');
    assert.equal(db.getAdminTimeChanges('guild', 1).total, 8);
    assert.equal(db.getAdminTimeChanges('guild', 1, 'user').rows.length, 5);
    assert.equal(db.getAdminTimeChanges('guild', 2, 'user').rows.length, 2);
    assert.equal(db.getAdminTimeChanges('guild', 1, 'user').rows[0].reason, '6');
});

test('autosave handles every guild once and clearing a guild leaves others running', t => {
    const { db, database, advance } = loadDatabase();
    t.after(() => database.close());
    db.startStudy('guild', 'first');
    db.startStudy('guild', 'second');
    db.startStudy('other', 'first');
    advance(30);
    db.saveAll();
    db.saveAll();
    assert.equal(db.getStudyTime('guild', 'first'), 30);
    assert.equal(db.getStudyTime('guild', 'second'), 30);
    assert.equal(db.getStudyTime('other', 'first'), 30);
    advance(10);
    db.clearGuildSessions('guild');
    advance(20);
    db.saveAll();
    assert.equal(db.getStudyTime('guild', 'first'), 40);
    assert.equal(db.getStudyTime('guild', 'second'), 40);
    assert.equal(db.getStudyTime('other', 'first'), 60);
    db.stopStudy('other', 'first');
    db.stopStudy('other', 'first');
    assert.equal(db.getStudyTime('other', 'first'), 60);
});
