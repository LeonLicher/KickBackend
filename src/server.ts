import cors from 'cors';
import express, { Router } from 'express';
import { getAuthLogs, logAuth } from './services/firebase';
import { AuthLog } from './types/AuthLogs';
import { categorizePlayer } from './model/categorizePlayers';
import dotenv from 'dotenv';
import { DetailedPlayer, DetailedPlayersResponse } from './types/DetailedPlayers';
dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'https://leonlicher.github.io'],
  credentials: true
}));
app.use(express.json());

// Create API router
const apiRouter = Router();


// Auth logging endpoint
apiRouter.post('/log', async (req, res) => {
  try {
    console.log('Received auth log data:', req.body);
    const logData: AuthLog = req.body;
    
    const success = await logAuth(logData);
    console.log('Auth log created with ID:', success);
    res.json({ success });
  } catch (error) {
    
    res.status(500).json({ error: 'Failed to log authentication' });
  }
});

// Get auth logs endpoint
apiRouter.get('/logs', async (req, res) => {
  console.log('Received request to fetch auth logs');
  try {
    const logs = await getAuthLogs();
    res.json(logs);
  } catch (error) {
    console.error('Error fetching auth logs:', error);
    res.status(500).json({ error: 'Failed to fetch auth logs' });
  }
});

apiRouter.post('/analysis/team', async (req, res) => {
  console.log('Received request to analyze team');
  try {
    const players = req.body.players;
    
    // Read the detailed players data
    const detailedPlayersRaw = await import('./public/detailed_players.json');
    const response = detailedPlayersRaw.default as unknown as DetailedPlayersResponse;
    const detailedPlayers = Object.values(response.players);

    const analyzedPlayers = players.map((player: any) => {
      // Convert the incoming player data to match DetailedPlayer interface
      const detailedPlayer: Partial<DetailedPlayer> = {
        i: player.id,
        tp: player.totalPoints || 0,
        ap: player.averagePoints || 0,
        st: player.status,
        pos: player.position
      };

      const score = categorizePlayer(detailedPlayer, detailedPlayers);

      let recommendation = '';
      if (score > 70) {
        recommendation = 'Keep - Strong performer';
      } else if (score > 40) {
        recommendation = 'Monitor - Average performer';
      } else {
        recommendation = 'Consider replacing - Underperforming';
      }

      return {
        id: player.id,
        analysis: {
          score: score,
          recommendation
        }
      };
    });

    res.json({ players: analyzedPlayers });
  } catch (error) {
    console.error('Error analyzing team:', error);
    res.status(500).json({ error: 'Failed to analyze team' });
  }
});


// Add router to app
app.use('/auth', apiRouter);

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
