/**
 * Player interface as received from client/frontend
 */
export interface Player {
  id: string;
  firstName: string;
  teamId: string;
  teamName?: string;
  averagePoints?: number;
}

/**
 * Player availability information
 */
export interface PlayerAvailabilityInfo {
  isLikelyToPlay: boolean;
  reason?: string;
  lastChecked: Date;
}

/**
 * Response for availability check API
 */
export interface AvailabilityResponse {
  availabilityMap: Record<string, PlayerAvailabilityInfo>;
  unavailablePlayers: string[];
}

/**
 * Error response
 */
export interface ErrorResponse {
  error: string;
  isLikelyToPlay?: boolean;
  lastChecked?: Date;
}
