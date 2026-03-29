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
