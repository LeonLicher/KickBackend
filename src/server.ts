import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import { addDoc, collection, Timestamp } from 'firebase/firestore'
import { db } from './config/firebase'
import HttpClient from './httpClient'
import {
    categorizePlayer,
    findAlternativePlayers,
} from './model/categorizePlayers'
import logger from './model/logger'
import { Player } from './model/player'
import { FILTER_MAP, FilterName, HtmlParser } from './services/HtmlParser'
import { logAuth } from './services/firebase'
import { AuthLog } from './types/AuthLogs'
import { DetailedPlayersResponse } from './types/DetailedPlayers'
import teamMapping from './utils/teamMapping'

dotenv.config()

const app = express()
const port = process.env.PORT || 3001
export const httpClient = new HttpClient('')

// Create a singleton HTML parser with extended cache durations
// 1 hour for HTML cache, 30 minutes for status cache
export const globalHtmlParser = new HtmlParser(logger, 60, 30)

app.use(
    cors({
        origin: ['http://localhost:5173', 'https://leonlicher.github.io'],
        credentials: true,
    })
)
app.use(express.json())

// Create routers
const apiRouter = express.Router()
const publicRouter = express.Router()

interface CheckAvailabilityRequest {
    player: {
        firstName: string
        teamId: string
    }
    filterName?: FilterName // Changed from filter to filterName
}

interface CheckTeamAvailabilityRequest {
    players: {
        id: string
        firstName: string
        teamId: string
    }[]
    filterName?: FilterName
}

// Public data handler
publicRouter.post('/data', async (req, res) => {
    try {
        const data = req.body

        // Basic validation
        if (!data || typeof data !== 'object') {
            res.status(400).json({ error: 'Invalid data format' })
            return
        }

        // Size validation
        if (JSON.stringify(data).length > 1000) {
            res.status(400).json({ error: 'Data too large' })
            return
        }

        // Add timestamp
        const docData = {
            ...data,
            timestamp: Timestamp.now(),
        }

        // Save to Firestore
        const docRef = await addDoc(collection(db, 'public_data'), docData)

        res.json({
            success: true,
            id: docRef.id,
        })
    } catch (error) {
        console.error('Error saving public data:', error)
        res.status(500).json({ error: 'Failed to save data' })
    }
})

// Auth log handler
apiRouter.post('/log', async (req, res) => {
    try {
        console.log('Received auth log data:', req.body)

        // Basic validation
        if (!req.body || typeof req.body !== 'object') {
            res.status(400).json({ error: 'Invalid data format' })
            return
        }

        // Required fields validation
        const requiredFields = ['deviceInfo', 'action'] as const
        if (!requiredFields.every((field) => req.body[field])) {
            res.status(400).json({
                error: 'Missing required fields',
                required: requiredFields,
            })
            return
        }

        const logData: AuthLog = {
            ...req.body,
            userId: req.body.userId || 'anonymous',
            userName: req.body.userName || 'Anonymous User',
            timestamp: new Date(),
            success: req.body.success ?? true,
        }

        const success = await logAuth(logData)
        console.log('Auth log created with ID:', success)
        res.json({ success })
    } catch (error) {
        console.error('Error logging authentication:', error)
        res.status(500).json({ error: 'Failed to log authentication' })
    }
})

// Player availability check
apiRouter.post('/check-availability', async (req, res) => {
    try {
        const { player, filterName }: CheckAvailabilityRequest = req.body
        const filter = filterName ? FILTER_MAP[filterName] : undefined

        if (!player || !player.firstName || !player.teamId) {
            return res.status(400).json({
                error: 'Player data incomplete. Required: firstName, teamId',
            })
        }

        // Use the singleton HTML parser
        const teamUrl = teamMapping.getTeamUrl(player.teamId, player.firstName)
        const playerStatus = await globalHtmlParser.fetchAndParsePlayerStatus(
            teamUrl,
            player.firstName,
            filter
        )

        if (playerStatus) {
            logger.info(
                `Player ${player.firstName} found on page: ${playerStatus.isLikelyToPlay}`
            )
            return res.json(playerStatus)
        } else {
            logger.warning(
                `Player ${player.firstName} not found or error parsing page`
            )
            return res.json({
                isLikelyToPlay: false,
                reason: 'Could not parse player information',
                lastChecked: new Date(),
            })
        }
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error)
        logger.error(`Error processing availability check: ${errorMessage}`)
        return res.status(500).json({
            error: 'Server error processing availability check',
            isLikelyToPlay: false,
            lastChecked: new Date(),
        })
    }
})

// Team availability check
apiRouter.post('/check-team-availability', async (req, res) => {
    try {
        const startTime = performance.now()
        const timings: Record<string, number> = {}

        const { players, filterName }: CheckTeamAvailabilityRequest = req.body
        const filter = filterName ? FILTER_MAP[filterName] : undefined

        if (!players || !Array.isArray(players) || players.length === 0) {
            return res
                .status(400)
                .json({ error: 'Players data is required as an array' })
        }

        logger.info(`Checking availability for ${players.length} players`)

        const availabilityMap: Record<string, any> = {}
        const unavailablePlayers: string[] = []

        // No longer need to initialize a new parser - use the singleton
        timings.parserInitialization = 0

        // Store promise completion times for each player
        const playerTimings: Record<
            string,
            {
                total: number
                url?: number
                fetchHtml?: number
                parse?: number
                cacheHit?: boolean
            }
        > = {}

        // Check each player in parallel
        const processStartTime = performance.now()
        const checks = players.map(async (player: Player) => {
            const playerStartTime = performance.now()
            const playerTiming = {
                total: 0,
                url: 0,
                fetchHtml: 0,
                parse: 0,
                cacheHit: false,
            }

            try {
                // Generate team URL
                const urlStartTime = performance.now()
                const teamUrl = teamMapping.getTeamUrl(
                    player.teamId,
                    player.firstName
                )
                playerTiming.url = performance.now() - urlStartTime

                // Use the global HtmlParser
                const fetchStartTime = performance.now()
                const playerStatus =
                    await globalHtmlParser.fetchAndParsePlayerStatus(
                        teamUrl,
                        player.firstName,
                        filter
                    )
                const fetchEndTime = performance.now()
                playerTiming.fetchHtml = fetchEndTime - fetchStartTime

                // Check if it was a cache hit by looking at the timing
                playerTiming.cacheHit = playerTiming.fetchHtml < 50 // Likely a cache hit if under 50ms

                if (!playerStatus) {
                    logger.warning(
                        `Player ${player.firstName} not found or error parsing page`
                    )
                    unavailablePlayers.push(player.firstName)
                    availabilityMap[player.id] = {
                        isLikelyToPlay: false,
                        reason: 'Could not parse player information',
                        lastChecked: new Date(),
                    }
                    return
                }

                // Check if player should be removed from starting eleven
                if (
                    !playerStatus.isLikelyToPlay ||
                    playerStatus.reason === 'Nicht im Kader' ||
                    playerStatus.reason === 'Nicht im Kader gefunden'
                ) {
                    unavailablePlayers.push(player.firstName)
                    logger.warning(
                        `Player ${player.firstName} not found on team site or unavailable - REMOVE FROM STARTING ELEVEN`
                    )
                }

                availabilityMap[player.id] = playerStatus
                logger.info(
                    `Player ${player.firstName}: isLikelyToPlay=${playerStatus.isLikelyToPlay}`
                )
            } catch (error) {
                const errorMessage =
                    error instanceof Error ? error.message : String(error)
                logger.error(
                    `Error checking ${player.firstName}:`,
                    errorMessage
                )
                // Set default on error
                availabilityMap[player.id] = {
                    isLikelyToPlay: false,
                    reason: `Error: ${errorMessage}`,
                    lastChecked: new Date(),
                }
            } finally {
                playerTiming.total = performance.now() - playerStartTime
                playerTimings[player.firstName] = playerTiming
            }
        })

        await Promise.all(checks)
        timings.playersProcessing = performance.now() - processStartTime

        if (unavailablePlayers.length > 0) {
            logger.warning(
                `Players to remove from starting eleven: ${unavailablePlayers.join(
                    ', '
                )}`
            )
        }

        const endTime = performance.now()
        const totalProcessingTime = endTime - startTime

        // Calculate stats about player processing
        const playerTimingValues = Object.values(playerTimings)
        const avgPlayerTime =
            playerTimingValues.reduce((acc, curr) => acc + curr.total, 0) /
            playerTimingValues.length
        const maxPlayerTime = Math.max(
            ...playerTimingValues.map((t) => t.total)
        )
        const slowestPlayer =
            Object.entries(playerTimings).find(
                ([_, timing]) => timing.total === maxPlayerTime
            )?.[0] || 'unknown'
        const cacheHits = playerTimingValues.filter((t) => t.cacheHit).length

        timings.total = totalProcessingTime

        logger.info(
            `Team availability check completed in ${totalProcessingTime.toFixed(
                2
            )}ms for ${players.length} players`
        )
        logger.info(
            `Performance: Avg=${avgPlayerTime.toFixed(
                2
            )}ms, Max=${maxPlayerTime.toFixed(
                2
            )}ms (${slowestPlayer}), Cache hits: ${cacheHits}/${players.length}`
        )
        logger.info(`Timing breakdown: ${JSON.stringify(timings)}`)

        // Find the slowest players for debugging
        const slowPlayers = Object.entries(playerTimings)
            .sort(([_, a], [__, b]) => b.total - a.total)
            .slice(0, 3)
            .map(([name, timing]) => ({
                name,
                total: timing.total.toFixed(2),
                fetchHtml: timing.fetchHtml
                    ? timing.fetchHtml.toFixed(2)
                    : 'n/a',
                cacheHit: timing.cacheHit,
            }))
        logger.info(`Slowest players: ${JSON.stringify(slowPlayers)}`)

        return res.json({
            availabilityMap,
            unavailablePlayers,
            _debug: {
                processingTimeMs: totalProcessingTime,
                timings,
                playerStats: {
                    avg: avgPlayerTime,
                    max: maxPlayerTime,
                    slowestPlayer,
                    cacheHits,
                    slowPlayers,
                },
            },
        })
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error)
        logger.error('Error processing team availability check:', errorMessage)
        return res
            .status(500)
            .json({ error: 'Server error processing team availability check' })
    }
})

// Team analysis handler
apiRouter.post('/analysis/team', async (req, res) => {
    console.log('Received request to analyze team')
    try {
        const players = req.body.players

        const detailedPlayersRaw = await import(
            './public/detailed_players.json'
        )
        const response =
            detailedPlayersRaw.default as unknown as DetailedPlayersResponse
        const detailedPlayers = Object.values(response.players)

        const analyzedPlayers = players.map((player: any) => {
            const detailedPlayer = detailedPlayers.find(
                (p) => p.i === player.id
            )
            if (!detailedPlayer) return null

            const score = categorizePlayer(detailedPlayer, detailedPlayers)
            const alternatives = findAlternativePlayers(
                detailedPlayer,
                detailedPlayers
            )

            return {
                id: player.id,
                analysis: {
                    score,
                    alternatives,
                },
            }
        })

        res.json({ players: analyzedPlayers })
    } catch (error) {
        console.error('Error analyzing team:', error)
        res.status(500).json({ error: 'Failed to analyze team' })
    }
})

// Cache management endpoint
apiRouter.post('/refresh-team-cache', async (req, res) => {
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
apiRouter.get('/cache-status', (req, res) => {
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

// Add routers to app
app.use('/public', publicRouter)
app.use('/api', apiRouter)

// Preload common team pages to warm up the cache
async function preloadCommonTeams() {
    logger.info('Preloading common team pages...')

    // Common team IDs in the Bundesliga (Bayern, Dortmund, Leipzig, etc.)
    const commonTeamIds = [
        '2',
        '3',
        '4',
        '7',
        '5',
        '9',
        '10',
        '11',
        '12',
        '14',
        '15',
        '18',
        '39',
        '13',
        '24',
        '40',
        '43',
        '51',
        '50',
    ]

    try {
        await Promise.all(
            commonTeamIds.map(async (teamId) => {
                const teamUrl = teamMapping.getTeamUrl(teamId, '')
                logger.info(`Preloading team ID ${teamId} from URL: ${teamUrl}`)
                const html = await globalHtmlParser.fetchHtml(teamUrl)

                if (html) {
                    // Parse all players on the page and cache them
                    const playerCount = await globalHtmlParser.preparsePlayers(
                        teamUrl,
                        html
                    )

                    logger.info(
                        `Successfully preloaded team ID ${teamId}, HTML length: ${html.length}, cached ${playerCount} player statuses`
                    )
                } else {
                    logger.error(`Failed to preload team ID ${teamId}`)
                }
            })
        )
        logger.info('Team preloading complete!')
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error)
        logger.error(`Error during team preloading: ${errorMessage}`)
    }
}

// Start server
app.listen(port, () => {
    console.log(`Server running on port ${port}`)

    // Warm up the cache after server starts
    setTimeout(() => {
        preloadCommonTeams()

        // Set up periodic cache refresh (every 30 minutes)
        setInterval(
            () => {
                logger.info('Running scheduled cache refresh...')
                preloadCommonTeams()
            },
            30 * 60 * 1000
        )
    }, 5000) // Wait 5 seconds after startup to avoid initial load
})
