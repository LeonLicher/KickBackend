import { Logger } from '../../model/logger'
import { httpClient } from '../../server'
import { CacheService } from './CacheService'

/**
 * Service for fetching HTML content with caching
 */
export class HtmlService {
    private logger: Logger
    private cacheService: CacheService

    constructor(logger: Logger, cacheService: CacheService) {
        this.logger = logger
        this.cacheService = cacheService
    }

    /**
     * Fetch HTML content from URL, using cache if available
     */
    public async fetchHtml(url: string): Promise<string | null> {
        // Try to get from cache first
        const cachedHtml = this.cacheService.getHtmlFromCache(url)
        if (cachedHtml) {
            return cachedHtml
        }

        // Not in cache or expired, fetch fresh
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

            // Store in cache
            this.cacheService.cacheHtml(url, htmlContent)

            return htmlContent
        } catch (error) {
            const errorMessage =
                error instanceof Error ? error.message : String(error)
            this.logger.error(`Error fetching HTML: ${errorMessage}`)
            return null
        }
    }
}
