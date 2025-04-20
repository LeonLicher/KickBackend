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
    type: 'STARTELF' | 'GESETZT' // extensible for future filter types
    selector: string // CSS selector to find the element
    condition: (element: cheerio.Cheerio<AnyNode>) => boolean // function that returns true if element passes the filter
}

// Spieler ohne Alternativen
export const STARTELF_FILTER: DomFilter = {
    type: 'STARTELF',
    selector: '.sub_child',
    condition: (element: cheerio.Cheerio<AnyNode>) => {
        const displayStyle = element.css('display')
        return displayStyle === 'block'
    },
}

// Spieler ohne Pfeil (no arrow indicator)
export const GESETZT_FILTER: DomFilter = {
    type: 'GESETZT',
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
    GESETZT: GESETZT_FILTER,
    STARTELF: STARTELF_FILTER,
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
            `Looking up status for player: ${playerName} with filter: ${domFilter?.type ?? 'none'} (Cache Key: ${cacheKey})`
        )

        // 1) Check the status cache - this is the ONLY source during requests
        const cachedStatus = this.statusCache.get(cacheKey)

        if (cachedStatus) {
            const ageMs = now - cachedStatus.timestamp

            // Check if cache entry is expired
            if (ageMs >= this.statusCacheDurationMs) {
                // Cache entry exists but is expired - Return stale data as requested
                this.logger.warning(
                    `Status cache expired for ${playerName} (filter: ${domFilter?.type ?? 'none'}, age: ${Math.round(ageMs / 1000)}s). Returning stale data.`
                )
                // Return the stale information
                return cachedStatus.info
            } else {
                // Cache entry exists and is valid
                this.logger.info(
                    `Status cache hit for ${playerName} (filter: ${domFilter?.type ?? 'none'}, age: ${Math.round(ageMs / 1000)}s)`
                )
                return cachedStatus.info
            }
        } else {
            // Status not found in cache - this indicates a potential issue with preloading or the player simply isn't on the page/doesn't match the filter.
            // Return the specific "not playing" status as requested.
            this.logger.warning(
                // Changed to warning as it might be expected if player doesn't exist for filter
                `Status cache MISS for ${playerName} (filter: ${domFilter?.type ?? 'none'}, key: ${cacheKey}). Player might not exist, not match filter, or preloading failed.`
            )
            return {
                isLikelyToPlay: false,
                reason: 'Information not pre-cached or player not found for filter',
                lastChecked: new Date(), // Use current time as we determined the status now
            }
        }
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

                const playerDiv = $(div)

                // *** New Check: Ensure player is within the stadium container ***
                const stadiumContainer = playerDiv.closest(
                    'div.stadium_container_bg'
                )
                if (stadiumContainer.length === 0) {
                    this.logger.debug(
                        `Skipping player ${playerDiv.text().trim()} because they are not inside div.stadium_container_bg`
                    )
                    return // Skip this player entirely
                }
                // *** End New Check ***

                const playerText = playerDiv.text().trim()
                const playerName = playerText.toLowerCase()

                if (!playerName) return

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

            // Define all filters to consider, including 'undefined' for the no-filter case
            const allFiltersToCache: (DomFilter | undefined)[] = [
                ...domFilters,
                undefined,
            ]

            // Process each player
            playerNameDivs.each((_, div) => {
                const playerDiv = $(div)

                // *** New Check: Ensure player is within the stadium container ***
                const stadiumContainer = playerDiv.closest(
                    'div.stadium_container_bg'
                )
                if (stadiumContainer.length === 0) {
                    this.logger.debug(
                        `Skipping player ${playerDiv.text().trim()} -> Bank gewesen`
                    )
                    return // Skip this player entirely
                }
                // *** End New Check ***

                const playerText = playerDiv.text().trim()
                const playerName = playerText.toLowerCase()

                if (!playerName) return

                // For each player, process with each filter type (including no filter)
                allFiltersToCache.forEach((currentFilter) => {
                    // Check if the player div itself meets the filter condition (if a filter is applied)
                    if (currentFilter) {
                        const parentElement = playerDiv.closest(
                            currentFilter.selector
                        )
                        if (
                            parentElement.length === 0 ||
                            !currentFilter.condition(parentElement)
                        ) {
                            // If the player element does not match the filter criteria, skip caching for this filter combination
                            // We still need to cache the 'no filter' case below.
                            return
                        }
                    }

                    // Check player availability (injured/suspended status)
                    let playerStatus: PlayerAvailabilityInfo
                    const parentSection = playerDiv.closest('section')
                    if (
                        parentSection.length &&
                        /Verletzt|Angeschlagen|Gesperrt|fehlen/i.test(
                            parentSection.text()
                        )
                    ) {
                        playerStatus = {
                            isLikelyToPlay: false,
                            reason: 'Verletzung oder Sperre',
                            lastChecked: new Date(now),
                        }
                    } else {
                        playerStatus = {
                            isLikelyToPlay: true,
                            lastChecked: new Date(now),
                        }
                    }

                    // Store in cache using the specific filter (or undefined for no filter)
                    const cacheKey = this.buildStatusCacheKey(
                        teamUrl,
                        playerName,
                        currentFilter // Pass the specific filter or undefined
                    )
                    this.statusCache.set(cacheKey, {
                        info: playerStatus,
                        timestamp: now,
                    })

                    // Log the cached status
                    this.logger.debug(
                        `Caching status for ${playerName} [${currentFilter?.type ?? 'no filter'}]: ` +
                            `isLikelyToPlay=${playerStatus.isLikelyToPlay}` +
                            `${playerStatus.reason ? ', reason=' + playerStatus.reason : ''} (Key: ${cacheKey})`
                    )

                    parsedCount++
                })
            })

            this.logger.info(
                `Preparsed and cached ${parsedCount} player status entries (incl. filter variations) from team URL: ${teamUrl}`
            )
            return parsedCount
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error)
            this.logger.error(`Error preparsing players: ${errorMessage}`)
            return 0
        }
    }
}
