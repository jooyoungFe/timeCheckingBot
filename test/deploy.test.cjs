const assert = require('node:assert/strict');
const test = require('node:test');
const discord = require('discord.js');
const { loadCompiled } = require('./helpers.cjs');
const { adminCommand } = require('../dist/admin-command.js');

const APP = '123456789012345678';
const clone = value => JSON.parse(JSON.stringify(value));

async function deployFixture(application) {
    const calls = [];
    const logs = [];
    const processState = { env: { DISCORD_TOKEN: 'offline-test', CLIENT_ID: APP } };
    class MockRest {
        setToken() { return this; }
        async get(route) { calls.push({ method: 'get', route }); return application; }
        async patch(route, options) { calls.push({ method: 'patch', route, body: clone(options.body) }); return { ...application, ...options.body }; }
        async put(route, options) { calls.push({ method: 'put', route, body: clone(options.body) }); return options.body; }
    }
    loadCompiled('deploy-commands', {
        'dotenv/config': {}, 'discord.js': { ...discord, REST: MockRest },
        './admin-command': { adminCommand }
    }, { process: processState, console: { log: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) } });
    await new Promise(setImmediate);
    return { calls, logs, processState };
}

test('deployment enables user installation while retaining existing guild permissions', async () => {
    const guildConfig = { oauth2_install_params: { scopes: ['bot', 'applications.commands'], permissions: '2048' } };
    const result = await deployFixture({ id: APP, integration_types_config: { 0: guildConfig } });
    assert.deepEqual(result.calls.map(call => call.method), ['get', 'patch', 'put']);
    const config = result.calls[1].body.integration_types_config;
    assert.deepEqual(config[0], guildConfig);
    assert.deepEqual(config[1].oauth2_install_params, { scopes: ['applications.commands'], permissions: '0' });
    const commands = result.calls[2].body;
    for (const command of commands) {
        assert.deepEqual(command.integration_types, [command.name === '어드민' ? discord.ApplicationIntegrationType.UserInstall : discord.ApplicationIntegrationType.GuildInstall]);
        assert.deepEqual(command.contexts, command.name === '어드민'
            ? [discord.InteractionContextType.Guild, discord.InteractionContextType.BotDM, discord.InteractionContextType.PrivateChannel]
            : [discord.InteractionContextType.Guild]);
    }
    const link = result.logs.find(message => message.includes('https://discord.com/oauth2/authorize'));
    assert.ok(link.includes(`client_id=${APP}`));
    assert.ok(link.includes('scope=applications.commands&integration_type=1'));
});

test('already configured user installation needs no application update', async () => {
    const result = await deployFixture({ id: APP, integration_types_config: {
        0: {}, 1: { oauth2_install_params: { scopes: ['applications.commands'], permissions: '0' } }
    } });
    assert.deepEqual(result.calls.map(call => call.method), ['get', 'put']);
});

test('legacy application install permissions are preserved when adding contexts', async () => {
    const installParams = { scopes: ['bot', 'applications.commands'], permissions: '16384' };
    const result = await deployFixture({ id: APP, install_params: installParams });
    assert.deepEqual(result.calls[1].body.integration_types_config[0].oauth2_install_params, installParams);
});

test('mismatched application ID fails before changing settings or commands', async () => {
    const result = await deployFixture({ id: '999999999999999999' });
    assert.deepEqual(result.calls.map(call => call.method), ['get']);
    assert.equal(result.processState.exitCode, 1);
});
