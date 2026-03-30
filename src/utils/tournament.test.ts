import { describe, expect, it } from 'vitest'
import {
  addLateEntrantFixtures,
  calculateStandings,
  createKnockout,
  getQualifiedPlayers,
  propagateKnockout,
  snakeDraftGroups,
} from './tournament'
import type { Fixture, Group, Player } from '../types'

const buildPlayers = (count: number): Player[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `p-${index + 1}`,
    name: `Player ${index + 1}`,
    ovr: 80 + ((count - index) % 20),
    groupId: null,
    joinedLate: false,
  }))

describe('snakeDraftGroups', () => {
  it('supports up to 80 players with group size 8', () => {
    const players = buildPlayers(80)
    const result = snakeDraftGroups(players, 8, 'ovr_snake')

    expect(result.groups).toHaveLength(10)
    expect(result.groups.every((group) => group.playerIds.length === 8)).toBe(true)
  })

  it('keeps OVR ranges grouped together in ovr_snake mode', () => {
    const players: Player[] = [
      { id: 'p1', name: 'A', ovr: 121, groupId: null, joinedLate: false },
      { id: 'p2', name: 'B', ovr: 120, groupId: null, joinedLate: false },
      { id: 'p9', name: 'I', ovr: 122, groupId: null, joinedLate: false },
      { id: 'p10', name: 'J', ovr: 123, groupId: null, joinedLate: false },
      { id: 'p3', name: 'C', ovr: 118, groupId: null, joinedLate: false },
      { id: 'p4', name: 'D', ovr: 115, groupId: null, joinedLate: false },
      { id: 'p11', name: 'K', ovr: 117, groupId: null, joinedLate: false },
      { id: 'p12', name: 'L', ovr: 116, groupId: null, joinedLate: false },
      { id: 'p5', name: 'E', ovr: 114, groupId: null, joinedLate: false },
      { id: 'p6', name: 'F', ovr: 110, groupId: null, joinedLate: false },
      { id: 'p13', name: 'M', ovr: 113, groupId: null, joinedLate: false },
      { id: 'p14', name: 'N', ovr: 112, groupId: null, joinedLate: false },
      { id: 'p7', name: 'G', ovr: 109, groupId: null, joinedLate: false },
      { id: 'p8', name: 'H', ovr: 100, groupId: null, joinedLate: false },
      { id: 'p15', name: 'O', ovr: 108, groupId: null, joinedLate: false },
      { id: 'p16', name: 'P', ovr: 101, groupId: null, joinedLate: false },
    ]

    const result = snakeDraftGroups(players, 4, 'ovr_snake')
    const groupedOvrs = result.groups.map((group) =>
      group.playerIds.map((id) => players.find((player) => player.id === id)?.ovr ?? 0),
    )

    expect(groupedOvrs).toEqual([
      [123, 122, 121, 120],
      [118, 117, 116, 115],
      [114, 113, 112, 110],
      [109, 108, 101, 100],
    ])
  })
})

describe('standings and qualifiers', () => {
  const group: Group = {
    id: 'g1',
    name: 'Group A',
    playerIds: ['a', 'b', 'c', 'd'],
  }

  const fixtures: Fixture[] = [
    { id: '1', groupId: 'g1', homeId: 'a', awayId: 'b', homeGoals: 2, awayGoals: 0, completed: true },
    { id: '2', groupId: 'g1', homeId: 'a', awayId: 'c', homeGoals: 1, awayGoals: 1, completed: true },
    { id: '3', groupId: 'g1', homeId: 'a', awayId: 'd', homeGoals: 0, awayGoals: 1, completed: true },
    { id: '4', groupId: 'g1', homeId: 'b', awayId: 'c', homeGoals: 3, awayGoals: 1, completed: true },
    { id: '5', groupId: 'g1', homeId: 'b', awayId: 'd', homeGoals: 0, awayGoals: 0, completed: true },
    { id: '6', groupId: 'g1', homeId: 'c', awayId: 'd', homeGoals: 2, awayGoals: 2, completed: true },
  ]

  it('computes standings with configured tiebreakers', () => {
    const standings = calculateStandings(group, fixtures, ['points', 'gd', 'gf', 'head_to_head'])
    expect(standings[0].playerId).toBe('d')
    expect(standings[1].playerId).toBe('a')
  })

  it('extracts top qualifiers per group', () => {
    const qualified = getQualifiedPlayers([group], fixtures, 2, ['points', 'gd', 'gf'])
    expect(qualified).toEqual(['d', 'a'])
  })
})

describe('knockout generation and propagation', () => {
  it('handles non power-of-two qualifiers with byes', () => {
    const qualified = ['a', 'b', 'c', 'd', 'e', 'f']
    const gdMap = Object.fromEntries(qualified.map((id, index) => [id, index]))

    const knockout = createKnockout(qualified, gdMap)
    expect(knockout.enabled).toBe(true)
    expect(knockout.rounds.length).toBeGreaterThan(0)

    const firstRound = knockout.rounds[0]
    expect(firstRound.ties).toHaveLength(4)
  })

  it('resolves champion from final best-of-3', () => {
    const knockout = createKnockout(['p1', 'p2'], { p1: 4, p2: 2 })
    const propagated = propagateKnockout(knockout)

    const finalSeries = propagated.finalSeries
    expect(finalSeries).not.toBeNull()
    if (!finalSeries) return

    const player1Id = finalSeries.player1Id
    const player2Id = finalSeries.player2Id
    expect(player1Id).toBeTruthy()
    expect(player2Id).toBeTruthy()

    const withFinalResults = {
      ...propagated,
      finalSeries: {
        ...finalSeries,
        games: finalSeries.games.map((game, index) => ({
          ...game,
          winnerId: index < 2 ? player1Id : player2Id,
          void: false,
        })),
      },
    }

    const resolved = propagateKnockout(withFinalResults)
    expect(resolved.finalSeries?.championId).toBe(player1Id)
  })
})

describe('late entrant fixtures', () => {
  it('adds missing fixtures for late entrant only', () => {
    const groupId = 'g1'
    const groups: Group[] = [{ id: groupId, name: 'Group A', playerIds: ['p1', 'p2', 'p3'] }]
    const fixtures: Fixture[] = [
      { id: 'f1', groupId, homeId: 'p1', awayId: 'p2', homeGoals: null, awayGoals: null, completed: false },
    ]

    const updated = addLateEntrantFixtures('p3', groupId, fixtures, groups)
    expect(updated).toHaveLength(3)
  })
})
