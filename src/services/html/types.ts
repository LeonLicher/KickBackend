import * as cheerio from 'cheerio'
import { AnyNode } from 'domhandler'
import { PlayerAvailabilityInfo } from '../../model/player'

export interface HtmlCacheEntry {
    content: string
    timestamp: number
}

export interface StatusCacheEntry {
    info: PlayerAvailabilityInfo
    timestamp: number
}

export interface DomFilter {
    type: 'STARTELF' | 'GESETZT' // extensible for future filter types
    selector: string // CSS selector to find the element
    condition: (element: cheerio.Cheerio<AnyNode>) => boolean // function that returns true if element passes the filter
}

// Filter constants
export const STARTELF_FILTER: DomFilter = {
    type: 'STARTELF',
    selector: '.sub_child',
    condition: (element: cheerio.Cheerio<AnyNode>) => {
        const displayStyle = element.css('display')
        return displayStyle === 'block'
    },
}

export const GESETZT_FILTER: DomFilter = {
    type: 'GESETZT',
    selector: 'div.player_name',
    condition: (element: cheerio.Cheerio<AnyNode>) => {
        // Find the parent sub_child div
        const parentSubChild = element.closest('.sub_child')

        // If there's no parent sub_child, keep the player
        if (parentSubChild.length === 0) return true

        // Find .player_no elements within the parent that contain .next_sub
        const playerNoWithNextSub = parentSubChild.find('.player_no .next_sub')

        // Return true (keep player) if no next_sub is found
        return playerNoWithNextSub.length === 0
    },
}

export const FILTER_MAP = {
    GESETZT: GESETZT_FILTER,
    STARTELF: STARTELF_FILTER,
}

export type FilterName = keyof typeof FILTER_MAP
