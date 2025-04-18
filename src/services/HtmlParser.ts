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
     * This is used by the index-building approach for bulk processing.
     */
    private indexParsePlayerStatus(
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
            const status = this.indexParsePlayerStatus($, playerDiv) // Changed function name here
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
     * Parse HTML to check player availability more efficiently by only loading relevant parts
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

            // First try to find a smaller section containing the player
            // Most player content is inside elements with these classes
            const targetSectionRegex = new RegExp(
                `<div\\s+class="(?:sub_child|player_position_photo|player_content)[^"]*"[^>]*>[\\s\\S]*?${playerNameLower}[\\s\\S]*?</div>`,
                'i'
            )

            const htmlLower = html.toLowerCase() // Convert once for faster case-insensitive search

            // Quick check if player name exists in the document at all
            if (!htmlLower.includes(playerNameLower)) {
                this.logger.warning(
                    `Player ${playerName} not found in HTML content (quick check)`
                )
                return {
                    isLikelyToPlay: false,
                    reason: 'Nicht im Kader',
                    lastChecked: new Date(),
                }
            }

            // Find relevant sections that might contain the player
            const matches = html.match(new RegExp(targetSectionRegex, 'gi'))

            if (!matches || matches.length === 0) {
                this.logger.warning(
                    `No sections containing ${playerName} found in HTML. Falling back to full parsing.`
                )
                // Fall back to full parsing as before
                return this.legacyParsePlayerStatus(html, playerName, domFilter)
            }

            // Combine matched sections into a smaller HTML document
            const reducedHtml = `<div id="reduced-content">${matches.join('')}</div>`
            this.logger.debug(
                `Reduced HTML size from ${html.length} to ${reducedHtml.length} characters`
            )

            // Load only the relevant parts into cheerio
            const $ = cheerio.load(reducedHtml)

            // Apply filters to player_name divs in the reduced HTML
            const playerNameDivs = $('div.player_name').filter(function () {
                if (!domFilter) return true
                const parentElement = $(this).closest(domFilter.selector)
                if (parentElement.length === 0) return true
                return domFilter.condition(parentElement)
            })

            this.logger.info(
                `Found ${playerNameDivs.length} matching player_name divs in reduced HTML (filter: ${domFilter?.type ?? 'none'})`
            )

            let result: PlayerAvailabilityInfo | null = null

            playerNameDivs.each((_, div) => {
                if (result) return // Skip if we already found a result

                const playerText = $(div).text().trim()

                if (playerText.toLowerCase().includes(playerNameLower)) {
                    // Found the player
                    this.logger.info(
                        `Found matching player in reduced HTML: ${playerName}`
                    )

                    // Check if player is in an injury section
                    const parentText = $(div).parent().text() || ''
                    if (
                        /Verletzt|Angeschlagen|Gesperrt|fehlen/i.test(
                            parentText
                        )
                    ) {
                        result = {
                            isLikelyToPlay: false,
                            reason: 'Verletzung oder Sperre',
                            lastChecked: new Date(),
                        }
                        return false // Break each loop
                    }

                    result = {
                        isLikelyToPlay: true,
                        lastChecked: new Date(),
                    }
                    return false // Break each loop
                }
            })

            if (result) {
                const endTime = performance.now()
                this.logger.info(
                    `Optimized parsing completed in ${(endTime - startTime).toFixed(2)}ms`
                )
                return result
            }

            // If optimized parsing didn't find the player, try legacy method
            this.logger.info(
                `Player not found in reduced HTML. Falling back to full parsing.`
            )
            return this.legacyParsePlayerStatus(html, playerName, domFilter)
        } catch (error) {
            this.logger.error(
                `Error in optimized parsing, falling back to legacy method`
            )
            return this.legacyParsePlayerStatus(html, playerName, domFilter)
        }
    }

    /**
     * Legacy full parsing method as backup
     */
    private legacyParsePlayerStatus(
        html: string,
        playerName: string,
        domFilter?: DomFilter
    ): PlayerAvailabilityInfo | null {
        try {
            const $ = cheerio.load(html)

            // First look specifically for the player_name div structure
            const playerNameDivs = $('div.player_name').filter(function () {
                if (!domFilter) return true
                const parentElement = $(this).closest(domFilter.selector)
                if (parentElement.length === 0) return true
                return domFilter.condition(parentElement)
            })

            this.logger.info(
                `Legacy parsing found ${playerNameDivs.length} player_name divs (filter: ${domFilter?.type ?? 'none'})`
            )

            const playerNameLower = playerName.toLowerCase()
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

            if (result) return result

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
            this.logger.error(`Error in legacy parsing: ${errorMessage}`)
            return null
        }
    }
}
