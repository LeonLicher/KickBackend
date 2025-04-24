import { Logger } from '../../model/logger'
import { PlayerAvailabilityInfo } from '../../model/player'
import { CacheService } from './CacheService'
import { DomFilterService } from './DomFilterService'
import { HtmlService } from './HtmlService'
import { PlayerStatusParser } from './PlayerStatusParser'
import { DomFilter, FILTER_MAP, FilterName } from './types'

/**
 * Main facade for the HTML parsing module
 * This class maintains the old interface while delegating to the new specialized services
 */
export class HtmlParser {
    private logger: Logger
    private cacheService: CacheService
    private htmlService: HtmlService
    private domFilterService: DomFilterService
    private playerStatusParser: PlayerStatusParser

    constructor(
        logger: Logger,
        htmlCacheDurationMinutes: number = 10,
        statusCacheDurationMinutes: number = 5
    ) {
        this.logger = logger

        // Initialize services
        this.cacheService = new CacheService(
            logger,
            htmlCacheDurationMinutes,
            statusCacheDurationMinutes
        )
        this.domFilterService = new DomFilterService()
        this.htmlService = new HtmlService(logger, this.cacheService)
        this.playerStatusParser = new PlayerStatusParser(
            logger,
            this.domFilterService,
            this.cacheService
        )
    }

    /**
     * Fetch HTML content from URL, using cache if available
     */
    public async fetchHtml(url: string): Promise<string | null> {
        return this.htmlService.fetchHtml(url)
    }

    /**
     * Parse HTML to check player availability
     */
    public async parsePlayerStatus(
        html: string,
        playerName: string,
        domFilter?: DomFilter
    ): Promise<PlayerAvailabilityInfo | null> {
        return this.playerStatusParser.parsePlayerStatus(
            html,
            playerName,
            domFilter
        )
    }

    /**
     * Pre-processes an entire team page, extracting all player statuses and caching them
     */
    public async preparsePlayers(
        teamUrl: string,
        html: string,
        domFilters: DomFilter[] = Object.values(FILTER_MAP)
    ): Promise<number> {
        return this.playerStatusParser.preparsePlayers(
            teamUrl,
            html,
            domFilters
        )
    }

    /**
     * Public API: fetch & parse a player's status with two-level caching
     */
    public async fetchAndParsePlayerStatus(
        teamUrl: string,
        playerName: string,
        domFilter?: DomFilter
    ): Promise<PlayerAvailabilityInfo | null> {
        // Check cache first
        const cachedStatus = this.cacheService.getPlayerStatusFromCache(
            teamUrl,
            playerName,
            domFilter,
            true // Always return stale data if available
        )

        if (cachedStatus) {
            return cachedStatus
        }

        // Status not found in cache - return not playing status
        return {
            isLikelyToPlay: false,
            reason: 'Information not pre-cached or player not found for filter',
            lastChecked: new Date(),
        }
    }
}

// Re-export types and constants for backward compatibility
export { GESETZT_FILTER, STARTELF_FILTER } from './types'
export { DomFilter, FILTER_MAP, FilterName }
