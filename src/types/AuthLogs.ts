export interface AuthLog {
    userId: string
    userName: string
    action: 'login' | 'logout'
    success: boolean
    error?: string
    leagueId?: string
    deviceInfo?: any
    timestamp?: any
}
