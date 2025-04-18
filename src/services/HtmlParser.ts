import * as cheerio from "cheerio";
import { AnyNode } from "domhandler";
import { Logger } from "../model/logger";
import { PlayerAvailabilityInfo } from "../model/player";
import { httpClient } from "../server";

interface HttpResponse {
  status: number;
  data: string;
}

interface CacheEntry {
  content: string;
  timestamp: number;
}

export interface DomFilter {
  type: "visibility" | string; // extensible for future filter types
  selector: string; // CSS selector to find the element
  condition: (element: cheerio.Cheerio<AnyNode>) => boolean; // function that returns true if element passes the filter
}

// Spieler ohne Alternativen
export const ALTERNATIVES_FILTER: DomFilter = {
  type: "visibility",
  selector: ".sub_child",
  condition: (element: cheerio.Cheerio<AnyNode>) => {
    const displayStyle = element.css("display");
    return displayStyle === "block";
  },
};

// Spieler ohne Pfeil (no arrow indicator)
export const PFEIL_FILTER: DomFilter = {
  type: "Pfeil",
  selector: "div.player_name",
  condition: (element: cheerio.Cheerio<AnyNode>) => {
    // Find the parent sub_child div
    const parentSubChild = element.closest(".sub_child");

    // If there's no parent sub_child, keep the player
    if (parentSubChild.length === 0) return true;

    // Find .player_no elements within the parent that contain .next_sub
    const playerNoWithNextSub = parentSubChild.find(".player_no .next_sub");

    // Return true (keep player) if no next_sub is found
    return playerNoWithNextSub.length === 0;
  },
};

export const FILTER_MAP = {
  ALTERNATIVES: ALTERNATIVES_FILTER,
  PFEIL: PFEIL_FILTER,
};

export type FilterName = keyof typeof FILTER_MAP;

export class HtmlParser {
  private logger: Logger;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheDurationMs: number;

  constructor(logger: Logger, cacheDurationMinutes: number = 10) {
    this.logger = logger;
    this.cacheDurationMs = cacheDurationMinutes * 60 * 1000;
  }

  /**
   * Fetch HTML content from URL, using cache if available
   */
  public async fetchHtml(url: string): Promise<string | null> {
    const now = Date.now();
    const cachedEntry = this.cache.get(url);

    if (cachedEntry && now - cachedEntry.timestamp < this.cacheDurationMs) {
      this.logger.info(`Cache hit for URL: ${url}`);
      return cachedEntry.content;
    }

    this.logger.info(`Cache miss or expired for URL: ${url}. Fetching...`);
    try {
      const htmlContent = await httpClient.get<string>(url, undefined, "text");

      if (!htmlContent) {
        throw new Error("Empty response received");
      }

      this.logger.debug(`Received HTML length: ${htmlContent.length}`);
      // Store in cache
      this.cache.set(url, { content: htmlContent, timestamp: now });
      this.logger.info(`Cached content for URL: ${url}`);

      return htmlContent;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error fetching HTML: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Parse HTML to check player availability
   */
  public async parsePlayerStatus(
    html: string,
    playerName: string,
    domFilter?: DomFilter
  ): Promise<PlayerAvailabilityInfo | null> {
    try {
      this.logger.info(`Parsing HTML content to find status for ${playerName}`);
      const $ = cheerio.load(html);

      // First look specifically for the player_name div structure
      const playerNameDivs = $("div.player_name").filter(function () {
        if (!domFilter) return true; // If no filter specified, include all elements
        const parentElement = $(this).closest(domFilter.selector);
        if (parentElement.length === 0) return true; // Include if target parent doesn't exist
        return domFilter.condition(parentElement);
      });

      console.log("🚀 ~ HtmlParser ~ domFilter:", JSON.stringify(domFilter));
      this.logger.info(
        `Found ${playerNameDivs.length} matching player_name divs (filter: ${
          domFilter?.type || "none"
        })`
      );

      let playerFound = false;
      let result: PlayerAvailabilityInfo | null = null;

      playerNameDivs.each((_, div) => {
        if (result) return; // Skip if we already found a result

        const playerText = $(div).text().trim();

        if (playerText.toLowerCase().includes(playerName.toLowerCase())) {
          playerFound = true;
          this.logger.info(
            `Found matching player in player_name div: ${playerName}`
          );

          // Check if player is in an injury section
          const parentSection = $(div).closest("section");
          if (
            parentSection.length &&
            (parentSection.text().includes("Verletzt") ||
              parentSection.text().includes("Angeschlagen") ||
              parentSection.text().includes("Gesperrt") ||
              parentSection.text().includes("fehlen"))
          ) {
            result = {
              isLikelyToPlay: false,
              reason: "Verletzung oder Sperre",
              lastChecked: new Date(),
            };
            return false; // Break each loop
          }

          result = {
            isLikelyToPlay: true,
            lastChecked: new Date(),
          };
          return false; // Break each loop
        }
      });
      if (result) return result;

      // If player was not found in the lineup or images
      this.logger.warning(`Player ${playerName} not found in HTML content`);
      return {
        isLikelyToPlay: false,
        reason: "Nicht im Kader",
        lastChecked: new Date(),
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Error parsing player status: ${errorMessage}`);
      return null;
    }
  }

  /**
   * Fetch and parse player status from a team URL
   */
  public async fetchAndParsePlayerStatus(
    teamUrl: string,
    playerName: string,
    domFilter?: DomFilter
  ): Promise<PlayerAvailabilityInfo | null> {
    console.log("🚀 ~ HtmlParser ~ domFilter:", domFilter);
    try {
      const html = await this.fetchHtml(teamUrl);

      if (!html) {
        this.logger.error(`Failed to fetch HTML content for ${playerName}`);
        return null;
      }

      return this.parsePlayerStatus(html, playerName, domFilter);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Error fetching and parsing player status: ${errorMessage}`
      );
      return null;
    }
  }
}
