import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { addDoc, collection, Timestamp } from "firebase/firestore";
import { db } from "./config/firebase";
import HttpClient from "./httpClient";
import {
  categorizePlayer,
  findAlternativePlayers,
} from "./model/categorizePlayers";
import logger from "./model/logger";
import { FILTER_MAP, FilterName, HtmlParser } from "./services/HtmlParser";
import { logAuth } from "./services/firebase";
import { AuthLog } from "./types/AuthLogs";
import { DetailedPlayersResponse } from "./types/DetailedPlayers";
import teamMapping from "./utils/teamMapping";
import { Player } from "./model/player";

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;
export const httpClient = new HttpClient("");

app.use(
  cors({
    origin: ["http://localhost:5173", "https://leonlicher.github.io"],
    credentials: true,
  })
);
app.use(express.json());

// Create routers
const apiRouter = express.Router();
const publicRouter = express.Router();

interface CheckAvailabilityRequest {
  player: {
    firstName: string;
    teamId: string;
  };
  filterName?: FilterName; // Changed from filter to filterName
}

interface CheckTeamAvailabilityRequest {
  players: {
    id: string;
    firstName: string;
    teamId: string;
  }[];
  filterName?: FilterName;
}

// Public data handler
publicRouter.post("/data", async (req, res) => {
  try {
    const data = req.body;

    // Basic validation
    if (!data || typeof data !== "object") {
      res.status(400).json({ error: "Invalid data format" });
      return;
    }

    // Size validation
    if (JSON.stringify(data).length > 1000) {
      res.status(400).json({ error: "Data too large" });
      return;
    }

    // Add timestamp
    const docData = {
      ...data,
      timestamp: Timestamp.now(),
    };

    // Save to Firestore
    const docRef = await addDoc(collection(db, "public_data"), docData);

    res.json({
      success: true,
      id: docRef.id,
    });
  } catch (error) {
    console.error("Error saving public data:", error);
    res.status(500).json({ error: "Failed to save data" });
  }
});

// Auth log handler
apiRouter.post("/log", async (req, res) => {
  try {
    console.log("Received auth log data:", req.body);

    // Basic validation
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ error: "Invalid data format" });
      return;
    }

    // Required fields validation
    const requiredFields = ["deviceInfo", "action"] as const;
    if (!requiredFields.every((field) => req.body[field])) {
      res.status(400).json({
        error: "Missing required fields",
        required: requiredFields,
      });
      return;
    }

    const logData: AuthLog = {
      ...req.body,
      userId: req.body.userId || "anonymous",
      userName: req.body.userName || "Anonymous User",
      timestamp: new Date(),
      success: req.body.success ?? true,
    };

    const success = await logAuth(logData);
    console.log("Auth log created with ID:", success);
    res.json({ success });
  } catch (error) {
    console.error("Error logging authentication:", error);
    res.status(500).json({ error: "Failed to log authentication" });
  }
});

// Player availability check
apiRouter.post("/check-availability", async (req, res) => {
  try {
    const { player, filterName }: CheckAvailabilityRequest = req.body;
    const filter = filterName ? FILTER_MAP[filterName] : undefined;

    if (!player || !player.firstName || !player.teamId) {
      return res
        .status(400)
        .json({ error: "Player data incomplete. Required: firstName, teamId" });
    }

    // Use the HtmlParser to check player availability
    const htmlParser = new HtmlParser(logger);
    const teamUrl = teamMapping.getTeamUrl(player.teamId, player.firstName);
    const playerStatus = await htmlParser.fetchAndParsePlayerStatus(
      teamUrl,
      player.firstName,
      filter
    );

    if (playerStatus) {
      logger.info(
        `Player ${player.firstName} found on page: ${playerStatus.isLikelyToPlay}`
      );
      return res.json(playerStatus);
    } else {
      logger.warning(
        `Player ${player.firstName} not found or error parsing page`
      );
      return res.json({
        isLikelyToPlay: false,
        reason: "Could not parse player information",
        lastChecked: new Date(),
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error processing availability check: ${errorMessage}`);
    return res.status(500).json({
      error: "Server error processing availability check",
      isLikelyToPlay: false,
      lastChecked: new Date(),
    });
  }
});

// Team availability check
apiRouter.post("/check-team-availability", async (req, res) => {
  try {
    const { players, filterName }: CheckTeamAvailabilityRequest = req.body;
    const filter = filterName ? FILTER_MAP[filterName] : undefined;

    if (!players || !Array.isArray(players) || players.length === 0) {
      return res
        .status(400)
        .json({ error: "Players data is required as an array" });
    }

    logger.info(`Checking availability for ${players.length} players`);

    const availabilityMap: Record<string, any> = {};
    const unavailablePlayers: string[] = [];

    // Initialize HTML parser once for all players
    const htmlParser = new HtmlParser(logger);

    // Check each player in parallel
    const checks = players.map(async (player: Player) => {
      try {
        // Generate team URL
        const teamUrl = teamMapping.getTeamUrl(player.teamId, player.firstName);

        // Use the HtmlParser directly
        const playerStatus = await htmlParser.fetchAndParsePlayerStatus(
          teamUrl,
          player.firstName,
          filter
        );

        if (!playerStatus) {
          logger.warning(
            `Player ${player.firstName} not found or error parsing page`
          );
          unavailablePlayers.push(player.firstName);
          availabilityMap[player.id] = {
            isLikelyToPlay: false,
            reason: "Could not parse player information",
            lastChecked: new Date(),
          };
          return;
        }

        // Check if player should be removed from starting eleven
        if (
          !playerStatus.isLikelyToPlay ||
          playerStatus.reason === "Nicht im Kader" ||
          playerStatus.reason === "Nicht im Kader gefunden"
        ) {
          unavailablePlayers.push(player.firstName);
          logger.warning(
            `Player ${player.firstName} not found on team site or unavailable - REMOVE FROM STARTING ELEVEN`
          );
        }

        availabilityMap[player.id] = playerStatus;
        logger.info(
          `Player ${player.firstName}: isLikelyToPlay=${playerStatus.isLikelyToPlay}`
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error(`Error checking ${player.firstName}:`, errorMessage);
        // Set default on error
        availabilityMap[player.id] = {
          isLikelyToPlay: false,
          reason: `Error: ${errorMessage}`,
          lastChecked: new Date(),
        };
      }
    });

    await Promise.all(checks);

    if (unavailablePlayers.length > 0) {
      logger.warning(
        `Players to remove from starting eleven: ${unavailablePlayers.join(
          ", "
        )}`
      );
    }

    return res.json({
      availabilityMap,
      unavailablePlayers,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error processing team availability check:", errorMessage);
    return res
      .status(500)
      .json({ error: "Server error processing team availability check" });
  }
});

// Team analysis handler
apiRouter.post("/analysis/team", async (req, res) => {
  console.log("Received request to analyze team");
  try {
    const players = req.body.players;

    const detailedPlayersRaw = await import("./public/detailed_players.json");
    const response =
      detailedPlayersRaw.default as unknown as DetailedPlayersResponse;
    const detailedPlayers = Object.values(response.players);

    const analyzedPlayers = players.map((player: any) => {
      const detailedPlayer = detailedPlayers.find((p) => p.i === player.id);
      if (!detailedPlayer) return null;

      const score = categorizePlayer(detailedPlayer, detailedPlayers);
      const alternatives = findAlternativePlayers(
        detailedPlayer,
        detailedPlayers
      );

      return {
        id: player.id,
        analysis: {
          score,
          alternatives,
        },
      };
    });

    res.json({ players: analyzedPlayers });
  } catch (error) {
    console.error("Error analyzing team:", error);
    res.status(500).json({ error: "Failed to analyze team" });
  }
});

// Add routers to app
app.use("/public", publicRouter);
app.use("/api", apiRouter);

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
