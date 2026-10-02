import "dotenv/config"

import {
    ChannelType, Client, Events, escapeMarkdown, GatewayIntentBits,
    MessageFlags, PermissionFlagsBits, type Guild
} from "discord.js"

import { colors, createEmbed, progressBar, removeEmoji, sendResult } from "./output"
import { handleAdmin } from "./admin"

import {
    clearGuildSessions, clearSessions, getRanking, getStudyChannel, getStudyTime,
    removeStudyChannel, saveAll, saveGuild, setStudyChannel, startStudy, stopStudy
} from "./db"
import { getTier, getTierFields, getTierProgress } from "./tier"

const token = process.env.DISCORD_TOKEN

if (!token) throw new Error("token 없음")

const client = new Client({
    allowedMentions: { parse: [], repliedUser: false },
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates
    ]
})

// 유틸

function timeText(sec: number) {
    const day = Math.floor(sec / 86400)
    const hour = Math.floor((sec % 86400) / 3600)
    const min = Math.floor((sec % 3600) / 60)

    let text = ""

    if (day) text += `${day}일 `
    if (hour) text += `${hour}시간 `
    if (min) text += `${min}분`

    return text.trim() || `${sec % 60}초`
}

function channelLink(guildId: string, channelId: string, name?: string | null) {
    const label = escapeMarkdown(removeEmoji(name || "") || "공부방")

    return `[#${label}](https://discord.com/channels/${guildId}/${channelId})`
}

async function displayName(guild: Guild, userId: string) {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null)
    if (member) return removeEmoji(member.displayName) || "사용자"

    const user = client.users.cache.get(userId) || await client.users.fetch(userId).catch(() => null)
    return removeEmoji(user?.displayName || "") || "알 수 없는 사용자"
}

// 시작

client.once(Events.ClientReady, async bot => {
    console.log("login:", removeEmoji(bot.user.tag))

    clearSessions()

    for (const guild of bot.guilds.cache.values()) {
        const channelId = getStudyChannel(guild.id)

        if (!channelId) continue

        const channel = await guild.channels.fetch(channelId).catch(() => null)

        if (!channel || channel.type !== ChannelType.GuildVoice) continue

        for (const member of channel.members.values())
            if (!member.user.bot)
                startStudy(guild.id, member.id)
    }
})

// 음성

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (oldState.channelId === newState.channelId) return

    const guildId = newState.guild.id
    const studyRoom = getStudyChannel(guildId)

    if (!studyRoom) return

    const member = newState.member || oldState.member

    if (!member || member.user.bot) return

    if (newState.channelId === studyRoom) {
        startStudy(guildId, member.id)
        console.log(removeEmoji(member.user.username) || "사용자", "start")
    }

    if (oldState.channelId === studyRoom) {
        stopStudy(guildId, member.id)
        console.log(removeEmoji(member.user.username) || "사용자", "stop")
    }
})

// 명령어

client.on(Events.InteractionCreate, async i => {
    if (!i.isChatInputCommand()) return

    if (i.commandName === "어드민") {
        await handleAdmin(i, client)
        return
    }

    const sub = i.options.getSubcommand()
    const replyOptions = i.commandName === "공부" && sub === "티어"
        ? { flags: MessageFlags.Ephemeral as const }
        : {}

    if (!i.guild) {
        await i.reply({
            embeds: [createEmbed("사용 안내", colors.warning)
                .setDescription("이 명령어는 **서버에서만** 사용할 수 있습니다.")],
            ...replyOptions
        })

        return
    }

    const guild = i.guild

    await i.deferReply(replyOptions)

    if (i.commandName === "공부방") {
        if (!i.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            await i.editReply({
                embeds: [createEmbed("권한 안내", colors.warning)
                    .setDescription("공부방 설정은 **관리자만** 변경할 수 있습니다.")]
            })

            return
        }

        if (sub === "설정") {
            const channel = i.options.getChannel("채널", true)

            if (channel.type !== ChannelType.GuildVoice) {
                await i.editReply({
                    embeds: [createEmbed("채널 안내", colors.warning)
                        .setDescription("공부방으로 사용할 **음성 채널**을 선택해주세요.")]
                })

                return
            }

            if (getStudyChannel(guild.id) === channel.id) {
                await i.editReply({
                    embeds: [createEmbed("공부방 설정")
                        .setDescription("선택한 채널은 이미 공부방으로 설정되어 있습니다.")]
                })

                return
            }

            clearGuildSessions(guild.id)
            setStudyChannel(guild.id, channel.id)

            const vc = await guild.channels.fetch(channel.id)

            if (vc?.type === ChannelType.GuildVoice) {
                for (const member of vc.members.values())
                    if (!member.user.bot)
                        startStudy(guild.id, member.id)
            }

            await sendResult(i,
                createEmbed("공부방 설정", colors.success)
                    .setDescription("공부방 설정이 완료되었습니다.")
                    .addFields(
                        { name: "지정 채널", value: channelLink(guild.id, channel.id, channel.name), inline: true },
                        { name: "기록 상태", value: "입장 시 자동 기록", inline: true }
                    )
            )

            console.log("room set", guild.id, channel.id)
            return
        }

        if (sub === "확인") {
            const channel = getStudyChannel(guild.id)
            const room = channel
                ? await guild.channels.fetch(channel).catch(() => null)
                : null

            await i.editReply({
                embeds: [createEmbed("공부방 확인")
                    .setDescription(channel
                        ? `**현재 공부방**\n${channelLink(guild.id, channel, room?.name)}\n\n입장하면 공부시간이 자동으로 기록됩니다.`
                        : "공부방이 설정되어 있지 않습니다.")]
            })

            return
        }

        if (sub === "해제") {
            const channel = getStudyChannel(guild.id)

            if (!channel) {
                await i.editReply({
                    embeds: [createEmbed("공부방 안내", colors.warning)
                        .setDescription("설정된 공부방이 없습니다.\n`/공부방 설정`으로 채널을 지정해주세요.")]
                })

                return
            }

            clearGuildSessions(guild.id)
            removeStudyChannel(guild.id)

            await sendResult(i,
                createEmbed("공부방 해제", colors.warning)
                    .setDescription("공부방 설정을 해제했습니다.\n기존 공부 기록은 보관되며 자동 기록이 중단됩니다.")
            )

            console.log("room removed", guild.id)
            return
        }
    }

    if (i.commandName === "공부") {
        if (sub === "시간") {
            saveGuild(guild.id)

            const user = i.options.getUser("유저") || i.user
            const sec = getStudyTime(guild.id, user.id)
            const name = await displayName(guild, user.id)

            await sendResult(i,
                createEmbed("공부 기록")
                    .setAuthor({ name, iconURL: user.displayAvatarURL() })
                    .setDescription("지금까지 쌓은 공부시간과 현재 티어입니다.")
                    .addFields(
                        { name: "누적 공부시간", value: `**${timeText(sec)}**`, inline: true },
                        { name: "현재 티어", value: `\`${getTier(sec)}\``, inline: true }
                    )
                    .setFooter({ text: `${guild.name} | 누적 공부 기록` })
            )

            return
        }

        if (sub === "순위") {
            saveGuild(guild.id)

            const rank = getRanking(guild.id)

            const embed = createEmbed("공부 순위", colors.ranking)
                .setDescription(rank.length
                    ? `**${escapeMarkdown(removeEmoji(guild.name) || "서버")}**\n누적 공부시간으로 정렬한 순위입니다.`
                    : "아직 공부 기록이 없습니다.\n공부방에 입장해 첫 기록을 시작해보세요.")
                .setFooter({ text: "누적 공부시간 기준 | 상위 10명" })

            const names = await Promise.all(rank.map(row => displayName(guild, row.user_id)))

            for (let n = 0; n < rank.length; n++) {
                const row = rank[n]!

                embed.addFields({
                    name: `${String(n + 1).padStart(2, "0")}위 | ${names[n]}`,
                    value: `**${timeText(row.total_seconds)}**  |  \`${getTier(row.total_seconds)}\``
                })
            }

            await sendResult(i, embed)
            return
        }

        if (sub === "진척도") {
            saveGuild(guild.id)

            const user = i.options.getUser("유저") || i.user
            const sec = getStudyTime(guild.id, user.id)
            const progress = getTierProgress(sec)
            const name = await displayName(guild, user.id)

            const embed = createEmbed("티어 진척도", colors.success)
                .setAuthor({ name, iconURL: user.displayAvatarURL() })
                .addFields({ name: "현재 티어", value: `\`${progress.tier}\``, inline: true })
                .setFooter({ text: `누적 공부시간 | ${timeText(sec)}` })

            if (!progress.next) {
                embed.setDescription("**최고 티어 달성**\n모든 티어 단계를 완료했습니다.")
                    .addFields({ name: "진척도", value: `\`${progressBar(100)}\`` })

                await sendResult(i, embed)

                return
            }

            embed.setDescription("다음 티어까지의 진행 상황입니다.")
                .addFields(
                    { name: "다음 티어", value: `\`${progress.next}\``, inline: true },
                    { name: "남은 시간", value: `**${progress.needHours.toFixed(1)}시간**`, inline: true },
                    { name: "진척도", value: `\`${progressBar(progress.percent)}\`` }
                )

            await sendResult(i, embed)

            return
        }

        if (sub === "티어") {
            await i.editReply({
                embeds: [createEmbed("티어 기준")
                    .setDescription("**누적 공부시간에 따른 승급 기준**\n각 단계는 표시된 시간부터 시작합니다.")
                    .addFields(getTierFields())
                    .setFooter({ text: "이 안내는 명령어를 사용한 본인에게만 보입니다." })]
            })

            return
        }
    }
})

// 자동 저장

setInterval(() => {
    try {
        saveAll()
    } catch (e) {
        console.error("save error", e)
    }
}, 30000)

// 종료

function shutdown() {
    console.log("shutdown")

    try {
        saveAll()
        clearSessions()
    } catch (e) {
        console.error("save error", e)
    }

    client.destroy()
    process.exit()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)

client.login(token)
