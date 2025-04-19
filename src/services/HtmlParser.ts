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
            `fetchHtml took ${(htmlEndTime - htmlStartTime).toFixed(2)}ms for ${playerName}`
        )

        // Use the new optimized parsing for individual player lookups
        const startTime = performance.now()
        const playerStatus = await this.parsePlayerStatus(
            html,
            playerName,
            domFilter
        )
        const endTime = performance.now()

        this.logger.debug(
            `Total parsing took ${(endTime - startTime).toFixed(2)}ms`
        )

        // Cache the result
        if (playerStatus) {
            this.statusCache.set(cacheKey, {
                info: playerStatus,
                timestamp: now,
            })
            this.logger.debug(`Cached status for ${playerName}`)
        }

        return playerStatus
    }

    /**
     * Parse HTML to check player availability
     */
    public async parsePlayerStatus(
        html: string,
        playerName: string,
        domFilter?: DomFilter
    ): Promise<PlayerAvailabilityInfo | null> {
        try {
            const startTime = performance.now()
            this.logger.info(
                `Parsing HTML content to find status for ${playerName}`
            )

            // Lowercase the player name once for efficiency
            const playerNameLower = playerName.toLowerCase()

            // Quick check if player name exists in the document at all
            if (!html.toLowerCase().includes(playerNameLower)) {
                this.logger.warning(
                    `Player ${playerName} not found in HTML content (quick check)`
                )
                return {
                    isLikelyToPlay: false,
                    reason: 'Nicht im Kader',
                    lastChecked: new Date(),
                }
            }

            // Load the HTML into cheerio
            const $ = cheerio.load(html)

            // Find player_name divs that match our filter
            const playerNameDivs = $('div.player_name').filter(function () {
                if (!domFilter) return true
                const parentElement = $(this).closest(domFilter.selector)
                if (parentElement.length === 0) return true
                return domFilter.condition(parentElement)
            })

            this.logger.info(
                `Found ${playerNameDivs.length} player_name divs (filter: ${domFilter?.type ?? 'none'})`
            )

            let result: PlayerAvailabilityInfo | null = null

            playerNameDivs.each((_, div) => {
                if (result) return // Skip if already found

                const playerText = $(div).text().trim()

                if (playerText.toLowerCase().includes(playerNameLower)) {
                    // Check if player is in an injury section
                    const parentSection = $(div).closest('section')
                    if (
                        parentSection.length &&
                        /Verletzt|Angeschlagen|Gesperrt|fehlen/i.test(
                            parentSection.text()
                        )
                    ) {
                        result = {
                            isLikelyToPlay: false,
                            reason: 'Verletzung oder Sperre',
                            lastChecked: new Date(),
                        }
                        return false
                    }

                    result = {
                        isLikelyToPlay: true,
                        lastChecked: new Date(),
                    }
                    return false
                }
            })

            if (result) {
                const endTime = performance.now()
                this.logger.info(
                    `Parsing completed in ${(endTime - startTime).toFixed(2)}ms`
                )
                return result
            }

            // Player not found
            this.logger.warning(
                `Player ${playerName} not found in HTML content`
            )
            return {
                isLikelyToPlay: false,
                reason: 'Nicht im Kader',
                lastChecked: new Date(),
            }
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error)
            this.logger.error(`Error parsing player status: ${errorMessage}`)

            // Return a default response even on error
            return {
                isLikelyToPlay: false,
                reason: `Error: ${errorMessage}`,
                lastChecked: new Date(),
            }
        }
    }

    /**
     * Pre-processes an entire team page, extracting all player statuses and caching them.
     * This is used during preloading to avoid any HTML parsing during actual requests.
     *
     * @param teamUrl The URL of the team page
     * @param html The HTML content of the team page
     * @param domFilters Optional array of filters to apply (defaults to all filters)
     * @returns The number of players that were successfully processed and cached
     */
    public async preparsePlayers(
        teamUrl: string,
        html: string,
        domFilters: DomFilter[] = Object.values(FILTER_MAP)
    ): Promise<number> {
        try {
            if (!html) {
                this.logger.error(
                    `Cannot parse empty HTML content from ${teamUrl}`
                )
                return 0
            }

            this.logger.info(`Preparsing players from team URL: ${teamUrl}`)
            const $ = cheerio.load(html)
            let parsedCount = 0
            const now = Date.now()

            // Find all player name divs
            const playerNameDivs = $('div.player_name')
            this.logger.info(
                `Found ${playerNameDivs.length} player names in team page`
            )

            // Process each player
            playerNameDivs.each((_, div) => {
                const playerText = $(div).text().trim()
                const playerName = playerText.toLowerCase()

                if (!playerName) return

                // For each player, process with each filter type
                // This allows us to cache all possible filter combinations
                domFilters.forEach((domFilter) => {
                    // Skip if filter doesn't match
                    const parentElement = $(div).closest(domFilter.selector)
                    if (
                        parentElement.length > 0 &&
                        !domFilter.condition(parentElement)
                    ) {
                        return
                    }

                    // Check player availability
                    let playerStatus: PlayerAvailabilityInfo

                    // Check if player is in an injury section
                    const parentSection = $(div).closest('section')
                    if (
                        parentSection.length &&
                        /Verletzt|Angeschlagen|Gesperrt|fehlen/i.test(
                            parentSection.text()
                        )
                    ) {
                        playerStatus = {
                            isLikelyToPlay: false,
                            reason: 'Verletzung oder Sperre',
                            lastChecked: new Date(),
                        }
                    } else {
                        playerStatus = {
                            isLikelyToPlay: true,
                            lastChecked: new Date(),
                        }
                    }

                    // Store in cache
                    const cacheKey = this.buildStatusCacheKey(
                        teamUrl,
                        playerName,
                        domFilter
                    )
                    this.statusCache.set(cacheKey, {
                        info: playerStatus,
                        timestamp: now,
                    })
                    parsedCount++
                })
            })

            this.logger.info(
                `Cached ${parsedCount} player statuses from team URL: ${teamUrl}`
            )
            return parsedCount
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error)
            this.logger.error(`Error preparsing players: ${errorMessage}`)
            return 0
        }
    }

    /**
     * Refresh the cache for a specific team URL.
     * This fetches the team page and parses all players, updating the cache.
     *
     * @param teamUrl The URL of the team page to refresh
     * @returns The number of players that were successfully processed and cached
     */
    public async refreshTeamCache(teamUrl: string): Promise<number> {
        try {
            this.logger.info(`Refreshing cache for team URL: ${teamUrl}`)

            // Fetch the team page
            const html = await this.fetchHtml(teamUrl)
            if (!html) {
                this.logger.error(`Failed to fetch HTML content for ${teamUrl}`)
                return 0
            }

            // Parse all players on the page
            const playerCount = await this.preparsePlayers(teamUrl, html)

            this.logger.info(
                `Successfully refreshed cache for ${teamUrl}, updated ${playerCount} player statuses`
            )
            return playerCount
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error)
            this.logger.error(`Error refreshing team cache: ${errorMessage}`)
            return 0
        }
    }

    /**
     * Get the current size of the HTML cache
     */
    public getHtmlCacheSize(): number {
        return this.htmlCache.size
    }

    /**
     * Get the current size of the status cache
     */
    public getStatusCacheSize(): number {
        return this.statusCache.size
    }

    /**
     * Get the keys of the HTML cache (typically team URLs)
     */
    public getHtmlCacheKeys(): string[] {
        return Array.from(this.htmlCache.keys())
    }
}
