import express from 'express'
import logger from '../model/logger'
import { Player } from '../model/player'
import { globalHtmlParser } from '../server'
import { FILTER_MAP, FilterName } from '../services/HtmlParser'
import teamMapping from '../utils/teamMapping'

const router = express.Router()

interface CheckAvailabilityRequest {
    player: {
        firstName: string
        teamId: string
    }
    filterName?: FilterName
}

interface CheckTeamAvailabilityRequest {
    players: {
        id: string
        firstName: string
        teamId: string
    }[]
    filterName?: FilterName
}

// Player availability check
router.post('/check-availability', async (req, res) => {
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
router.post('/check-team-availability', async (req, res) => {
    try {
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

        // Check each player in parallel
        const checks = players.map(async (player: Player) => {
            try {
                // Generate team URL
                const teamUrl = teamMapping.getTeamUrl(
                    player.teamId,
                    player.firstName
                )

                // Use the global HtmlParser
                const playerStatus =
                    await globalHtmlParser.fetchAndParsePlayerStatus(
                        teamUrl,
                        player.firstName,
                        filter
                    )

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
            }
        })

        await Promise.all(checks)

        if (unavailablePlayers.length > 0) {
            logger.warning(
                `Players to remove from starting eleven: ${unavailablePlayers.join(
                    ', '
                )}`
            )
        }

        logger.info(
            `Team availability check completed for ${players.length} players`
        )

        return res.json({
            availabilityMap,
            unavailablePlayers,
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

export default router
