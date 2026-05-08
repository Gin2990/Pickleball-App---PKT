/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Team {
  id: string;
  name: string;
  club?: string;
}

export interface Match {
  id: string;
  team1Id: string;
  team2Id: string;
  score1: number;
  score2: number;
  isCompleted: boolean;
  stage: 'group' | 'knockout';
  groupId?: string;
  round?: string; // e.g., 'SF', 'F'
  nextMatchId?: string;
}

export interface Group {
  id: string;
  name: string;
  teamIds: string[];
}

export interface TournamentConfig {
  format: 'round-robin' | 'group-stage-knockout';
  teamsPerGroup: number;
  advancingPerGroup: number;
  knockoutSize: 4 | 8 | 16;
  knockoutPairing: 'auto' | 'manual';
  manualSlots?: string[]; // e.g. ['1A', '2B', '1B', '2A', 'Lucky1', 'Lucky2']
}

export interface TournamentSummary {
  id: string;
  name: string;
  stage: 'setup' | 'group' | 'knockout' | 'finished';
  createdAt: any;
  ownerId?: string;
  organizerIds?: string[];
}

export interface TournamentState {
  teams: Team[];
  groups: Group[];
  matches: Match[];
  stage: 'setup' | 'group' | 'knockout' | 'finished';
  config: TournamentConfig;
  organizerIds?: string[];
}
