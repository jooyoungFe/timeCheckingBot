import Database from "better-sqlite3"
import fs from "fs"

if (!fs.existsSync("./data")) fs.mkdirSync("./data")
const db = new Database("./data/study.db")
db.pragma("journal_mode = WAL")

// 테이블

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
    guild_id TEXT PRIMARY KEY,
    study_channel_id TEXT
);
CREATE TABLE IF NOT EXISTS study_times (
    guild_id TEXT,
    user_id TEXT,
    total_seconds INTEGER DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS active_sessions (
    guild_id TEXT,
    user_id TEXT,
    last_saved INTEGER,
    PRIMARY KEY (guild_id, user_id)
);
CREATE TABLE IF NOT EXISTS admin_time_changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    admin_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    before_seconds INTEGER NOT NULL,
    after_seconds INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
`)

export type TimeOperation = "set" | "add" | "subtract" | "reset"
export type AdminTimeChange = {
    id: number
    guild_id: string
    user_id: string
    admin_id: string
    operation: TimeOperation
    before_seconds: number
    after_seconds: number
    reason: string
    created_at: number
}

type Session = { guild_id: string, user_id: string, last_saved: number }
type TimeChange = (
    guildId: string, userId: string, adminId: string,
    operation: TimeOperation, seconds: number, reason: string
) => { before: number, after: number }

// 쿼리

const sql = {
    channel: db.prepare("SELECT study_channel_id FROM settings WHERE guild_id = ?"),
    setChannel: db.prepare(`
        INSERT INTO settings (guild_id, study_channel_id) VALUES (?, ?)
        ON CONFLICT(guild_id) DO UPDATE SET study_channel_id = excluded.study_channel_id
    `),
    removeChannel: db.prepare("DELETE FROM settings WHERE guild_id = ?"),
    start: db.prepare("INSERT OR IGNORE INTO active_sessions VALUES (?, ?, ?)"),
    session: db.prepare("SELECT last_saved FROM active_sessions WHERE guild_id = ? AND user_id = ?"),
    guildSessions: db.prepare("SELECT * FROM active_sessions WHERE guild_id = ?"),
    allSessions: db.prepare("SELECT * FROM active_sessions"),
    updateSession: db.prepare("UPDATE active_sessions SET last_saved = ? WHERE guild_id = ? AND user_id = ?"),
    stop: db.prepare("DELETE FROM active_sessions WHERE guild_id = ? AND user_id = ?"),
    clearGuild: db.prepare("DELETE FROM active_sessions WHERE guild_id = ?"),
    clearAll: db.prepare("DELETE FROM active_sessions"),
    time: db.prepare("SELECT total_seconds FROM study_times WHERE guild_id = ? AND user_id = ?"),
    addTime: db.prepare(`
        INSERT INTO study_times (guild_id, user_id, total_seconds) VALUES (?, ?, ?)
        ON CONFLICT(guild_id, user_id)
        DO UPDATE SET total_seconds = total_seconds + excluded.total_seconds
    `),
    setTime: db.prepare(`
        INSERT INTO study_times (guild_id, user_id, total_seconds) VALUES (?, ?, ?)
        ON CONFLICT(guild_id, user_id) DO UPDATE SET total_seconds = excluded.total_seconds
    `),
    ranking: db.prepare(`
        SELECT user_id, total_seconds FROM study_times
        WHERE guild_id = ? ORDER BY total_seconds DESC LIMIT 10
    `),
    log: db.prepare(`
        INSERT INTO admin_time_changes (
            guild_id, user_id, admin_id, operation, before_seconds, after_seconds, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    historyCount: db.prepare("SELECT COUNT(*) AS total FROM admin_time_changes WHERE guild_id = ?"),
    userHistoryCount: db.prepare("SELECT COUNT(*) AS total FROM admin_time_changes WHERE guild_id = ? AND user_id = ?"),
    history: db.prepare("SELECT * FROM admin_time_changes WHERE guild_id = ? ORDER BY id DESC LIMIT 5 OFFSET ?"),
    userHistory: db.prepare("SELECT * FROM admin_time_changes WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 5 OFFSET ?")
}

// 설정

export function getStudyChannel(guildId: string) {
    const row = sql.channel.get(guildId) as { study_channel_id: string } | undefined
    return row?.study_channel_id ?? null
}

export function setStudyChannel(guildId: string, channelId: string) {
    sql.setChannel.run(guildId, channelId)
}

export function removeStudyChannel(guildId: string) {
    sql.removeChannel.run(guildId)
}

// 세션

export function startStudy(guildId: string, userId: string) {
    sql.start.run(guildId, userId, Date.now())
}

export const stopStudy: (guildId: string, userId: string) => void = db.transaction((guildId: string, userId: string) => {
    const session = sql.session.get(guildId, userId) as { last_saved: number } | undefined
    if (!session) return

    const seconds = Math.floor((Date.now() - session.last_saved) / 1000)
    if (seconds > 0) sql.addTime.run(guildId, userId, seconds)
    sql.stop.run(guildId, userId)
})

// 저장

const save = db.transaction((guildId?: string) => {
    const rows = (guildId === undefined ? sql.allSessions.all() : sql.guildSessions.all(guildId)) as Session[]
    const now = Date.now()

    for (const row of rows) {
        const seconds = Math.floor((now - row.last_saved) / 1000)
        if (seconds <= 0) continue

        sql.addTime.run(row.guild_id, row.user_id, seconds)
        sql.updateSession.run(now, row.guild_id, row.user_id)
    }
})

export function saveGuild(guildId: string) {
    save(guildId)
}

export function saveAll() {
    save()
}

export function clearGuildSessions(guildId: string) {
    save(guildId)
    sql.clearGuild.run(guildId)
}

export function clearSessions() {
    sql.clearAll.run()
}

// 조회

export function getStudyTime(guildId: string, userId: string) {
    const row = sql.time.get(guildId, userId) as { total_seconds: number } | undefined
    return row?.total_seconds ?? 0
}

export function getCurrentStudyTime(guildId: string, userId: string, now = Date.now()) {
    const session = sql.session.get(guildId, userId) as { last_saved: number } | undefined
    const elapsed = session ? Math.max(0, Math.floor((now - session.last_saved) / 1000)) : 0
    return getStudyTime(guildId, userId) + elapsed
}

export function getRanking(guildId: string) {
    return sql.ranking.all(guildId) as { user_id: string, total_seconds: number }[]
}

export function getAdminTimeChanges(guildId: string, page: number, userId?: string) {
    const offset = (page - 1) * 5
    const count = (userId ? sql.userHistoryCount.get(guildId, userId) : sql.historyCount.get(guildId)) as { total: number }
    const rows = (userId ? sql.userHistory.all(guildId, userId, offset) : sql.history.all(guildId, offset)) as AdminTimeChange[]
    return { total: count.total, rows }
}

// 시간 변경

export const changeStudyTime: TimeChange = db.transaction<TimeChange>((guildId, userId, adminId, operation, seconds, reason) => {
    if (!Number.isSafeInteger(seconds) || seconds < 0)
        throw new Error("시간은 0 이상의 정수로 입력해주세요.")
    if ((operation === "add" || operation === "subtract") && seconds === 0)
        throw new Error("추가하거나 차감할 시간은 0초보다 커야 합니다.")

    const now = Date.now()
    const before = getCurrentStudyTime(guildId, userId, now)
    let after: number

    switch (operation) {
        case "set": after = seconds; break
        case "add": after = before + seconds; break
        case "subtract": after = Math.max(0, before - seconds); break
        case "reset": after = 0; break
        default: throw new Error("지원하지 않는 시간 변경 방식입니다.")
    }
    if (!Number.isSafeInteger(after) || after < 0)
        throw new Error("저장할 수 있는 시간 범위를 초과했습니다.")

    sql.setTime.run(guildId, userId, after)
    sql.updateSession.run(now, guildId, userId)
    sql.log.run(guildId, userId, adminId, operation, before, after, reason, now)
    return { before, after }
})
