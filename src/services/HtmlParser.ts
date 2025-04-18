import * as cheerio from 'cheerio'
import { AnyNode } from 'domhandler'
import { Logger } from '../model/logger'
import { PlayerAvailabilityInfo } from '../model/player'
import { httpClient } from '../server'

interface CacheEntry {
    content: string
    timestamp: number
}

interface StatusCacheEntry {
    info: PlayerAvailabilityInfo
    timestamp: number
}

export interface DomFilter {
    type: 'visibility' | string // extensible for future filter types
    selector: string // CSS selector to find the element
    condition: (element: cheerio.Cheerio<AnyNode>) => boolean // function that returns true if element passes the filter
}

// Spieler ohne Alternativen
export const ALTERNATIVES_FILTER: DomFilter = {
    type: 'visibility',
    selector: '.sub_child',
    condition: (element: cheerio.Cheerio<AnyNode>) => {
        const displayStyle = element.css('display')
        return displayStyle === 'block'
    },
}

// Spieler ohne Pfeil (no arrow indicator)
export const PFEIL_FILTER: DomFilter = {
    type: 'Pfeil',
    selector: 'div.player_name',
    condition: (element: cheerio.Cheerio<AnyNode>) => {
        // Find the parent sub_child div
        const parentSubChild = element.closest('.sub_child')

        // If there's no parent sub_child, keep the player
        if (parentSubChild.length === 0) return true

        // Find .player_no elements within the parent that contain .next_sub
        const playerNoWithNextSub = parentSubChild.find('.player_no .next_sub')

        // Return true (keep player) if no next_sub is found
        return playerNoWithNextSub.length === 0
    },
}

export const FILTER_MAP = {
    ALTERNATIVES: ALTERNATIVES_FILTER,
    PFEIL: PFEIL_FILTER,
}

export type FilterName = keyof typeof FILTER_MAP

export class HtmlParser {
    private logger: Logger

    /**
     * First‑level cache → raw HTML (still needed so we don't hit the site again)
     */
    private htmlCache: Map<string, CacheEntry> = new Map()
    private htmlCacheDurationMs: number

    /**
     * Second‑level cache → parsed PlayerAvailabilityInfo keyed by
     * `${url}|${playerName}|${filterType}`
     */
    private statusCache: Map<string, StatusCacheEntry> = new Map()
    private statusCacheDurationMs: number

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
     * Build a unique key for status‑level cache entries.
     */
    private buildStatusCacheKey(
        url: string,
        playerName: string,
        domFilter?: DomFilter
    ): string {
        return `${url}|${playerName.toLowerCase()}|${domFilter?.type ?? 'none'}`
    }

    /**
     * Fetch HTML content from URL, using first‑level cache if available.
     */
    public async fetchHtml(url: string): Promise<string | null> {
        const now = Date.now()
        const cachedEntry = this.htmlCache.get(url)

        if (cachedEntry) {
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
            }
        } else {
            this.logger.info(
                `HTML cache miss for URL: ${url} (not in cache, current cache size: ${this.htmlCache.size})`
            )
        }

        this.logger.info(`Fetching fresh HTML from URL: ${url}`)
        try {
            const fetchStartTime = performance.now()
            const htmlContent = await httpClient.get<string>(
                url,
                undefined,
                'text'
            )
            const fetchEndTime = performance.now()
            const fetchDuration = fetchEndTime - fetchStartTime

            if (!htmlContent) {
                throw new Error('Empty response received')
            }

            this.logger.info(
                `Network fetch took ${fetchDuration.toFixed(
                    2
                )}ms for URL: ${url} (HTML length: ${htmlContent.length})`
            )

            // Store in first‑level cache
            this.htmlCache.set(url, { content: htmlContent, timestamp: now })
            this.logger.info(
                `Cached raw HTML for URL: ${url} (cache size now: ${this.htmlCache.size})`
            )

            return htmlContent
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error)
            this.logger.error(`Error fetching HTML: ${errorMessage}`)
            return null
        }
    }

    /**
     * Compute the PlayerAvailabilityInfo for one <div class="player_name"> element.
     */
    private computeStatus(
        $: cheerio.CheerioAPI,
        playerDiv: cheerio.Cheerio<AnyNode>
    ): PlayerAvailabilityInfo {
        const parentSection = playerDiv.closest('section')
        if (
            parentSection.length &&
            /Verletzt|Angeschlagen|Gesperrt|fehlen/.test(parentSection.text())
        ) {
            return {
                isLikelyToPlay: false,
                reason: 'Verletzung oder Sperre',
                lastChecked: new Date(),
            }
        }

        return {
            isLikelyToPlay: true,
            lastChecked: new Date(),
        }
    }

    /**
     * Parse the whole HTML once and build an index of playerName → status.
     * Also populates the status‑level cache so subsequent look‑ups are O(1).
     */
    private buildPlayerStatusIndex(
        url: string,
        html: string,
        domFilter?: DomFilter
    ): Map<string, PlayerAvailabilityInfo> {
        const now = Date.now()

        const $ = cheerio.load(html)

        const playerNameDivs = $('div.player_name').filter(function () {
            if (!domFilter) return true
            const parentElement = $(this).closest(domFilter.selector)
            if (parentElement.length === 0) return true
            return domFilter.condition(parentElement)
        })

        const statusMap = new Map<string, PlayerAvailabilityInfo>()

        playerNameDivs.each((_, div) => {
            const playerDiv = $(div)
            const name = playerDiv.text().trim().toLowerCase()
            const status = this.computeStatus($, playerDiv)
            statusMap.set(name, status)

            // Persist to second‑level cache
            const cacheKey = this.buildStatusCacheKey(url, name, domFilter)
            this.statusCache.set(cacheKey, { info: status, timestamp: now })
        })

        return statusMap
    }

    /**
     * Public API: fetch & parse a player's status with two‑level caching.
     *
     * 1. Try status‑level cache → constant‑time.
     * 2. Else try HTML cache → parse once, build index, fill cache → next calls O(1).
     */
    public async fetchAndParsePlayerStatus(
        teamUrl: string,
        playerName: string,
        domFilter?: DomFilter
    ): Promise<PlayerAvailabilityInfo | null> {
        const now = Date.now()
        const cacheKey = this.buildStatusCacheKey(
            teamUrl,
            playerName,
            domFilter
        )

        this.logger.debug(
            `Looking up status for player: ${playerName} with filter: ${
                domFilter?.type ?? 'none'
            }`
        )
        this.logger.debug(`Status cache key: ${cacheKey}`)

        // 1) Second‑level cache lookup
        const cachedStatus = this.statusCache.get(cacheKey)
        if (cachedStatus) {
            const ageMs = now - cachedStatus.timestamp
            const expiresInMs = this.statusCacheDurationMs - ageMs

            if (ageMs < this.statusCacheDurationMs) {
                this.logger.info(
                    `Status cache hit for ${playerName} (filter: ${
                        domFilter?.type ?? 'none'
                    }, age: ${Math.round(ageMs / 1000)}s, expires in: ${Math.round(
                        expiresInMs / 1000
                    )}s)`
                )
                return cachedStatus.info
            } else {
                this.logger.info(
                    `Status cache expired for ${playerName} (filter: ${
                        domFilter?.type ?? 'none'
                    }, age: ${Math.round(ageMs / 1000)}s, expired ${Math.round(
                        -expiresInMs / 1000
                    )}s ago)`
                )
            }
        } else {
            this.logger.info(
                `Status cache miss for ${playerName} (filter: ${
                    domFilter?.type ?? 'none'
                }, key: ${cacheKey}, current cache size: ${this.statusCache.size})`
            )
        }

        // 2) Need to parse (may come from first‑level HTML cache)
        const htmlStartTime = performance.now()
        const html = await this.fetchHtml(teamUrl)
        const htmlEndTime = performance.now()

        if (!html) {
            this.logger.error(`Failed to fetch HTML content for ${playerName}`)
            return null
        }

        this.logger.debug(
            `fetchHtml took ${(htmlEndTime - htmlStartTime).toFixed(
                2
            )}ms for ${playerName}`
        )

        // Build index and fill cache
        const indexStartTime = performance.now()
        const statusMap = this.buildPlayerStatusIndex(teamUrl, html, domFilter)
        const indexEndTime = performance.now()

        this.logger.debug(
            `buildPlayerStatusIndex took ${(
                indexEndTime - indexStartTime
            ).toFixed(2)}ms, found ${statusMap.size} players`
        )
        this.logger.debug(
            `Player index contains: [${Array.from(statusMap.keys()).join(', ')}]`
        )

        // Return requested player's status or default "not found"
        const playerNameLower = playerName.toLowerCase()
        const status = statusMap.get(playerNameLower)

        if (status) {
            this.logger.info(`Found player ${playerName} in parsed index`)
            return status
        }

        this.logger.warning(
            `Player ${playerName} (lowercase: "${playerNameLower}") not found in player index with filter: ${
                domFilter?.type ?? 'none'
            }`
        )

        const defaultInfo: PlayerAvailabilityInfo = {
            isLikelyToPlay: false,
            reason: 'Nicht im Kader',
            lastChecked: new Date(),
        }

        // Also cache the negative result to avoid re‑parsing shortly after
        this.statusCache.set(cacheKey, { info: defaultInfo, timestamp: now })
        this.logger.info(
            `Cached negative result for ${playerName} (filter: ${
                domFilter?.type ?? 'none'
            })`
        )

        return defaultInfo
    }
}
