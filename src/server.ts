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
import { HtmlParser } from './services/HtmlParser'
import { logAuth } from './services/firebase'
import { AuthLog } from './types/AuthLogs'
import { DetailedPlayersResponse } from './types/DetailedPlayers'
import teamMapping from './utils/teamMapping'

// Import the new route modules
import availabilityRoutes from './routes/availabilityRoutes'
import cacheRoutes from './routes/cacheRoutes'

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

publicRouter.use('/keepAlive', (req, res) => {
    res.json({ success: true })
})

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

// Register the modular routes
apiRouter.use('/', availabilityRoutes) //
apiRouter.use('/', cacheRoutes) //

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
    }, 0) // Wait 20 seconds after startup to avoid initial load
})
