const assert = require('node:assert/strict');
const test = require('node:test');
const discord = require('discord.js');
const { loadCompiled, loadDatabase } = require('./helpers.cjs');
const output = require('../dist/output.js');
const { adminCommand } = require('../dist/admin-command.js');

const ADMIN = '1022487323465744477';
const USER = '123456789012345678';
const GUILD = '223456789012345678';
const OTHER_GUILD = '323456789012345678';

function fixture(t, whitelist = ADMIN) {
    const storage = loadDatabase();
    t.after(() => storage.database.close());
    const env = { BOT_ADMIN_IDS: whitelist };
    const admin = loadCompiled('admin', {
        'discord.js': discord,
        './db': storage.db,
        './output': output,
        './tier': require('../dist/tier.js')
    }, { process: { env } });
    const guild = {
        id: GUILD, name: 'Study \u{1F4DA}', ownerId: USER,
        memberCount: 12, available: true,
        channels: { fetch: async () => null },
        members: { cache: new Map([[USER, { displayName: 'User \u{1F4DA}', user: {} }]]), fetch: async () => null }
    };
    const otherGuild = { ...guild, id: OTHER_GUILD, name: 'Other' };
    const client = {
        guilds: { cache: new Map([[GUILD, guild], [OTHER_GUILD, otherGuild]]) },
        users: { cache: new Map(), fetch: async () => null }
    };
    async function invoke(sub, { user = ADMIN, guildId = GUILD, strings = {}, integers = {}, serverAdmin = false } = {}) {
        const calls = [];
        const i = {
            user: { id: user }, guildId,
            memberPermissions: { has: () => serverAdmin },
            options: {
                getSubcommand: () => sub,
                getString: (key, required) => {
                    const value = strings[key] ?? null;
                    if (required && value === null) throw new Error('Missing required option');
                    return value;
                },
                getInteger: (key, required) => {
                    const value = integers[key] ?? null;
                    if (required && value === null) throw new Error('Missing required option');
                    return value;
                }
            },
            deferReply: async options => { calls.push({ kind: 'defer', options }); },
            editReply: async options => { calls.push({ kind: 'reply', options }); },
            channel: { send() { throw new Error('Admin responses must never be public channel messages'); } },
            followUp() { throw new Error('Unexpected follow-up'); }
        };
        await admin.handleAdmin(i, client);
        assert.equal(calls[0].options.flags, discord.MessageFlags.Ephemeral);
        assert.equal(calls.length, 2);
        const data = calls[1].options.embeds[0].toJSON();
        assert.ok(Object.values(output.colors).includes(data.color));
        assert.ok(!/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(JSON.stringify(data)));
        assert.equal(calls[1].options.allowedMentions.parse.length, 0);
        return data;
    }
    return { ...storage, admin, client, env, invoke };
}

test('slash command supports all actions without requiring guild Administrator', () => {
    const data = adminCommand.toJSON();
    assert.equal(data.name, '어드민');
    assert.ok(data.default_member_permissions === undefined || data.default_member_permissions === null);
    assert.deepEqual(data.integration_types, [discord.ApplicationIntegrationType.UserInstall]);
    assert.deepEqual(data.contexts, [discord.InteractionContextType.Guild, discord.InteractionContextType.BotDM, discord.InteractionContextType.PrivateChannel]);
    assert.equal(data.options.length, 8);
    for (const sub of data.options) {
        let optionalSeen = false;
        for (const option of sub.options ?? []) {
            if (!option.required) optionalSeen = true;
            else assert.equal(optionalSeen, false, 'Required options must come first');
        }
    }
});

test('empty or invalid whitelist grants no privileges and exact IDs are required', t => {
    const f = fixture(t, '');
    assert.equal(f.admin.isBotAdmin(ADMIN), false);
    const configured = fixture(t, `bad, ${ADMIN}, 423456789012345678`);
    assert.equal(configured.admin.isBotAdmin(ADMIN), true);
    assert.equal(configured.admin.isBotAdmin('423456789012345678'), true);
    assert.equal(configured.admin.isBotAdmin(ADMIN.slice(1)), false);
    assert.equal(configured.admin.isBotAdmin('bad'), false);
});

test('guild administrators outside the whitelist cannot view data or alter time', async t => {
    const f = fixture(t);
    const denial = await f.invoke('서버목록', { user: USER, serverAdmin: true });
    assert.equal(denial.title, '어드민 권한 안내');
    await f.invoke('시간설정', { user: USER, serverAdmin: true,
        strings: { 유저id: USER }, integers: { 시간: 10 } });
    assert.equal(f.db.getStudyTime(GUILD, USER), 0);
    assert.equal(f.db.getAdminTimeChanges(GUILD, 1).total, 0);
});

test('whitelisted admin without guild permissions manages another joined server', async t => {
    const f = fixture(t);
    await f.invoke('시간설정', { strings: { 유저id: USER, 서버id: OTHER_GUILD, 사유: 'Correction' }, integers: { 시간: 2, 분: 15, 초: 30 } });
    assert.equal(f.db.getStudyTime(OTHER_GUILD, USER), 8130);
    assert.equal(f.db.getStudyTime(GUILD, USER), 0);
    const read = await f.invoke('시간조회', { strings: { 유저id: USER, 서버id: OTHER_GUILD } });
    assert.equal(read.title, '사용자 공부시간');
    assert.ok(read.fields.some(field => field.value.includes('15분 30초')));
    await f.invoke('시간추가', { strings: { 유저id: USER, 서버id: OTHER_GUILD }, integers: { 시간: 0, 초: 30 } });
    assert.equal(f.db.getStudyTime(OTHER_GUILD, USER), 8160);
    await f.invoke('시간차감', { strings: { 유저id: USER, 서버id: OTHER_GUILD }, integers: { 시간: 3 } });
    assert.equal(f.db.getStudyTime(OTHER_GUILD, USER), 0);
    await f.invoke('시간초기화', { strings: { 유저id: USER, 서버id: OTHER_GUILD } });
    const history = await f.invoke('변경내역', { strings: { 서버id: OTHER_GUILD, 유저id: USER } });
    assert.equal(history.fields.length, 4);
    assert.equal(f.db.getAdminTimeChanges(OTHER_GUILD, 1).rows[0].admin_id, ADMIN);
});

test('server listing paginates, server details work, and all error replies stay private', async t => {
    const f = fixture(t);
    const template = f.client.guilds.cache.get(GUILD);
    for (let n = 0; n < 24; n++) {
        const id = String(500000000000000000n + BigInt(n));
        f.client.guilds.cache.set(id, { ...template, id, name: 'Server'.repeat(20) });
    }
    const page = await f.invoke('서버목록', { integers: { 페이지: 3 } });
    assert.equal(page.fields.length, 6);
    assert.ok(page.description.includes('26'));
    const details = await f.invoke('서버정보', { strings: { 서버id: GUILD } });
    assert.equal(details.title, '서버 정보');
    const missing = await f.invoke('시간설정', { strings: { 서버id: '999999999999999999', 유저id: USER }, integers: { 시간: 1 } });
    assert.equal(missing.title, '어드민 처리 안내');
    const invalid = await f.invoke('시간조회', { strings: { 유저id: 'not-an-id' } });
    assert.equal(invalid.title, '어드민 처리 안내');
    const zero = await f.invoke('시간추가', { strings: { 유저id: USER }, integers: { 시간: 0 } });
    assert.equal(zero.title, '어드민 처리 안내');
    const range = await f.invoke('서버목록', { integers: { 페이지: 100 } });
    assert.equal(range.title, '어드민 처리 안내');
    const dm = await f.invoke('서버목록', { guildId: null });
    assert.equal(dm.title, '전체 서버 목록');
    assert.equal(f.db.getAdminTimeChanges(GUILD, 1).total, 0);
});

test('admin actions work privately in DMs and servers without the bot', async t => {
    const f = fixture(t);
    for (const guildId of [null, '999999999999999999']) {
        const list = await f.invoke('서버목록', { guildId });
        assert.equal(list.title, '전체 서버 목록');
        const details = await f.invoke('서버정보', { guildId, strings: { 서버id: GUILD } });
        assert.equal(details.title, '서버 정보');
        await f.invoke('시간설정', { guildId, strings: { 서버id: GUILD, 유저id: USER }, integers: { 시간: 1 } });
        assert.equal(f.db.getStudyTime(GUILD, USER), 3600);
        const read = await f.invoke('시간조회', { guildId, strings: { 서버id: GUILD, 유저id: USER } });
        assert.equal(read.title, '사용자 공부시간');
        await f.invoke('시간추가', { guildId, strings: { 서버id: GUILD, 유저id: USER }, integers: { 시간: 0, 분: 1 } });
        assert.equal(f.db.getStudyTime(GUILD, USER), 3660);
        await f.invoke('시간차감', { guildId, strings: { 서버id: GUILD, 유저id: USER }, integers: { 시간: 0, 초: 30 } });
        assert.equal(f.db.getStudyTime(GUILD, USER), 3630);
        const history = await f.invoke('변경내역', { guildId, strings: { 서버id: GUILD } });
        assert.equal(history.title, '시간 변경내역');
        await f.invoke('시간초기화', { guildId, strings: { 서버id: GUILD, 유저id: USER } });
        assert.equal(f.db.getStudyTime(GUILD, USER), 0);
    }
});

test('DMs and external guilds require a target server and cannot bypass the whitelist', async t => {
    const f = fixture(t);
    for (const guildId of [null, '999999999999999999']) {
        const missing = await f.invoke('시간설정', { guildId, strings: { 유저id: USER }, integers: { 시간: 10 } });
        assert.equal(missing.title, '어드민 처리 안내');
        assert.ok(missing.description.includes('서버id'));
        const denied = await f.invoke('시간설정', { guildId, user: USER, strings: { 서버id: GUILD, 유저id: USER }, integers: { 시간: 10 } });
        assert.equal(denied.title, '어드민 권한 안내');
    }
    assert.equal(f.db.getStudyTime(GUILD, USER), 0);
    assert.equal(f.db.getAdminTimeChanges(GUILD, 1).total, 0);
});

test('listing survives temporarily unavailable guilds and target operations reject them', async t => {
    const f = fixture(t);
    f.client.guilds.cache.set(OTHER_GUILD, { id: OTHER_GUILD, available: false });
    const list = await f.invoke('서버목록');
    assert.equal(list.title, '전체 서버 목록');
    assert.equal(list.fields.length, 2);
    const error = await f.invoke('시간설정', {
        strings: { 유저id: USER, 서버id: OTHER_GUILD }, integers: { 시간: 1 }
    });
    assert.equal(error.title, '어드민 처리 안내');
    assert.equal(f.db.getStudyTime(OTHER_GUILD, USER), 0);
});
