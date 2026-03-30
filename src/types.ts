export type Stage =
  | 'setup'
  | 'group_stage'
  | 'knockout'
  | 'final'
  | 'completed'

export type SeedingMode = 'ovr_snake' | 'random' | 'manual'

export type Tiebreaker = 'points' | 'gd' | 'gf' | 'head_to_head'

export interface Player {
  id: string
  name: string
  ovr: number
  groupId: string | null
  joinedLate: boolean
}

export interface Group {
  id: string
  name: string
  playerIds: string[]
}

export interface Fixture {
  id: string
  groupId: string
  homeId: string
  awayId: string
  homeGoals: number | null
  awayGoals: number | null
  completed: boolean
}

export interface StandingRow {
  playerId: string
  p: number
  w: number
  d: number
  l: number
  gf: number
  ga: number
  gd: number
  points: number
}

export interface TieMatch {
  homeGoals: number | null
  awayGoals: number | null
  completed: boolean
}

export interface DeciderMatch extends TieMatch {
  homeId: string | null
}

export interface KnockoutTie {
  id: string
  roundIndex: number
  slotIndex: number
  playerAId: string | null
  playerBId: string | null
  leg1: TieMatch
  leg2: TieMatch
  coinTossWinnerId: string | null
  decider: DeciderMatch
  winnerId: string | null
}

export interface KnockoutRound {
  id: string
  name: string
  ties: KnockoutTie[]
}

export interface FinalGame {
  id: string
  winnerId: string | null
  void: boolean
}

export interface FinalSeries {
  player1Id: string | null
  player2Id: string | null
  games: FinalGame[]
  championId: string | null
}

export interface KnockoutState {
  enabled: boolean
  rounds: KnockoutRound[]
  groupStageGoalDiff: Record<string, number>
  finalSeries: FinalSeries | null
}

export interface TournamentSettings {
  tournamentName: string
  groupSize: 4 | 5 | 6 | 8
  qualifiersPerGroup: number
  seedingMode: SeedingMode
  tiebreakers: Tiebreaker[]
  adminPassword: string
}

export interface TournamentState {
  players: Player[]
  groups: Group[]
  fixtures: Fixture[]
  knockout: KnockoutState
  settings: TournamentSettings
  stage: Stage
  groupsLocked: boolean
  championId: string | null
}

export interface TournamentContextType {
  state: TournamentState
  resetTournament: () => void
  resetKnockout: () => void
  setAdminPassword: (password: string) => void
  setSettings: (settings: Partial<TournamentSettings>) => void
  importState: (incoming: TournamentState) => void
  exportState: () => TournamentState
  addPlayer: (name: string, ovr: number, joinedLate?: boolean) => Player
  updatePlayer: (id: string, name: string, ovr: number) => void
  removePlayer: (id: string) => void
  clearAllPlayers: () => void
  bulkAddPlayers: (players: Array<{ name: string; ovr: number }>) => void
  generateGroups: () => void
  movePlayerToGroup: (playerId: string, targetGroupId: string) => void
  lockGroups: () => void
  addLatePlayerToSuggestedGroup: (name: string, ovr: number) => string | null
  setFixtureScore: (fixtureId: string, homeGoals: number, awayGoals: number) => void
  clearFixtureScore: (fixtureId: string) => void
  generateKnockout: () => void
  setTieLegScore: (
    roundIndex: number,
    tieId: string,
    leg: 'leg1' | 'leg2' | 'decider',
    homeGoals: number,
    awayGoals: number,
  ) => void
  clearTieLegScore: (
    roundIndex: number,
    tieId: string,
    leg: 'leg1' | 'leg2' | 'decider',
  ) => void
  coinTossTie: (roundIndex: number, tieId: string) => void
  setFinalGameResult: (gameId: string, winnerId: string | null, isVoid: boolean) => void
  clearFinalGameResult: (gameId: string) => void
}
