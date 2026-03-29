import {
  type Fixture,
  type Group,
  type KnockoutRound,
  type KnockoutState,
  type KnockoutTie,
  type Player,
  type StandingRow,
  type TournamentState,
} from '../types'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export const createId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const defaultState = (): TournamentState => ({
  players: [],
  groups: [],
  fixtures: [],
  knockout: {
    enabled: false,
    rounds: [],
    groupStageGoalDiff: {},
    finalSeries: null,
  },
  settings: {
    tournamentName: 'TechStorm Tournament',
    groupSize: 4,
    qualifiersPerGroup: 2,
    adminPassword: 'techstorm2025',
  },
  stage: 'setup',
  groupsLocked: false,
  championId: null,
})

export const snakeDraftGroups = (
  players: Player[],
  groupSize: 4 | 5 | 6,
): { groups: Group[]; players: Player[] } => {
  const sorted = [...players].sort((a, b) => b.ovr - a.ovr)
  const groupCount = Math.max(1, Math.ceil(sorted.length / groupSize))
  const groups: Group[] = Array.from({ length: groupCount }, (_, i) => ({
    id: createId(),
    name: `Group ${LETTERS[i] ?? i + 1}`,
    playerIds: [],
  }))

  let index = 0
  let direction = 1
  for (const player of sorted) {
    groups[index].playerIds.push(player.id)
    if (index === groupCount - 1) {
      direction = -1
    } else if (index === 0) {
      direction = 1
    }
    index += direction
  }

  const byPlayer = new Map<string, string>()
  for (const group of groups) {
    for (const playerId of group.playerIds) {
      byPlayer.set(playerId, group.id)
    }
  }

  const updatedPlayers = sorted.map((player) => ({
    ...player,
    groupId: byPlayer.get(player.id) ?? null,
  }))

  return { groups, players: updatedPlayers }
}

export const generateGroupFixtures = (groups: Group[]): Fixture[] => {
  const fixtures: Fixture[] = []
  for (const group of groups) {
    for (let i = 0; i < group.playerIds.length; i += 1) {
      for (let j = i + 1; j < group.playerIds.length; j += 1) {
        fixtures.push({
          id: createId(),
          groupId: group.id,
          homeId: group.playerIds[i],
          awayId: group.playerIds[j],
          homeGoals: null,
          awayGoals: null,
          completed: false,
        })
      }
    }
  }
  return fixtures
}

export const calculateStandings = (
  group: Group,
  fixtures: Fixture[],
): StandingRow[] => {
  const rows: Record<string, StandingRow> = {}
  for (const playerId of group.playerIds) {
    rows[playerId] = {
      playerId,
      p: 0,
      w: 0,
      d: 0,
      l: 0,
      gf: 0,
      ga: 0,
      gd: 0,
      points: 0,
    }
  }

  for (const fixture of fixtures) {
    if (!fixture.completed || fixture.homeGoals === null || fixture.awayGoals === null) {
      continue
    }
    if (!rows[fixture.homeId] || !rows[fixture.awayId]) {
      continue
    }

    const home = rows[fixture.homeId]
    const away = rows[fixture.awayId]

    home.p += 1
    away.p += 1
    home.gf += fixture.homeGoals
    home.ga += fixture.awayGoals
    away.gf += fixture.awayGoals
    away.ga += fixture.homeGoals

    if (fixture.homeGoals > fixture.awayGoals) {
      home.w += 1
      home.points += 3
      away.l += 1
    } else if (fixture.homeGoals < fixture.awayGoals) {
      away.w += 1
      away.points += 3
      home.l += 1
    } else {
      home.d += 1
      away.d += 1
      home.points += 1
      away.points += 1
    }
  }

  return Object.values(rows)
    .map((row) => ({ ...row, gd: row.gf - row.ga }))
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points
      if (b.gd !== a.gd) return b.gd - a.gd
      if (b.gf !== a.gf) return b.gf - a.gf
      return a.playerId.localeCompare(b.playerId)
    })
}

export const standingsGoalDiffMap = (
  groups: Group[],
  fixtures: Fixture[],
): Record<string, number> => {
  const map: Record<string, number> = {}
  for (const group of groups) {
    const standings = calculateStandings(group, fixtures)
    for (const row of standings) {
      map[row.playerId] = row.gd
    }
  }
  return map
}

export const getQualifiedPlayers = (
  groups: Group[],
  fixtures: Fixture[],
  qualifiersPerGroup: number,
): string[] => {
  const qualified: string[] = []
  for (const group of groups) {
    const standings = calculateStandings(group, fixtures)
    const top = standings.slice(0, Math.min(qualifiersPerGroup, standings.length))
    for (const row of top) {
      qualified.push(row.playerId)
    }
  }
  return qualified
}

const roundName = (tieCount: number) => {
  if (tieCount === 16) return 'Round of 32'
  if (tieCount === 8) return 'Round of 16'
  if (tieCount === 4) return 'Quarterfinals'
  if (tieCount === 2) return 'Semifinals'
  return 'Knockout'
}

const buildTie = (
  roundIndex: number,
  slotIndex: number,
  playerAId: string | null,
  playerBId: string | null,
): KnockoutTie => ({
  id: createId(),
  roundIndex,
  slotIndex,
  playerAId,
  playerBId,
  leg1: { homeGoals: null, awayGoals: null, completed: false },
  leg2: { homeGoals: null, awayGoals: null, completed: false },
  coinTossWinnerId: null,
  decider: { homeGoals: null, awayGoals: null, completed: false, homeId: null },
  winnerId: playerAId && !playerBId ? playerAId : playerBId && !playerAId ? playerBId : null,
})

export const createKnockout = (
  qualifiedPlayers: string[],
  gdMap: Record<string, number>,
): KnockoutState => {
  if (qualifiedPlayers.length < 2) {
    return {
      enabled: false,
      rounds: [],
      groupStageGoalDiff: gdMap,
      finalSeries: null,
    }
  }

  let size = 2
  while (size < qualifiedPlayers.length) {
    size *= 2
  }

  const seeded = [...qualifiedPlayers]
  while (seeded.length < size) seeded.push('')

  const rounds: KnockoutRound[] = []
  const preFinalRounds = Math.max(0, Math.log2(size) - 1)

  for (let roundIndex = 0; roundIndex < preFinalRounds; roundIndex += 1) {
    const tieCount = size / 2 ** (roundIndex + 1)
    rounds.push({
      id: createId(),
      name: roundName(tieCount),
      ties: Array.from({ length: tieCount }, (_, i) =>
        buildTie(roundIndex, i, null, null),
      ),
    })
  }

  if (rounds.length > 0) {
    rounds[0].ties = rounds[0].ties.map((_, i) =>
      buildTie(0, i, seeded[i * 2] || null, seeded[i * 2 + 1] || null),
    )
  }

  const finalSeries = {
    player1Id: rounds.length === 0 ? seeded[0] || null : null,
    player2Id: rounds.length === 0 ? seeded[1] || null : null,
    games: [
      { id: createId(), winnerId: null, void: false },
      { id: createId(), winnerId: null, void: false },
      { id: createId(), winnerId: null, void: false },
    ],
    championId: null,
  }

  return {
    enabled: true,
    rounds,
    groupStageGoalDiff: gdMap,
    finalSeries,
  }
}

const evaluateTwoLegWinner = (
  tie: KnockoutTie,
  gdMap: Record<string, number>,
): string | null => {
  const { playerAId, playerBId, leg1, leg2, decider } = tie

  if (!playerAId && !playerBId) return null
  if (playerAId && !playerBId) return playerAId
  if (playerBId && !playerAId) return playerBId
  if (!playerAId || !playerBId) return null

  if (!leg1.completed || !leg2.completed) return null
  if (
    leg1.homeGoals === null ||
    leg1.awayGoals === null ||
    leg2.homeGoals === null ||
    leg2.awayGoals === null
  ) {
    return null
  }

  const aggregateA = leg1.homeGoals + leg2.awayGoals
  const aggregateB = leg1.awayGoals + leg2.homeGoals

  if (aggregateA > aggregateB) return playerAId
  if (aggregateB > aggregateA) return playerBId

  const homeGoalsA = leg1.homeGoals
  const homeGoalsB = leg2.homeGoals

  if (homeGoalsA > homeGoalsB) return playerAId
  if (homeGoalsB > homeGoalsA) return playerBId

  if (!decider.completed || decider.homeGoals === null || decider.awayGoals === null) {
    return null
  }

  if (decider.homeGoals > decider.awayGoals) {
    return decider.homeId === playerAId ? playerAId : playerBId
  }

  if (decider.awayGoals > decider.homeGoals) {
    return decider.homeId === playerAId ? playerBId : playerAId
  }

  const gdA = gdMap[playerAId] ?? 0
  const gdB = gdMap[playerBId] ?? 0
  if (gdA >= gdB) return playerAId
  return playerBId
}

export const propagateKnockout = (knockout: KnockoutState): KnockoutState => {
  if (!knockout.enabled) return knockout

  const rounds = knockout.rounds.map((round) => ({
    ...round,
    ties: round.ties.map((tie) => ({ ...tie })),
  }))

  for (let r = 0; r < rounds.length; r += 1) {
    for (const tie of rounds[r].ties) {
      tie.winnerId = evaluateTwoLegWinner(tie, knockout.groupStageGoalDiff)
    }

    const nextRound = rounds[r + 1]
    if (nextRound) {
      nextRound.ties = nextRound.ties.map((tie, slot) => {
        const left = rounds[r].ties[slot * 2]?.winnerId ?? null
        const right = rounds[r].ties[slot * 2 + 1]?.winnerId ?? null
        return {
          ...tie,
          playerAId: left,
          playerBId: right,
          winnerId: left && !right ? left : right && !left ? right : tie.winnerId,
        }
      })
    }
  }

  let finalSeries = knockout.finalSeries
  if (finalSeries) {
    if (rounds.length > 0) {
      const lastRound = rounds[rounds.length - 1]
      finalSeries = {
        ...finalSeries,
        player1Id: lastRound.ties[0]?.winnerId ?? null,
        player2Id: lastRound.ties[1]?.winnerId ?? null,
      }
    }

    const validGames = finalSeries.games.filter((g) => !g.void && g.winnerId)
    const p1Wins = validGames.filter((g) => g.winnerId === finalSeries?.player1Id).length
    const p2Wins = validGames.filter((g) => g.winnerId === finalSeries?.player2Id).length

    finalSeries = {
      ...finalSeries,
      championId:
        p1Wins >= 2
          ? finalSeries.player1Id
          : p2Wins >= 2
            ? finalSeries.player2Id
            : null,
    }
  }

  return {
    ...knockout,
    rounds,
    finalSeries,
  }
}

export const suggestBalancedGroup = (
  ovr: number,
  groups: Group[],
  players: Player[],
): string | null => {
  if (groups.length === 0) return null
  let bestGroupId = groups[0].id
  let bestScore = Number.POSITIVE_INFINITY

  for (const group of groups) {
    const groupPlayers = players.filter((player) => group.playerIds.includes(player.id))
    const average =
      groupPlayers.length === 0
        ? ovr
        : groupPlayers.reduce((sum, player) => sum + player.ovr, 0) / groupPlayers.length
    const score = Math.abs(average - ovr) + groupPlayers.length * 0.3
    if (score < bestScore) {
      bestScore = score
      bestGroupId = group.id
    }
  }

  return bestGroupId
}

export const addLateEntrantFixtures = (
  playerId: string,
  groupId: string,
  fixtures: Fixture[],
  groups: Group[],
): Fixture[] => {
  const group = groups.find((g) => g.id === groupId)
  if (!group) return fixtures

  const current = [...fixtures]
  for (const opponentId of group.playerIds) {
    if (opponentId === playerId) continue

    const exists = current.some(
      (fixture) =>
        fixture.groupId === groupId &&
        ((fixture.homeId === playerId && fixture.awayId === opponentId) ||
          (fixture.homeId === opponentId && fixture.awayId === playerId)),
    )

    if (!exists) {
      current.push({
        id: createId(),
        groupId,
        homeId: playerId,
        awayId: opponentId,
        homeGoals: null,
        awayGoals: null,
        completed: false,
      })
    }
  }

  return current
}
