import "dotenv/config"

import {
    ApplicationIntegrationType,
    ChannelType,
    InteractionContextType,
    OAuth2Scopes,
    PermissionFlagsBits,
    REST,
    Routes,
    SlashCommandBuilder
} from "discord.js"
import type { APIApplication } from "discord.js"

import { adminCommand } from "./admin-command"

const token = process.env.DISCORD_TOKEN
const clientId = process.env.CLIENT_ID

if (!token || !clientId)
    throw new Error("env 확인")

// 명령어

const commands = [
    new SlashCommandBuilder()
        .setName("공부방")
        .setDescription("공부방 설정")
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)

        .addSubcommand(x =>
            x.setName("설정")
                .setDescription("공부방 설정")
                .addChannelOption(x =>
                    x.setName("채널")
                        .setDescription("음성채널")
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildVoice)
                )
        )

        .addSubcommand(x =>
            x.setName("확인")
                .setDescription("공부방 확인")
        )

        .addSubcommand(x =>
            x.setName("해제")
                .setDescription("공부방 해제")
        ),

    new SlashCommandBuilder()
        .setName("공부")
        .setDescription("공부 기록")
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall)
        .setContexts(InteractionContextType.Guild)

        .addSubcommand(x =>
            x.setName("시간")
                .setDescription("공부시간 확인")
                .addUserOption(x =>
                    x.setName("유저")
                        .setDescription("확인할 유저")
                )
        )

        .addSubcommand(x =>
            x.setName("순위")
                .setDescription("공부 순위")
        )

        .addSubcommand(x =>
            x.setName("진척도")
                .setDescription("티어 진척도 확인")
                .addUserOption(x =>
                    x.setName("유저")
                        .setDescription("확인할 유저")
                )
        )

        .addSubcommand(x =>
            x.setName("티어")
                .setDescription("티어 목록 확인")
        ),
    adminCommand
].map(x => x.toJSON())

// 등록

const rest = new REST({ version: "10" }).setToken(token)

async function deploy() {
    const application = await rest.get(Routes.currentApplication()) as APIApplication

    if (application.id !== clientId)
        throw new Error("CLIENT_ID가 봇 애플리케이션 ID와 일치하지 않습니다.")

    const config = application.integration_types_config || {}
    const userConfig = config[ApplicationIntegrationType.UserInstall]
    const params = userConfig?.oauth2_install_params

    if (!params || params.permissions !== "0"
        || params.scopes.length !== 1 || params.scopes[0] !== "applications.commands") {
        config[ApplicationIntegrationType.GuildInstall] ??= {
            oauth2_install_params: application.install_params || {
                scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands], permissions: "0"
            }
        }
        config[ApplicationIntegrationType.UserInstall] = {
            ...userConfig,
            oauth2_install_params: { scopes: [OAuth2Scopes.ApplicationsCommands], permissions: "0" }
        }
        await rest.patch(Routes.currentApplication(), {
            body: { integration_types_config: config }
        })
    }

    await rest.put(Routes.applicationCommands(application.id), { body: commands })
    console.log("슬래시 명령어 등록 완료")
    console.log(`어드민 사용자 설치: https://discord.com/oauth2/authorize?client_id=${clientId}&scope=applications.commands&integration_type=1`)
}

deploy().catch(error => {
    console.error("슬래시 명령어 등록 실패:", error instanceof Error ? error.message : "알 수 없는 오류")
    process.exitCode = 1
})
