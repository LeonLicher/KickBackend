import * as cheerio from "cheerio";
import { AnyNode } from "domhandler";
import { Logger } from "../model/logger";
import { PlayerAvailabilityInfo } from "../model/player";
import { httpClient } from "../server";

interface HttpResponse {
  status: number;
  data: string;
}

export interface DomFilter {
  type: "visibility" | string; // extensible for future filter types
  selector: string; // CSS selector to find the element
  condition: (element: cheerio.Cheerio<AnyNode>) => boolean; // function that returns true if element passes the filter
}

export const ALTERNATIVES_FILTER: DomFilter = {
  type: "visibility",
  selector: ".sub_child",
  condition: (element: cheerio.Cheerio<AnyNode>) => {
    const displayStyle = element.css("display");
    return displayStyle === "block";
  },
};

export class HtmlParser {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Fetch HTML content from URL
   */
  public async fetchHtml(url: string): Promise<string | null> {
    try {
      this.logger.info(`Fetching HTML from: ${url}`);
      const htmlContent = await httpClient.get<string>(url, undefined, "text");

      if (!htmlContent) {
        throw new Error("Empty response received");
      }

      this.logger.debug(`Received HTML length: ${htmlContent.length}`);
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

      // Then try to find the player in the boost elements (lineup section)
      /*
      const boostElements = $('[class^="boost"]');
      this.logger.info(`Found ${boostElements.length} boost elements`);

      boostElements.each((_, element) => {
        if (result) return; // Skip if we already found a result

        const playerText = $(element).text().trim();

        if (playerText.toLowerCase().includes(playerName.toLowerCase())) {
          playerFound = true;
          this.logger.info(`Found matching player in lineup: ${playerName}`);

          // Check if there's injury info nearby
          const statusElement = $(element).closest(".stadium_container_bg")
            .length
            ? $(element).closest(".stadium_container_bg")
            : $(element).parent();

          if (statusElement.length) {
            const statusText = statusElement.text();
            const isInjured =
              statusText.includes("Verletzt") ||
              statusText.includes("Angeschlagen") ||
              statusText.includes("Gesperrt") ||
              statusText.includes("Trainingsrückstand");

            let reason = "";
            if (isInjured) {
              // Try to extract the reason if available
              const reasonMatch = statusText.match(
                /(?:Verletzt|Angeschlagen|Gesperrt|Trainingsrückstand):\s*(.+?)(?:\s|$)/
              );
              reason = reasonMatch ? reasonMatch[1] : statusText;
            }

            result = {
              isLikelyToPlay: !isInjured,
              reason: isInjured ? reason : undefined,
              lastChecked: new Date(),
            };
            return false; // Break each loop
          } else {
            result = {
              isLikelyToPlay: true,
              lastChecked: new Date(),
            };
            return false; // Break each loop
          }
        }
      });

      if (result) return result;

      // If not found in specific elements, try all img elements
      const imgElements = $("img");
      this.logger.info(`Found ${imgElements.length} img elements`);

      imgElements.each((_, img) => {
        if (result) return; // Skip if we already found a result

        const srcAttr = $(img).attr("src") || "";

        if (srcAttr.toLowerCase().includes(playerName.toLowerCase())) {
          playerFound = true;
          this.logger.info(
            `Found matching image for player: ${playerName} at URL: ${srcAttr}`
          );

          // If in "Gegen ... fehlen" section, player is injured
          const injurySection = $(img).closest("table").length
            ? $(img).closest("table")
            : $(img).closest("section");
          if (injurySection.length && injurySection.text().includes("fehlen")) {
            // Try to find the reason
            const reasonText = injurySection.text();
            const reasonRegex = new RegExp(
              `${playerName}.*?(Verletzt|Angeschlagen|Gesperrt|Trainingsrückstand).*?`,
              "i"
            );
            const reasonMatch = reasonText.match(reasonRegex);
            const reason = reasonMatch ? reasonMatch[0] : "Nicht im Kader";

            result = {
              isLikelyToPlay: false,
              reason: reason,
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
      */

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
