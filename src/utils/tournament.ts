import {
  type Fixture,
  type Group,
  type KnockoutRound,
  type KnockoutState,
  type KnockoutTie,
  type Player,
  type StandingRow,
  type Tiebreaker,
  type TournamentState,
  type SeedingMode,
} from '../types'

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const MAX_PLAYERS = 80
export const MIN_PLAYERS = 2

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
    tournamentName: 'TechStorm EA FC Mobile Tournament',
    groupSize: 4,
    qualifiersPerGroup: 2,
    seedingMode: 'ovr_snake',
    tiebreakers: ['points', 'gd', 'gf', 'head_to_head'],
    adminPassword: 'techstorm2025',
  },
  stage: 'setup',
  groupsLocked: false,
  championId: null,
  confirmedFixtures: [],
})

const shuffled = <T,>(items: T[]) => {
  const list = [...items]
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = list[i]
    list[i] = list[j]
    list[j] = temp
  }
  return list
}

const orderedBySeedingMode = (players: Player[], seedingMode: SeedingMode) => {
  if (seedingMode === 'random') {
    return shuffled(players)
  }

  if (seedingMode === 'manual') {
    return [...players]
  }

  const ovrBand = (ovr: number) => {
    if (ovr > 119) return 0
    if (ovr >= 115) return 1
    if (ovr >= 110) return 2
    return 3
  }

  return [...players].sort((a, b) => {
    const bandDiff = ovrBand(a.ovr) - ovrBand(b.ovr)
    if (bandDiff !== 0) return bandDiff
    if (b.ovr !== a.ovr) return b.ovr - a.ovr
    return a.name.localeCompare(b.name)
  })
}

export const snakeDraftGroups = (
  players: Player[],
  groupSize: 4 | 5 | 6 | 8,
  seedingMode: SeedingMode = 'ovr_snake',
): { groups: Group[]; players: Player[] } => {
  const ordered = orderedBySeedingMode(players, seedingMode)
  const groupCount = Math.max(1, Math.ceil(ordered.length / groupSize))
  const groups: Group[] = Array.from({ length: groupCount }, (_, i) => ({
    id: createId(),
    name: `Group ${LETTERS[i] ?? i + 1}`,
    playerIds: [],
  }))

  if (seedingMode === 'ovr_snake') {
    let targetIndex = 0
    for (const player of ordered) {
      while (targetIndex < groups.length && groups[targetIndex].playerIds.length >= groupSize) {
        targetIndex += 1
      }
      if (targetIndex >= groups.length) {
        break
      }
      groups[targetIndex].playerIds.push(player.id)
    }
  } else {
    for (let i = 0; i < ordered.length; i += 1) {
      const row = Math.floor(i / groupCount)
      const col = i % groupCount
      const targetIndex = row % 2 === 0 ? col : groupCount - 1 - col
      groups[targetIndex].playerIds.push(ordered[i].id)
    }
  }

  const byPlayer = new Map<string, string>()
  for (const group of groups) {
    for (const playerId of group.playerIds) {
      byPlayer.set(playerId, group.id)
    }
  }

  const updatedPlayers = players.map((player) => ({
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
  tiebreakers: Tiebreaker[] = ['points', 'gd', 'gf', 'head_to_head'],
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

  const headToHeadDiff = (leftId: string, rightId: string) => {
    let leftPoints = 0
    let rightPoints = 0
    let leftGd = 0
    let rightGd = 0
    let leftGf = 0
    let rightGf = 0

    for (const fixture of fixtures) {
      if (!fixture.completed || fixture.homeGoals === null || fixture.awayGoals === null) {
        continue
      }

      const pairMatch =
        (fixture.homeId === leftId && fixture.awayId === rightId) ||
        (fixture.homeId === rightId && fixture.awayId === leftId)
      if (!pairMatch) continue

      const leftGoals = fixture.homeId === leftId ? fixture.homeGoals : fixture.awayGoals
      const rightGoals = fixture.homeId === rightId ? fixture.homeGoals : fixture.awayGoals

      leftGf += leftGoals
      rightGf += rightGoals
      leftGd += leftGoals - rightGoals
      rightGd += rightGoals - leftGoals

      if (leftGoals > rightGoals) {
        leftPoints += 3
      } else if (rightGoals > leftGoals) {
        rightPoints += 3
      } else {
        leftPoints += 1
        rightPoints += 1
      }
    }

    if (leftPoints !== rightPoints) return leftPoints - rightPoints
    if (leftGd !== rightGd) return leftGd - rightGd
    return leftGf - rightGf
  }

  return Object.values(rows)
    .map((row) => ({ ...row, gd: row.gf - row.ga }))
    .sort((a, b) => {
      for (const tiebreaker of tiebreakers) {
        if (tiebreaker === 'points' && b.points !== a.points) {
          return b.points - a.points
        }
        if (tiebreaker === 'gd' && b.gd !== a.gd) {
          return b.gd - a.gd
        }
        if (tiebreaker === 'gf' && b.gf !== a.gf) {
          return b.gf - a.gf
        }
        if (tiebreaker === 'head_to_head') {
          const delta = headToHeadDiff(a.playerId, b.playerId)
          if (delta !== 0) return -delta
        }
      }
      return a.playerId.localeCompare(b.playerId)
    })
}

export const standingsGoalDiffMap = (
  groups: Group[],
  fixtures: Fixture[],
  tiebreakers: Tiebreaker[] = ['points', 'gd', 'gf', 'head_to_head'],
): Record<string, number> => {
  const map: Record<string, number> = {}
  for (const group of groups) {
    const standings = calculateStandings(group, fixtures, tiebreakers)
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
  tiebreakers: Tiebreaker[] = ['points', 'gd', 'gf', 'head_to_head'],
): string[] => {
  const qualified: string[] = []
  for (const group of groups) {
    const standings = calculateStandings(group, fixtures, tiebreakers)
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

  const seeded = shuffled(qualifiedPlayers)
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

export const swapBracketPlayers = (
  knockout: KnockoutState,
  playerId1: string,
  playerId2: string,
): KnockoutState => {
  if (!knockout.enabled || knockout.rounds.length === 0) {
    return knockout
  }

  const firstRound = knockout.rounds[0]
  if (!firstRound) return knockout

  const updatedRounds = knockout.rounds.map((round, roundIndex) => {
    if (roundIndex !== 0) return round

    return {
      ...round,
      ties: round.ties.map((tie) => {
        let playerAId = tie.playerAId
        let playerBId = tie.playerBId

        if (playerAId === playerId1) playerAId = playerId2
        else if (playerAId === playerId2) playerAId = playerId1

        if (playerBId === playerId1) playerBId = playerId2
        else if (playerBId === playerId2) playerBId = playerId1

        return {
          ...tie,
          playerAId,
          playerBId,
          winnerId: null,
          leg1: { homeGoals: null, awayGoals: null, completed: false },
          leg2: { homeGoals: null, awayGoals: null, completed: false },
          coinTossWinnerId: null,
          decider: { homeGoals: null, awayGoals: null, completed: false, homeId: null },
        }
      }),
    }
  })

  return {
    ...knockout,
    rounds: updatedRounds,
  }
}

const evaluateTwoLegWinner = (
  tie: KnockoutTie,
  gdMap: Record<string, number>,
): string | null => {
  const { playerAId, playerBId, leg1, leg2, decider } = tie

  if (!playerAId && !playerBId) return null
  // Structural byes only exist in round 0 (bracket padding with empty strings).
  // In rounds 1+, a null opponent means the source match is pending — not a bye.
  if (tie.roundIndex === 0) {
    if (playerAId && !playerBId) return playerAId
    if (playerBId && !playerAId) return playerBId
  }
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
        const leftSourceTie  = rounds[r].ties[slot * 2]
        const rightSourceTie = rounds[r].ties[slot * 2 + 1]

        const left  = leftSourceTie?.winnerId  ?? null
        const right = rightSourceTie?.winnerId ?? null

        // A slot is a "true bye" only when the source bracket position has NO players
        // assigned at all (neither A nor B). If a tie has players but the match hasn't
        // been played yet, that is a pending match — NOT a bye.
        const rightIsTrueBye =
          !rightSourceTie ||
          (!rightSourceTie.playerAId && !rightSourceTie.playerBId)
        const leftIsTrueBye =
          !leftSourceTie ||
          (!leftSourceTie.playerAId && !leftSourceTie.playerBId)

        // Only auto-advance a lone player when their opponent slot is genuinely empty.
        // Never cascade through pending matches that simply haven't been played yet.
        const autoWinner: string | null =
          left && !right && rightIsTrueBye ? left
          : right && !left && leftIsTrueBye ? right
          : null

        return {
          ...tie,
          playerAId: left,
          playerBId: right,
          winnerId: autoWinner ?? (left && right ? tie.winnerId : null),
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
