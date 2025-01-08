import cors from 'cors';
import dotenv from 'dotenv';
import express, { RequestHandler } from 'express';
import { addDoc, collection, Timestamp } from 'firebase/firestore';
import { db } from './config/firebase';
import { authenticateUser, AuthRequest } from './middleware/auth';
import { categorizePlayer, findAlternativePlayers } from './model/categorizePlayers';
import { getAuthLogs, logAuth } from './services/firebase';
import { AuthLog } from './types/AuthLogs';
import { DetailedPlayersResponse } from './types/DetailedPlayers';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors({
  origin: ['http://localhost:5173', 'https://leonlicher.github.io'],
  credentials: true
}));
app.use(express.json());


// Create routers
const apiRouter = express.Router();
const publicRouter = express.Router();

const handlePublicData: RequestHandler = async (req, res, next) => {
  try {
    const data = req.body;
    
    // Basic validation
    if (!data || typeof data !== 'object') {
      res.status(400).json({ error: 'Invalid data format' });
      return;
    }

    // Size validation
    if (JSON.stringify(data).length > 1000) {
      res.status(400).json({ error: 'Data too large' });
      return;
    }

    // Add timestamp
    const docData = {
      ...data,
      timestamp: Timestamp.now()
    };

    // Save to Firestore
    const docRef = await addDoc(collection(db, 'public_data'), docData);
    
    res.json({ 
      success: true, 
      id: docRef.id 
    });
  } catch (error) {
    console.error('Error saving public data:', error);
    res.status(500).json({ error: 'Failed to save data' });
  }
};

// interface LogRequestBody {
//   deviceInfo: Record<string, any>;
//   timestamp: Date;
//   action: 'login' | 'logout';
//   userId?: string;
//   userName?: string;
//   success?: boolean;
//   error?: string;
//   leagueId?: string;
// }

const handleLog = async (req:any, res:any) => {
  try {
    console.log('Received auth log data:', req.body);
    
    // Basic validation
    if (!req.body || typeof req.body !== 'object') {
      res.status(400).json({ error: 'Invalid data format' });
      return;
    }

    // Required fields validation
    const requiredFields = ['deviceInfo', 'action'] as const;
    if (!requiredFields.every(field => req.body[field])) {
      res.status(400).json({ 
        error: 'Missing required fields',
        required: requiredFields
      });
      return;
    }

    const logData: AuthLog = {
      ...req.body,
      userId: req.body.userId || 'anonymous',
      userName: req.body.userName || 'Anonymous User',
      timestamp: new Date(),
      success: req.body.success ?? true
    };
    
    const success = await logAuth(logData);
    console.log('Auth log created with ID:', success);
    res.json({ success });
  } catch (error) {
    console.error('Error logging authentication:', error);
    res.status(500).json({ error: 'Failed to log authentication' });
  }
};

// Register routes
publicRouter.post('/data', handlePublicData);
apiRouter.post('/log', handleLog);

apiRouter.get('/logs', authenticateUser, async (req: AuthRequest, res) => {
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
    
    const detailedPlayersRaw = await import('./public/detailed_players.json');
    const response = detailedPlayersRaw.default as unknown as DetailedPlayersResponse;
    const detailedPlayers = Object.values(response.players);

    const analyzedPlayers = players.map((player: any) => {
      const detailedPlayer = detailedPlayers.find(p => p.i === player.id);
      if (!detailedPlayer) return null;

      const score = categorizePlayer(detailedPlayer, detailedPlayers);
      const alternatives = findAlternativePlayers(detailedPlayer, detailedPlayers);
      
      return {
        id: player.id,
        analysis: {
          score,
          alternatives
        }
      };
    });

    res.json({ players: analyzedPlayers });
  } catch (error) {
    console.error('Error analyzing team:', error);
    res.status(500).json({ error: 'Failed to analyze team' });
  }
});

// Add routers to app
app.use('/public', publicRouter);
app.use('/auth', apiRouter);

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
