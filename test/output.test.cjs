const assert = require('node:assert/strict');
const test = require('node:test');
const { EmbedBuilder } = require('discord.js');
const { cleanEmbed, removeEmoji } = require('../dist/output');

test('output removes unicode sequences and custom Discord emoji without removing ordinary text', () => {
    for (const emoji of [
        '\u{1F4DA}', '\u{1F468}\u{1F3FD}\u200D\u{1F4BB}', '\u{1F1F0}\u{1F1F7}',
        '1\uFE0F\u20E3', '\u2764\uFE0F', '<:study:123456789>', '<a:study:123456789>'
    ]) {
        assert.equal(removeEmoji(`Study ${emoji} Log`), 'Study Log');
        assert.equal(removeEmoji(emoji), '');
    }
    assert.equal(removeEmoji('공부 123 | [====----] 50%'), '공부 123 | [====----] 50%');
    const embed = new EmbedBuilder().setTitle('공부 \u{1F4DA}')
        .setAuthor({ name: '\u{1F4DA}' }).setFooter({ text: '\u{1F4DA}' })
        .addFields({ name: '\u{1F4DA}', value: '\u{1F4DA}' });
    const data = cleanEmbed(embed).toJSON();
    assert.equal(data.title, '공부');
    assert.equal(data.author.name, '사용자');
    assert.ok(data.footer.text.length > 0);
    assert.ok(data.fields[0].name.length > 0);
    assert.ok(data.fields[0].value.length > 0);
});
