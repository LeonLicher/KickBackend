import logger from "../model/logger";
import { TeamIdMapping, TeamInfo, TeamUrlMapping } from "../model/team";

/**
 * Reference table of teams with their ligainsider URLs and IDs
 */
const TEAM_INFO: TeamInfo = {
  "fc-bayern-muenchen": "1",
  "sv-werder-bremen": "2",
  "eintracht-frankfurt": "3",
  "bayer-04-leverkusen": "4",
  "borussia-moenchengladbach": "5",
  "vfb-stuttgart": "12",
  "borussia-dortmund": "14",
  "vfl-bochum": "11",
  "tsg-hoffenheim": "10",
  "vfl-wolfsburg": "16",
  "1-fsv-mainz-05": "17",
  "sc-freiburg": "18",
  "fc-st-pauli": "20",
  "fc-augsburg": "21",
  "1-fc-union-berlin": "1246",
  "rb-leipzig": "1311",
  "ksv-holstein": "1295", // Holstein Kiel
  "1-fc-heidenheim": "1259",
};

/**
 * Map of team IDs in our app to their ligainsider URL paths
 */
const teamUrls: TeamUrlMapping = {
  "2": "fc-bayern-muenchen",
  "3": "borussia-dortmund",
  "4" : "eintracht-frankfurt",
  "7": "bayer-04-leverkusen",
  "5": "sc-freiburg",
  "9": "vfb-stuttgart",
  "10": "sv-werder-bremen",
  "11": "vfl-wolfsburg",
  "12": "vfb-stuttgart",
  "14": "tsg-hoffenheim",
  "15": "borussia-moenchengladbach",
  "18": "1-fsv-mainz-05",
  "39": "fc-st-pauli",
  "13": "fc-augsburg",
  "24": "vfl-bochum",
  "40": "1-fc-union-berlin",
  "43": "rb-leipzig",
  "51": "ksv-holstein",
  "50": "1-fc-heidenheim",
};
// fix pfeil 
/**
 * Generate ligainsider team IDs mapping
 */
const ligainsiderTeamIds: TeamIdMapping = {};
Object.keys(teamUrls).forEach((teamId) => {
  const teamSlug = teamUrls[teamId];
  ligainsiderTeamIds[teamId] = TEAM_INFO[teamSlug];
});

/**
 * Get team URL based on ID
 */
function getTeamUrl(teamId: string, playerName?: string): string {
  const teamPath = teamUrls[teamId];
  const ligainsiderId = ligainsiderTeamIds[teamId];
  const link = `https://www.ligainsider.de/${teamPath}/${ligainsiderId}/`;

  logger.info(
    `Generated team URL: ${link} for team ID: ${teamId} (ligainsider ID: ${ligainsiderId})${
      playerName ? ", player: " + playerName : ""
    }`
  );

  return link;
}

/**
 * Add a new team mapping
 */
function addTeamMapping(
  teamId: string,
  path: string,
  ligainsiderId?: string
): void {
  teamUrls[teamId] = path;
  if (ligainsiderId) {
    ligainsiderTeamIds[teamId] = ligainsiderId;
  }
  logger.info(
    `Added team mapping for ID ${teamId}: path=${path}, ligainsiderId=${
      ligainsiderId || teamId
    }`
  );
}

export default {
  getTeamUrl,
  addTeamMapping,
  TEAM_INFO,
  teamUrls,
  ligainsiderTeamIds,
};
