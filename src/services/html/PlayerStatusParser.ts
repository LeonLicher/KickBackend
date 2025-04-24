import * as cheerio from 'cheerio'
import { Logger } from '../../model/logger'
import { PlayerAvailabilityInfo } from '../../model/player'
import { CacheService } from './CacheService'
import { DomFilterService } from './DomFilterService'
import { getMappedPlayerName } from './playerNameDiffMapping'
import { DomFilter } from './types'

/**
 * Service for parsing player status from HTML content
 */
export class PlayerStatusParser {
    private logger: Logger
    private domFilterService: DomFilterService
    private cacheService: CacheService

    constructor(
        logger: Logger,
        domFilterService: DomFilterService,
        cacheService: CacheService
    ) {
        this.logger = logger
        this.domFilterService = domFilterService
        this.cacheService = cacheService
    }

    /**
     * Creates a player availability info object
     */
    private createPlayerStatus(
        isAvailable: boolean,
        reason?: string,
        timestamp: number = Date.now()
    ): PlayerAvailabilityInfo {
        return {
            isLikelyToPlay: isAvailable,
            reason: reason,
            lastChecked: new Date(timestamp),
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
            const mappedName = getMappedPlayerName(playerName)

            // Log with mapping info if applicable
            if (mappedName !== playerName) {
                this.logger.info(
                    `Parsing HTML content to find status for ${playerName} (mapped to: ${mappedName})`
                )
            } else {
                this.logger.info(
                    `Parsing HTML content to find status for ${playerName}`
                )
            }

            // Quick check if player name exists in the document
            const htmlLower = html.toLowerCase()
            const searchNames = [playerName.toLowerCase()]

            // If player has a mapping, also search for that name
            if (mappedName.toLowerCase() !== playerName.toLowerCase()) {
                searchNames.push(mappedName.toLowerCase())
            }

            const foundInHtml = searchNames.some((name) =>
                htmlLower.includes(name)
            )

            if (!foundInHtml) {
                this.logger.warning(
                    `Player ${playerName} not found in HTML content (quick check)`
                )
                return this.createPlayerStatus(false, 'Nicht im Kader')
            }

            // Load the HTML into cheerio
            const $ = cheerio.load(html)

            // Find player_name divs that match our filter
            const playerNameDivs = $('div.player_name').filter((_, elem) => {
                const playerDiv = $(elem)

                // Check if player is in stadium container
                if (
                    !this.domFilterService.isPlayerInStadiumContainer(
                        $,
                        playerDiv
                    )
                ) {
                    return false
                }

                // Apply filter if provided
                return this.domFilterService.doesPlayerMatchFilter(
                    $,
                    playerDiv,
                    domFilter
                )
            })

            this.logger.info(
                `Found ${playerNameDivs.length} player_name divs (filter: ${domFilter?.type ?? 'none'})`
            )

            let result: PlayerAvailabilityInfo | null = null

            playerNameDivs.each((_, div) => {
                if (result) return // Skip if already found

                const playerDiv = $(div)
                const playerText = playerDiv.text().trim()
                const divPlayerName = playerText.toLowerCase()

                if (!divPlayerName) return

                // Check if this div contains either our original player name or the mapped name
                const nameMatches = searchNames.some(
                    (name) =>
                        divPlayerName.includes(name) ||
                        name.includes(divPlayerName)
                )

                if (!nameMatches) return

                // Player name matched, check if injured or suspended
                if (
                    this.domFilterService.isPlayerInjuredOrSuspended(
                        $,
                        playerDiv
                    )
                ) {
                    result = this.createPlayerStatus(
                        false,
                        'Verletzung oder Sperre'
                    )
                    return false
                }

                result = this.createPlayerStatus(true)
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
            return this.createPlayerStatus(false, 'Nicht im Kader')
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error)
            this.logger.error(`Error parsing player status: ${errorMessage}`)

            // Return a default response even on error
            return this.createPlayerStatus(false, `Error: ${errorMessage}`)
        }
    }

    /**
     * Pre-processes an entire team page, extracting all player statuses and caching them
     */
    public async preparsePlayers(
        teamUrl: string,
        html: string,
        domFilters: DomFilter[] = []
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

                // Skip players not in the stadium container
                if (
                    !this.domFilterService.isPlayerInStadiumContainer(
                        $,
                        playerDiv
                    )
                ) {
                    this.logger.debug(
                        `Skipping player ${playerDiv.text().trim()} -> Bank gewesen`
                    )
                    return // Skip this player entirely
                }

                const playerText = playerDiv.text().trim()
                const playerName = playerText.toLowerCase()

                if (!playerName) return

                // For each player, process with each filter type (including no filter)
                allFiltersToCache.forEach((currentFilter) => {
                    // Check if the player div itself meets the filter condition (if a filter is applied)
                    if (
                        currentFilter &&
                        !this.domFilterService.doesPlayerMatchFilter(
                            $,
                            playerDiv,
                            currentFilter
                        )
                    ) {
                        // If the player element does not match the filter criteria, skip caching for this filter combination
                        return
                    }

                    // Determine player status based on injury/suspension
                    let playerStatus: PlayerAvailabilityInfo
                    if (
                        this.domFilterService.isPlayerInjuredOrSuspended(
                            $,
                            playerDiv
                        )
                    ) {
                        playerStatus = this.createPlayerStatus(
                            false,
                            'Verletzung oder Sperre',
                            now
                        )
                    } else {
                        playerStatus = this.createPlayerStatus(
                            true,
                            undefined,
                            now
                        )
                    }

                    // Cache player status - will use player name mapping internally
                    this.cacheService.cachePlayerStatus(
                        teamUrl,
                        playerName,
                        playerStatus,
                        currentFilter,
                        now
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
