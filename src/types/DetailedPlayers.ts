interface MatchDay {
    t1: string
    t2: string
    t1g: number
    t2g: number
    day: number
    md: string
    cur: boolean
    mdst: number
}

interface PerformanceHistory {
    hp: boolean
    p?: number
}

interface DetailedPlayer {
    i: string // Player ID
    fn: string // First Name
    ln: string // Last Name
    shn: number // Shirt Number
    tid: string // Team ID
    tn: string // Team Name
    oui: string // Other Unique ID
    st: number // Status
    stxt?: string // Status Text
    pos: number // Position
    iposl: boolean // Position Lock?
    tp?: number // Total Points
    ap?: number // Average Points
    sec?: number // Seconds Played
    g?: number // Goals
    a?: number // Assists
    ph: PerformanceHistory[] // Performance History
    mv: number // Market Value
    cv: number // Current Value
    tfhmvt: number // Transfer Market Value Trend
    mvt: number // Market Value Trend
    day: number // Current Day
    r?: number // Red Cards
    y?: number // Yellow Cards
    mdsum: MatchDay[] // Match Day Summary
    stud?: number // Study Value
    smc?: number // Some Metric Count
    ismc?: number // Another Metric Count
    smdc: number // Summary Metric Day Count
    sl: boolean // Status Lock?
    plpt: string // Player Platform Type
    dt?: string // Date/Time
    opl: any[] // Other Player List
    group?: string
}

interface DetailedPlayersResponse {
    players: {
        [key: string]: DetailedPlayer
    }
    date: string
}

export type {
    DetailedPlayer,
    DetailedPlayersResponse,
    MatchDay,
    PerformanceHistory,
}
