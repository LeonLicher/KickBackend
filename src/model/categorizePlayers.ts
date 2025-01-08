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
  // Skip if player doesn't have required stats
  if (!player.tp || !player.ap || !player.pos) {
    return [];
  }

  const playerPerformance = player.tp + player.ap;

  return allPlayers
    .filter((p): p is DetailedPlayer & { tp: number; ap: number; fn: string; ln: string; pos: string } => 
      // Type guard to ensure all required properties exist
      !!p.tp && !!p.ap && !!p.fn && !!p.ln && !!p.pos &&
      // Must be same position
      p.pos === player.pos &&
      // Must not be the same player
      p.i !== player.i
    )
    .map(p => {
      const performanceDiff = Math.abs((p.tp + p.ap) - playerPerformance);
      return {
        id: p.i,
        name: p.ln,
        tp: p.tp,
        ap: p.ap,
        mv: p.mv || 0,
        difference: performanceDiff
      };
    })
    .sort((a, b) => a.difference - b.difference) // Sort by smallest performance difference
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
        name: player.ln,
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

