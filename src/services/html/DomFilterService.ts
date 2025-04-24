import * as cheerio from 'cheerio'
import { AnyNode } from 'domhandler'
import { DomFilter } from './types'

/**
 * Service for inspecting and filtering DOM elements
 */
export class DomFilterService {
    /**
     * Checks if a player element is inside the stadium container
     */
    public isPlayerInStadiumContainer(
        $: cheerio.CheerioAPI,
        playerElement: cheerio.Cheerio<AnyNode>
    ): boolean {
        const stadiumContainer = playerElement.closest(
            'div.stadium_container_bg'
        )
        return stadiumContainer.length > 0
    }

    /**
     * Checks if a player element matches the given filter
     */
    public doesPlayerMatchFilter(
        $: cheerio.CheerioAPI,
        playerElement: cheerio.Cheerio<AnyNode>,
        filter?: DomFilter
    ): boolean {
        if (!filter) return true

        const parentElement = playerElement.closest(filter.selector)
        if (parentElement.length === 0) return true

        return filter.condition(parentElement)
    }

    /**
     * Checks if a player is injured or suspended based on parent section text
     */
    public isPlayerInjuredOrSuspended(
        $: cheerio.CheerioAPI,
        playerElement: cheerio.Cheerio<AnyNode>
    ): boolean {
        const parentSection = playerElement.closest('section')
        return (
            parentSection.length > 0 &&
            /Verletzt|Angeschlagen|Gesperrt|fehlen/i.test(parentSection.text())
        )
    }
}
