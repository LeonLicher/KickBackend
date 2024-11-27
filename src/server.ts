import cors from 'cors';
import express, { Router } from 'express';
import { getAuthLogs, logAuth } from './services/firebase';
import { AuthLog } from './types/Authlogs';

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: ['http://localhost:5173', 'https://leonlicher.github.io/Kickbase/'],
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

// Add router to app
app.use('/auth', apiRouter);

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});