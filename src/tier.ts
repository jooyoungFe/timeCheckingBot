// 기준

const tiers = [
    [0, "아이언 5"],
    [2, "아이언 4"],
    [4, "아이언 3"],
    [6, "아이언 2"],
    [8, "아이언 1"],

    [15, "브론즈 5"],
    [20, "브론즈 4"],
    [25, "브론즈 3"],
    [30, "브론즈 2"],
    [35, "브론즈 1"],

    [50, "실버 5"],
    [60, "실버 4"],
    [70, "실버 3"],
    [80, "실버 2"],
    [90, "실버 1"],

    [120, "골드 5"],
    [140, "골드 4"],
    [160, "골드 3"],
    [180, "골드 2"],
    [200, "골드 1"],

    [250, "플레 5"],
    [290, "플레 4"],
    [330, "플레 3"],
    [370, "플레 2"],
    [410, "플레 1"],

    [500, "다이아 5"],
    [575, "다이아 4"],
    [650, "다이아 3"],
    [725, "다이아 2"],
    [800, "다이아 1"],

    [950, "마스터 5"],
    [1075, "마스터 4"],
    [1200, "마스터 3"],
    [1325, "마스터 2"],
    [1450, "마스터 1"],

    [1700, "그랜드마스터 5"],
    [1900, "그랜드마스터 4"],
    [2100, "그랜드마스터 3"],
    [2300, "그랜드마스터 2"],
    [2500, "그랜드마스터 1"]
] as const

// 티어

export function getTier(sec: number) {
    if (sec <= 0) return "플라스틱"

    const hour = sec / 3600

    for (let i = tiers.length - 1; i >= 0; i--) {
        const [hours, name] = tiers[i]!
        if (hour >= hours) return name
    }

    return "아이언 5"
}

// 진척도

export function getTierProgress(sec: number) {
    if (sec <= 0) {
        return {
            tier: "플라스틱",
            next: "아이언 5",
            percent: 0,
            needHours: 0
        }
    }

    const hour = sec / 3600
    let index = 0

    for (let i = tiers.length - 1; i >= 0; i--) {
        const tier = tiers[i]!

        if (hour >= tier[0]) {
            index = i
            break
        }
    }

    const current = tiers[index]!

    if (index === tiers.length - 1) {
        return {
            tier: current[1],
            next: null,
            percent: 100,
            needHours: 0
        }
    }

    const next = tiers[index + 1]!

    const percent = Math.floor((hour - current[0]) / (next[0] - current[0]) * 100)

    return {
        tier: current[1],
        next: next[1],
        percent: Math.min(100, Math.max(0, percent)),
        needHours: Math.max(0, next[0] - hour)
    }
}

// 목록

export function getTierFields() {
    const fields = [
        { name: "플라스틱", value: "공부 기록 없음 · 0초", inline: true }
    ]

    for (const [hours, name] of tiers) {
        const [group = name, level] = name.split(" ")
        let field = fields[fields.length - 1]!
        if (field.name !== group) {
            field = { name: group, value: "", inline: true }
            fields.push(field)
        }
        const time = hours === 0 ? "0초 초과" : `${hours}시간`

        field.value += `${field.value ? "\n" : ""}**${level}** · ${time}`
    }

    return fields
}
