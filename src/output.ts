import { EmbedBuilder } from "discord.js"
import type { ChatInputCommandInteraction } from "discord.js"

// 색상

export const colors = {
    primary: 0x93c5fd,
    success: 0x6ee7b7,
    warning: 0xfdba74,
    ranking: 0xfde68a
} as const

export function removeEmoji(text: string) {
    return text
        .replace(/<a?:\w+:\d+>/g, "")
        .replace(/[#*0-9]\uFE0F?\u20E3/g, "")
        .replace(/\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Emoji_Modifier}|[\u200D\u20E3\uFE0E\uFE0F\u{E0020}-\u{E007F}]/gu, "")
        .replace(/[ \t]{2,}/g, " ")
        .trim()
}

// 임베드

export function createEmbed(title: string, color: number = colors.primary) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(removeEmoji(title) || "공부 기록")
        .setFooter({ text: "STUDY LOG | 공부 기록" })
        .setTimestamp()
}

export function cleanEmbed(embed: EmbedBuilder) {
    const data = embed.toJSON()

    if (data.title) data.title = removeEmoji(data.title) || "공부 기록"
    if (data.description) data.description = removeEmoji(data.description) || "내용 없음"
    if (data.author) data.author.name = removeEmoji(data.author.name) || "사용자"
    if (data.footer) data.footer.text = removeEmoji(data.footer.text) || "공부 기록"

    for (const field of data.fields || []) {
        field.name = removeEmoji(field.name) || "항목"
        field.value = removeEmoji(field.value) || "내용 없음"
    }

    return new EmbedBuilder(data)
}

export async function sendResult(i: ChatInputCommandInteraction, embed: EmbedBuilder) {
    await i.editReply({ embeds: [cleanEmbed(embed)], allowedMentions: { parse: [] } })
}

export function progressBar(percent: number) {
    const value = Math.min(100, Math.max(0, Math.floor(percent)))
    const filled = Math.floor(value / 5)

    return `[${"=".repeat(filled)}${"-".repeat(20 - filled)}] ${value}%`
}
