import { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } from "discord.js"
// 명령어

export const adminCommand = new SlashCommandBuilder()
    .setName("어드민")
    .setDescription("지정된 봇 어드민 전용 관리 명령어")
    .setIntegrationTypes(ApplicationIntegrationType.UserInstall)
    .setContexts(
        InteractionContextType.Guild,
        InteractionContextType.BotDM,
        InteractionContextType.PrivateChannel
    )

adminCommand.addSubcommand(x => x.setName("서버목록").setDescription("봇이 참가한 전체 서버 조회")
        .addIntegerOption(x => x.setName("페이지").setDescription("조회할 페이지")
            .setMinValue(1).setMaxValue(1_000_000)))

adminCommand.addSubcommand(x => x.setName("서버정보").setDescription("서버 정보와 공부방 설정 조회")
        .addStringOption(x => x.setName("서버id").setDescription("조회할 서버 ID")
            .setRequired(true).setMinLength(17).setMaxLength(20)))

const timeCommands = [
    ["시간조회", "사용자의 현재 누적 공부시간 조회"],
    ["시간설정", "누적 공부시간을 지정한 값으로 변경"],
    ["시간추가", "누적 공부시간에 지정한 시간 추가"],
    ["시간차감", "누적 공부시간에서 지정한 시간 차감 · 최저 0초"],
    ["시간초기화", "사용자의 누적 공부시간을 0초로 초기화"]
] as const

for (const [name, description] of timeCommands) {
    adminCommand.addSubcommand(command => {
        command.setName(name).setDescription(description)
        command.addStringOption(x => x.setName("유저id")
            .setDescription("대상 Discord 사용자 ID").setRequired(true)
            .setMinLength(17).setMaxLength(20))

        if (name !== "시간조회" && name !== "시간초기화") {
            command.addIntegerOption(x => x.setName("시간")
                .setDescription("시간 단위 · 분이나 초만 변경하려면 0 입력")
                .setRequired(true).setMinValue(0).setMaxValue(1_000_000))
            command.addIntegerOption(x => x.setName("분")
                .setDescription("분 단위").setMinValue(0).setMaxValue(59))
            command.addIntegerOption(x => x.setName("초")
                .setDescription("초 단위").setMinValue(0).setMaxValue(59))
        }

        command.addStringOption(x => x.setName("서버id")
            .setDescription("대상 서버 ID · DM이나 봇이 없는 서버에서는 필수")
            .setMinLength(17).setMaxLength(20))

        if (name !== "시간조회") {
            command.addStringOption(x => x.setName("사유")
                .setDescription("시간 변경 사유 · 변경내역에 기록됩니다").setMaxLength(200))
        }
        return command
    })
}

adminCommand.addSubcommand(x => x.setName("변경내역").setDescription("어드민 시간 변경내역 조회")
        .addStringOption(x => x.setName("유저id").setDescription("특정 사용자로 필터")
            .setMinLength(17).setMaxLength(20))
        .addIntegerOption(x => x.setName("페이지").setDescription("조회할 페이지")
            .setMinValue(1).setMaxValue(1_000_000))
        .addStringOption(x => x.setName("서버id")
            .setDescription("대상 서버 ID · DM이나 봇이 없는 서버에서는 필수")
            .setMinLength(17).setMaxLength(20)))
