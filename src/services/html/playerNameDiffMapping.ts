/**
 * Maps player names from source to target names for caching
 * Kickbase player name -> Ligainsider name
 */
export const PLAYER_NAME_MAPPING: Record<string, string> = {
    // Kickbase : Ligainsider
    'T. Horn': 'Horn',
    "Simons": 'Xavi',

    // Add additional player mappings as needed
}

/**
 * Gets the target name for caching if a mapping exists, otherwise returns the original name
 * @param playerName Original player name from Kickbase
 * @returns The mapped name to use for caching (Ligainsider name) or original if no mapping exists
 */
export function getMappedPlayerName(playerName: string): string {
    const lowercaseName = playerName.toLowerCase().trim()

    // Check for direct mapping
    for (const [source, target] of Object.entries(PLAYER_NAME_MAPPING)) {
        if (source.toLowerCase() === lowercaseName) {
            return target
        }
    }

    // No mapping found, return original
    return playerName
}

/**
 * Returns normalized player name or maps to canonical name if found in mapping
 * @param playerName Original player name
 * @returns Normalized or mapped player name
 */
export function normalizePlayerName(playerName: string): string {
    const normalized = playerName.toLowerCase().trim()
    return PLAYER_NAME_MAPPING[normalized] || normalized
}

/**
 * Checks if two player names should be considered the same
 * @param name1 First player name
 * @param name2 Second player name
 * @returns True if the names map to the same player
 */
export function isSamePlayer(name1: string, name2: string): boolean {
    const normalized1 = normalizePlayerName(name1)
    const normalized2 = normalizePlayerName(name2)

    return normalized1 === normalized2
}
