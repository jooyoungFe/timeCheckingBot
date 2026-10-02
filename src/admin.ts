import { escapeMarkdown, MessageFlags } from "discord.js"
import type { ChatInputCommandInteraction, Client } from "discord.js"
import { changeStudyTime, getAdminTimeChanges, getCurrentStudyTime, getStudyChannel } from "./db"
import type { TimeOperation } from "./db"
import { colors, createEmbed, removeEmoji, sendResult } from "./output"
import { getTier } from "./tier"

// 권한

const adminIds = new Set((process.env.BOT_ADMIN_IDS || "").split(/[,\s]+/).filter(id => /^\d{17,20}$/.test(id)))

export function isBotAdmin(userId: string) {
    return adminIds.has(userId)
}

const operations: Record<string, TimeOperation> = {
    시간설정: "set", 시간추가: "add", 시간차감: "subtract", 시간초기화: "reset"
}
const operationLabels = { set: "설정", add: "추가", subtract: "차감", reset: "초기화" }

function label(text: string | null | undefined, fallback: string) {
    return escapeMarkdown(removeEmoji(text || "") || fallback)
}

function duration(seconds: number) {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)
    return `**${hours.toLocaleString("ko-KR")}시간 ${minutes}분 ${seconds % 60}초**`
}

// 명령어

export async function handleAdmin(i: ChatInputCommandInteraction, client: Client) {
    await i.deferReply({ flags: MessageFlags.Ephemeral })
    const embed = createEmbed("어드민").setFooter({ text: "BOT ADMIN | 본인에게만 표시" })

    if (!isBotAdmin(i.user.id)) {
        embed.setColor(colors.warning).setTitle("어드민 권한 안내")
            .setDescription("이 명령어는 `.env`에 등록된 **봇 어드민만** 사용할 수 있습니다.")
        await sendResult(i, embed)
        return
    }

    try {
        const sub = i.options.getSubcommand()
        const page = i.options.getInteger("페이지") || 1

        if (sub === "서버목록") {
            const guilds = [...client.guilds.cache.values()].sort((a, b) => a.id.localeCompare(b.id))
            const pages = Math.max(1, Math.ceil(guilds.length / 10))
            if (page > pages) throw new Error(`페이지는 1~${pages} 사이로 입력해주세요.`)

            embed.setTitle("전체 서버 목록")
                .setDescription(`**참가 서버 ${guilds.length}개** | ${page} / ${pages}페이지`)
            const start = (page - 1) * 10
            for (let n = start; n < Math.min(start + 10, guilds.length); n++) {
                const guild = guilds[n]!
                embed.addFields({
                    name: `${String(n + 1).padStart(2, "0")} | ${label(guild.name, "서버").slice(0, 220)}`,
                    value: `서버 ID: \`${guild.id}\`\n멤버: **${(guild.memberCount || 0).toLocaleString("ko-KR")}명** | ${guild.available ? "연결됨" : "연결 대기"}`
                })
            }
            if (!guilds.length) embed.setDescription("봇이 참가한 서버가 없습니다.")
            await sendResult(i, embed)
            return
        }

        const requestedId = i.options.getString("서버id")
        if (!requestedId && (!i.guildId || !client.guilds.cache.has(i.guildId)))
            throw new Error("DM이나 봇이 없는 서버에서는 관리할 `서버id`를 입력해주세요. `/어드민 서버목록`에서 확인할 수 있습니다.")

        const guildId = requestedId || i.guildId || ""
        if (!/^\d{17,20}$/.test(guildId))
            throw new Error("서버 ID와 사용자 ID는 17~20자리 숫자로 입력해주세요.")
        const guild = client.guilds.cache.get(guildId)
        if (!guild) throw new Error("봇이 참가한 서버 ID를 입력해주세요. `/어드민 서버목록`에서 확인할 수 있습니다.")
        if (!guild.available) throw new Error("현재 해당 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.")

        if (sub === "서버정보") {
            const channelId = getStudyChannel(guild.id)
            const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null
            embed.setTitle("서버 정보").setDescription(`**${label(guild.name, "서버")}**`)
                .addFields(
                    { name: "서버 ID", value: `\`${guild.id}\``, inline: true },
                    { name: "멤버 수", value: `**${guild.memberCount.toLocaleString("ko-KR")}명**`, inline: true },
                    { name: "서버 소유자 ID", value: `\`${guild.ownerId}\``, inline: true },
                    { name: "공부방", value: channelId
                        ? `${channel ? label(channel.name, "공부방") : "채널 확인 불가"}\n\`${channelId}\``
                        : "설정되지 않음" }
                )
            await sendResult(i, embed)
            return
        }

        if (sub === "변경내역") {
            const userId = i.options.getString("유저id")
            if (userId && !/^\d{17,20}$/.test(userId))
                throw new Error("서버 ID와 사용자 ID는 17~20자리 숫자로 입력해주세요.")
            const history = getAdminTimeChanges(guild.id, page, userId || undefined)
            const pages = Math.max(1, Math.ceil(history.total / 5))
            if (page > pages) throw new Error(`페이지는 1~${pages} 사이로 입력해주세요.`)

            embed.setTitle("시간 변경내역")
                .setDescription(`**${label(guild.name, "서버")}**\n총 ${history.total}건 | ${page} / ${pages}페이지`)
            for (const row of history.rows) {
                embed.addFields({
                    name: `#${row.id} | 시간 ${operationLabels[row.operation]}`,
                    value: `사용자: \`${row.user_id}\`\n변경: ${duration(row.before_seconds)} → ${duration(row.after_seconds)}\n어드민: \`${row.admin_id}\`\n사유: ${label(row.reason, "사유 없음")}\n일시: <t:${Math.floor(row.created_at / 1000)}:f>`
                })
            }
            if (!history.total) embed.setDescription("시간 변경내역이 없습니다.")
            await sendResult(i, embed)
            return
        }

        const userId = i.options.getString("유저id", true)
        if (!/^\d{17,20}$/.test(userId))
            throw new Error("서버 ID와 사용자 ID는 17~20자리 숫자로 입력해주세요.")
        const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null)
        const user = member?.user || client.users.cache.get(userId) || await client.users.fetch(userId).catch(() => null)
        const name = label(member?.displayName || user?.displayName, "사용자")
        embed.addFields(
            { name: "대상 서버", value: `${label(guild.name, "서버")}\n\`${guild.id}\``, inline: true },
            { name: "대상 사용자", value: `${name}\n\`${userId}\``, inline: true }
        )

        if (sub === "시간조회") {
            const seconds = getCurrentStudyTime(guild.id, userId)
            embed.setTitle("사용자 공부시간")
                .setDescription("현재 진행 중인 공부시간도 포함한 기록입니다.")
                .addFields(
                    { name: "누적 공부시간", value: duration(seconds), inline: true },
                    { name: "현재 티어", value: `\`${getTier(seconds)}\``, inline: true }
                )
            await sendResult(i, embed)
            return
        }

        const operation = operations[sub]
        if (!operation) throw new Error("지원하지 않는 어드민 명령어입니다.")
        let seconds = 0
        if (operation !== "reset") {
            seconds = i.options.getInteger("시간", true) * 3600
                + (i.options.getInteger("분") || 0) * 60 + (i.options.getInteger("초") || 0)
        }
        const reason = removeEmoji(i.options.getString("사유") || "") || "사유 없음"
        const result = changeStudyTime(guild.id, userId, i.user.id, operation, seconds, reason)
        embed.setColor(colors.success).setTitle(`공부시간 ${operationLabels[operation]} 완료`)
            .setDescription("변경 내용을 저장했습니다. 공부 중이라면 이 시점부터 계속 기록됩니다.")
            .addFields(
                { name: "변경 전", value: duration(result.before), inline: true },
                { name: "변경 후", value: duration(result.after), inline: true },
                { name: "현재 티어", value: `\`${getTier(result.after)}\``, inline: true },
                { name: "변경 사유", value: label(reason, "사유 없음") }
            )
    } catch (error) {
        embed.setColor(colors.warning).setTitle("어드민 처리 안내").setFields([])
            .setDescription(error instanceof Error ? error.message : "처리 중 오류가 발생했습니다.")
    }
    await sendResult(i, embed)
}
