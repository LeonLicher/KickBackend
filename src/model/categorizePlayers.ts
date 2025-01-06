import { DetailedPlayer } from '../types/DetailedPlayers';

async function fetchPlayers(): Promise<{ [key: string]: DetailedPlayer }> {
  try {
    const response = await fetch('/detailed_players.json');
    const data = await response.json();
    return data.players;
  } catch (error) {
    console.error('Error fetching players:', error);
    throw error;
  }
}

function categorizePlayer(player: Partial<DetailedPlayer>, allPlayers: DetailedPlayer[]): number {
  // Filter out players without tp or ap
  const validPlayers = allPlayers.filter(p => p.tp && p.ap);
  
  // Find highest values
  const maxTp = Math.max(...validPlayers.map(p => p.tp!));
  const maxAp = Math.max(...validPlayers.map(p => p.ap!));

  // Calculate relative performance (as percentage of max)
  const tpPercentage = ((player.tp || 0) / maxTp) * 300;
  const apPercentage = ((player.ap || 0) / maxAp) * 100;

  // Average of both percentages
  const score = (tpPercentage + apPercentage) / 4;

  const cappedScore = Math.min(100, Math.max(0, Math.round(score*10)/10))
  const boostedScore = cappedScore + ((100 - cappedScore) / 1.7)

  // Ensure score is between 0 and 100
  return Math.min(100, Math.round(boostedScore * 10) / 10);
}

async function analyzeTeam() {
  try {
    const playersData = await fetchPlayers();
    const players = Object.values(playersData);
    
    return players.map(player => ({
      id: player.i,
      name: `${player.fn} ${player.ln}`,
      score: categorizePlayer(player, players)
    }));
  } catch (error) {
    console.error('Error analyzing team:', error);
    throw error;
  }
}

export { analyzeTeam, categorizePlayer };

