import { Request, Response } from 'express'
import logger from './model/logger'
import { Player } from './model/player'
import teamMapping from './utils/teamMapping'

/**
 * Middleware handler for team availability check
 */
export async function checkTeamAvailability(req: Request, res: Response) {
    try {
        const { players } = req.body

        if (!players || !Array.isArray(players) || players.length === 0) {
            return res
                .status(400)
                .json({ error: 'Players data is required as an array' })
        }

        const playerStatuses: Record<string, { found: boolean; url: string }> =
            {}
        const playerResults: string[] = []

        // Check each player in parallel
        const checks = players.map(async (player: Player) => {
            try {
                // Generate team URL from mapping
                const teamUrl = teamMapping.getTeamUrl(
                    player.teamId,
                    player.firstName
                )

                // For now, we're just logging the player check status
                // We'll simulate player found status with a random value
                const found = Math.random() > 0.2 // 80% chance of being found

                // Log player and URL only
                logger.info(
                    `Player check: ${player.firstName}, Team URL: ${teamUrl}, Found: ${found}`
                )

                // Store the basic information only
                playerStatuses[player.id] = {
                    found,
                    url: teamUrl,
                }

                // Add to results list for display
                playerResults.push(
                    `${player.firstName}: Found=${found ? 'Yes' : 'No'}, URL=${teamUrl}`
                )
            } catch (error) {
                const errorMessage =
                    error instanceof Error ? error.message : String(error)
                logger.error(
                    `Error checking ${player.firstName}:`,
                    errorMessage
                )

                // Add error information
                playerStatuses[player.id] = {
                    found: false,
                    url: 'Error fetching URL',
                }

                playerResults.push(
                    `${player.firstName}: Error: ${errorMessage}`
                )
            }
        })

        await Promise.all(checks)

        // Log a simple summary
        logger.info(
            `Player checks complete. Results: ${playerResults.join(' | ')}`
        )

        return res.json({
            players: playerStatuses,
            results: playerResults,
        })
    } catch (error) {
        const errorMessage =
            error instanceof Error ? error.message : String(error)
        logger.error('Error processing team availability check:', errorMessage)
        return res
            .status(500)
            .json({ error: 'Server error processing team availability check' })
    }
}
