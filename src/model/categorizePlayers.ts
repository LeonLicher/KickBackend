import fs from 'fs/promises';
import path from 'path';
import { DetailedPlayer, DetailedPlayersResponse } from '../types/DetailedPlayers';

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

function assignPercentileGroup(score: number): string {
  if (score >= 90) return 'BigBoy';
  if (score >= 80) return 'Mittelklasse BigBoy';
  if (score >= 65) return 'Mittelklasse';
  if (score >= 70) return 'Mittel';
  if (score >= 65) return 'Durschnitt';
  if (score >= 60) return 'Ergänzung';
  return 'Bankwärmer';
}

interface AlternativePlayer {
  id: string;
  name: string;
  tp: number;
  ap: number;
  mv: number;
  difference: number;
}

function findAlternativePlayers(player: DetailedPlayer, allPlayers: DetailedPlayer[]): AlternativePlayer[] {
  // Skip if player doesn't have market value, tp, or ap
  if (!player.mv || !player.tp || !player.ap) {
    return [];
  }

  return allPlayers
    .filter((p): p is DetailedPlayer & { mv: number; tp: number; ap: number; fn: string; ln: string } => 
      // Type guard to ensure all required properties exist
      !!p.mv && !!p.tp && !!p.ap && !!p.fn && !!p.ln &&
      // Must be cheaper
      p.mv < player.mv &&
      // Must perform better (using non-null assertion since we checked above)
      p.tp > player.tp! &&
      p.ap > player.ap! &&
      // Must not be the same player
      p.i !== player.i
    )
    .map(p => ({
      id: p.i,
      name: p.ln,
      tp: p.tp,
      ap: p.ap,
      mv: p.mv,
      difference: player.mv - p.mv
    }))
    .sort((a, b) => {
      // Since we checked for tp and ap in the filter above, we can safely assert they exist in player
      const playerScore = (player.tp! + player.ap!);
      return ((b.tp + b.ap) - playerScore) - ((a.tp + a.ap) - playerScore);
    })
    .slice(0, 10);
}

async function analyzeTeam() {
  try {
    const playersData = await fetchPlayers();
    const players = Object.values(playersData);
    
    return players.map(player => {
      const score = categorizePlayer(player, players);
      // Only pass player to findAlternativePlayers if it has required properties
      const alternatives = player.tp && player.ap && player.mv ? 
        findAlternativePlayers(player as Required<DetailedPlayer>, players) : [];
      
      return {
        id: player.i,
        name: `${player.fn} ${player.ln}`,
        score,
        group: assignPercentileGroup(score),
        alternatives
      };
    });
  } catch (error) {
    console.error('Error analyzing team:', error);
    throw error;
  }
}

async function updatePlayersWithGroups() {
  try {
    // Read the file
    const filePath = path.join(process.cwd(), 'src', 'public', 'detailed_players.json');
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(fileContent) as DetailedPlayersResponse;
    
    // Get all players for score calculation context
    const allPlayers = Object.values(data.players);
    
    // Update each player with their group
    for (const player of allPlayers) {
      const score = categorizePlayer(player, allPlayers);
      player.group = assignPercentileGroup(score);
    }
    
    // Write back to file
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
    console.log('Successfully updated players with groups');
    
  } catch (error) {
    console.error('Error updating players with groups:', error);
    throw error;
  }
}

export { analyzeTeam, assignPercentileGroup, categorizePlayer, findAlternativePlayers, updatePlayersWithGroups };

