import { Logger } from '../../model/logger'
import { PlayerAvailabilityInfo } from '../../model/player'
import { getMappedPlayerName } from './playerNameDiffMapping'
import { DomFilter, HtmlCacheEntry, StatusCacheEntry } from './types'

/**
 * Service for handling caching of HTML content and player status
 */
export class CacheService {
    private logger: Logger
    private htmlCache: Map<string, HtmlCacheEntry> = new Map()
    private statusCache: Map<string, StatusCacheEntry> = new Map()

    private readonly htmlCacheDurationMs: number
    private readonly statusCacheDurationMs: number

    constructor(
        logger: Logger,
        htmlCacheDurationMinutes: number = 10,
        statusCacheDurationMinutes: number = 5
    ) {
        this.logger = logger
        this.htmlCacheDurationMs = htmlCacheDurationMinutes * 60 * 1000
        this.statusCacheDurationMs = statusCacheDurationMinutes * 60 * 1000
    }

    /**
     * Build a unique key for status-level cache entries
     * Uses mapped player name if available
     */
    public buildStatusCacheKey(
        url: string,
        playerName: string,
        domFilter?: DomFilter
    ): string {
        const mappedName = getMappedPlayerName(playerName)
        return `${url}|${mappedName.toLowerCase()}|${domFilter?.type ?? 'none'}`
    }

    /**
     * Get HTML content from cache if available and not expired
     */
    public getHtmlFromCache(url: string): string | null {
        const now = Date.now()
        const cachedEntry = this.htmlCache.get(url)

        if (!cachedEntry) {
            this.logger.info(
                `HTML cache miss for URL: ${url} (not in cache, current cache size: ${this.htmlCache.size})`
            )
            return null
        }

        const ageMs = now - cachedEntry.timestamp
        const expiresInMs = this.htmlCacheDurationMs - ageMs

        if (ageMs < this.htmlCacheDurationMs) {
            this.logger.info(
                `HTML cache hit for URL: ${url} (age: ${Math.round(
                    ageMs / 1000
                )}s, expires in: ${Math.round(expiresInMs / 1000)}s)`
            )
            return cachedEntry.content
        } else {
            this.logger.info(
                `HTML cache expired for URL: ${url} (age: ${Math.round(
                    ageMs / 1000
                )}s, expired ${Math.round(-expiresInMs / 1000)}s ago)`
            )
            return null
        }
    }

    /**
     * Store HTML content in cache
     */
    public cacheHtml(url: string, content: string): void {
        const now = Date.now()
        this.htmlCache.set(url, { content, timestamp: now })
        this.logger.info(
            `Cached raw HTML for URL: ${url} (cache size now: ${this.htmlCache.size})`
        )
    }

    /**
     * Get player status from cache if available
     * Returns the cached status even if expired if returnStale is true
     * Uses mapped player name for lookup
     */
    public getPlayerStatusFromCache(
        url: string,
        playerName: string,
        domFilter?: DomFilter,
        returnStale: boolean = true
    ): PlayerAvailabilityInfo | null {
        const now = Date.now()
        const mappedName = getMappedPlayerName(playerName)
        const cacheKey = this.buildStatusCacheKey(url, mappedName, domFilter)
        const cachedStatus = this.statusCache.get(cacheKey)

        if (!cachedStatus) {
            if (mappedName !== playerName) {
                this.logger.warning(
                    `Status cache MISS for ${playerName} (mapped to: ${mappedName}) (filter: ${domFilter?.type ?? 'none'}, key: ${cacheKey})`
                )
            } else {
                this.logger.warning(
                    `Status cache MISS for ${playerName} (filter: ${domFilter?.type ?? 'none'}, key: ${cacheKey})`
                )
            }
            return null
        }

        const ageMs = now - cachedStatus.timestamp
        const isExpired = ageMs >= this.statusCacheDurationMs

        if (isExpired) {
            this.logger.warning(
                `Status cache expired for ${playerName} (filter: ${domFilter?.type ?? 'none'}, age: ${Math.round(ageMs / 1000)}s)`
            )

            // Return stale data if requested
            return returnStale ? cachedStatus.info : null
        } else {
            this.logger.info(
                `Status cache hit for ${playerName} (filter: ${domFilter?.type ?? 'none'}, age: ${Math.round(ageMs / 1000)}s)`
            )
            return cachedStatus.info
        }
    }

    /**
     * Store player status in cache
     * Uses mapped player name if available
     */
    public cachePlayerStatus(
        url: string,
        playerName: string,
        status: PlayerAvailabilityInfo,
        filter?: DomFilter,
        timestamp: number = Date.now()
    ): void {
        // Skip empty player names
        if (!playerName || playerName.trim() === '') {
            this.logger.warning(
                `Attempted to cache status for empty player name, skipping`
            )
            return
        }

        const mappedName = getMappedPlayerName(playerName)
        const cacheKey = this.buildStatusCacheKey(url, mappedName, filter)

        this.statusCache.set(cacheKey, {
            info: status,
            timestamp: timestamp,
        })

        if (mappedName !== playerName) {
            this.logger.debug(
                `Caching status for ${playerName} (mapped to: ${mappedName}) [${filter?.type ?? 'no filter'}]: ` +
                    `isLikelyToPlay=${status.isLikelyToPlay}` +
                    `${status.reason ? ', reason=' + status.reason : ''} (Key: ${cacheKey})`
            )
        } else {
            this.logger.debug(
                `Caching status for ${playerName} [${filter?.type ?? 'no filter'}]: ` +
                    `isLikelyToPlay=${status.isLikelyToPlay}` +
                    `${status.reason ? ', reason=' + status.reason : ''} (Key: ${cacheKey})`
            )
        }
    }
}
