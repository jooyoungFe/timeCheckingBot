const assert = require('node:assert/strict');
const test = require('node:test');
const discord = require('discord.js');
const { loadCompiled, loadDatabase } = require('./helpers.cjs');
const output = require('../dist/output.js');
const tier = require('../dist/tier.js');

test('main interaction router preserves normal visibility and sends admins privately', async t => {
    const storage = loadDatabase();
    t.after(() => storage.database.close());
    const env = { DISCORD_TOKEN: 'offline-test', BOT_ADMIN_IDS: '1022487323465744477' };
    const admin = loadCompiled('admin', {
        'discord.js': discord, './db': storage.db, './output': output, './tier': tier
    }, { process: { env } });
    let onInteraction;
    const guild = {
        id: '223456789012345678', name: 'Server', available: true, memberCount: 1,
        members: { cache: new Map([['1022487323465744477', { displayName: 'Admin' }]]), fetch: async () => null },
        channels: { fetch: async () => null }
    };
    class MockClient {
        constructor() {
            this.guilds = { cache: new Map([[guild.id, guild]]) };
            this.users = { cache: new Map(), fetch: async () => null };
        }
        once() {}
        on(event, handler) { if (event === discord.Events.InteractionCreate) onInteraction = handler; }
        login() {}
    }
    loadCompiled('index', {
        'dotenv/config': {}, 'discord.js': { ...discord, Client: MockClient },
        './db': storage.db, './output': output, './tier': tier, './admin': admin
    }, { process: { env, on() {} }, setInterval() {}, console: { log() {}, error() {} } });
    for (const [commandName, sub, privateExpected, context = 'guild'] of [
        ['공부', '시간', false], ['공부', '순위', false], ['공부', '진척도', false],
        ['공부', '티어', true], ['공부방', '확인', false], ['어드민', '서버목록', true],
        ['어드민', '서버목록', true, 'dm'], ['어드민', '서버목록', true, 'external']
    ]) {
        let flags;
        let reply;
        const interaction = {
            commandName,
            guild: context === 'guild' ? guild : null,
            guildId: context === 'dm' ? null : context === 'external' ? '999999999999999999' : guild.id,
            isChatInputCommand: () => true,
            user: { id: '1022487323465744477', displayAvatarURL: () => 'https://example.com/avatar.png' },
            options: { getSubcommand: () => sub, getUser: () => null, getInteger: () => null },
            memberPermissions: { has: () => true },
            deferReply: async options => { flags = options.flags || 0; },
            editReply: async options => { reply = options; },
            channel: { send() { throw new Error('Must reply through the interaction'); } },
            deleteReply() { throw new Error('Must preserve normal command attribution'); }
        };
        await onInteraction(interaction);
        assert.ok(reply, `No reply for ${commandName} ${sub}`);
        assert.equal(Boolean(flags & discord.MessageFlags.Ephemeral), privateExpected, `${commandName} ${sub}`);
    }
});
