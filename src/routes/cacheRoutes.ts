import express from 'express'
import logger from '../model/logger'
import { globalHtmlParser } from '../server'
import teamMapping from '../utils/teamMapping'

const router = express.Router()

// Cache management endpoint for refreshing a team's cache
router.post('/refresh-team-cache', async (req, res) => {
    try {
        const { teamId } = req.body

        if (!teamId) {
            return res.status(400).json({ error: 'Team ID is required' })
        }

        logger.info(`Manual cache refresh requested for team ID: ${teamId}`)

        // Get team URL
        const teamUrl = teamMapping.getTeamUrl(teamId, '')

        // Refresh the cache
        const playerCount = await globalHtmlParser.refreshTeamCache(teamUrl)

        return res.json({
            success: true,
            teamId,
            teamUrl,
            refreshedPlayers: playerCount,
            timestamp: new Date(),
        })
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error)
        logger.error(`Error refreshing team cache: ${errorMessage}`)
        return res.status(500).json({
            error: 'Server error refreshing team cache',
            details: errorMessage,
        })
    }
})

// Cache status endpoint for monitoring
router.get('/status', (req, res) => {
    try {
        // Get cache statistics from the HtmlParser
        const htmlCacheSize = globalHtmlParser.getHtmlCacheSize()
        const statusCacheSize = globalHtmlParser.getStatusCacheSize()
        const htmlCacheKeys = globalHtmlParser.getHtmlCacheKeys()

        // Return cache status information
        return res.json({
            success: true,
            htmlCache: {
                size: htmlCacheSize,
                keys: htmlCacheKeys,
            },
            statusCache: {
                size: statusCacheSize,
            },
            timestamp: new Date(),
        })
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error)
        logger.error(`Error getting cache status: ${errorMessage}`)
        return res.status(500).json({
            error: 'Server error getting cache status',
            details: errorMessage,
        })
    }
})

export default router
