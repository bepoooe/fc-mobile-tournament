/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  addLateEntrantFixtures,
  createId,
  createKnockout,
  defaultState,
  generateGroupFixtures,
  getQualifiedPlayers,
  MAX_PLAYERS,
  MIN_PLAYERS,
  propagateKnockout,
  snakeDraftGroups,
  standingsGoalDiffMap,
  suggestBalancedGroup,
  resetKnockoutAfterRound,
  swapBracketPlayers,
} from '../utils/tournament'
import type {
  Fixture,
  KnockoutTie,
  Player,
  TournamentContextType,
  TournamentState,
} from '../types'
import {
  fetchRemoteTournamentState,
  isFirebaseSyncEnabled,
  saveRemoteTournamentState,
  subscribeRemoteTournamentState,
} from '../services/firebaseSync'

const STORAGE_KEY = 'techstorm_tournament_state'

const TournamentContext = createContext<TournamentContextType | null>(null)

const normalizeQualifiersPerGroup = (value: number, fallback: number): number => {
  if (!Number.isInteger(value) || value < 1) {
    return fallback
  }
  return value
}

const normalizeTournamentState = (incoming?: Partial<TournamentState>): TournamentState => {
  const fallback = defaultState()
  const mergedSettings = { ...fallback.settings, ...(incoming?.settings ?? {}) }

  const players = Array.isArray(incoming?.players)
    ? incoming.players.slice(0, MAX_PLAYERS)
    : fallback.players

  return {
    ...fallback,
    ...incoming,
    players,
    settings: {
      ...mergedSettings,
      groupSize: [4, 5, 6, 8].includes(mergedSettings.groupSize)
        ? mergedSettings.groupSize
        : fallback.settings.groupSize,
      qualifiersPerGroup: normalizeQualifiersPerGroup(
        mergedSettings.qualifiersPerGroup,
        fallback.settings.qualifiersPerGroup,
      ),
      tiebreakers:
        mergedSettings.tiebreakers && mergedSettings.tiebreakers.length
          ? mergedSettings.tiebreakers
          : fallback.settings.tiebreakers,
    },
    knockout: { ...fallback.knockout, ...(incoming?.knockout ?? {}) },
  }
}

const defaultGroupName = (existingNames: string[]): string => {
  const normalized = new Set(existingNames.map((name) => name.trim().toLowerCase()))
  let index = 0

  while (index < 26) {
    const candidate = `Group ${String.fromCharCode(65 + index)}`
    if (!normalized.has(candidate.toLowerCase())) {
      return candidate
    }
    index += 1
  }

  let numeric = 27
  while (normalized.has(`group ${numeric}`)) {
    numeric += 1
  }
  return `Group ${numeric}`
}

const uniqueGroupName = (requestedName: string, existingNames: string[]): string => {
  const trimmed = requestedName.trim()
  if (!trimmed) {
    return defaultGroupName(existingNames)
  }

  const normalized = new Set(existingNames.map((name) => name.trim().toLowerCase()))
  if (!normalized.has(trimmed.toLowerCase())) {
    return trimmed
  }

  let suffix = 2
  while (normalized.has(`${trimmed.toLowerCase()} ${suffix}`)) {
    suffix += 1
  }
  return `${trimmed} ${suffix}`
}

const parseState = (): TournamentState => {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return defaultState()

  try {
    const parsed = JSON.parse(raw) as TournamentState
    return normalizeTournamentState(parsed)
  } catch {
    return defaultState()
  }
}

const updateTie = (
  tie: KnockoutTie,
  leg: 'leg1' | 'leg2' | 'decider',
  homeGoals: number,
  awayGoals: number,
): KnockoutTie => {
  if (leg === 'decider') {
    return {
      ...tie,
      decider: {
        ...tie.decider,
        homeGoals,
        awayGoals,
        completed: true,
      },
      manualWinnerId: null,
    }
  }

  return {
    ...tie,
    [leg]: {
      ...tie[leg],
      homeGoals,
      awayGoals,
      completed: true,
    },
    manualWinnerId: null,
  }
}

export const TournamentProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<TournamentState>(parseState)
  const [isRemoteReady, setIsRemoteReady] = useState(!isFirebaseSyncEnabled)
  const stateJsonRef = useRef(JSON.stringify(state))
  const lastRemoteJsonRef = useRef<string | null>(null)
  const isApplyingRemoteRef = useRef(false)

  useEffect(() => {
    const serialized = JSON.stringify(state)
    stateJsonRef.current = serialized
    localStorage.setItem(STORAGE_KEY, serialized)
  }, [state])

  useEffect(() => {
    if (!isFirebaseSyncEnabled) {
      console.warn(
        'Firebase sync is disabled. Missing one or more VITE_FIREBASE_* environment variables in this deployment.',
      )
      setIsRemoteReady(true)
      return
    }

    let mounted = true
    let unsubscribe = () => {}

    const startSync = async () => {
      try {
        const remote = await fetchRemoteTournamentState()
        if (remote && mounted) {
          const normalized = normalizeTournamentState(remote)
          const serialized = JSON.stringify(normalized)
          lastRemoteJsonRef.current = serialized

          if (serialized !== stateJsonRef.current) {
            isApplyingRemoteRef.current = true
            setState(normalized)
          }
        }
      } catch (error) {
        console.error('Failed to fetch remote tournament state:', error)
      } finally {
        if (mounted) {
          setIsRemoteReady(true)
        }
      }

      const remoteUnsubscribe = await subscribeRemoteTournamentState((remote) => {
        const normalized = normalizeTournamentState(remote)
        const serialized = JSON.stringify(normalized)
        lastRemoteJsonRef.current = serialized

        if (serialized === stateJsonRef.current) {
          return
        }

        isApplyingRemoteRef.current = true
        setState(normalized)
      })

      if (remoteUnsubscribe) {
        unsubscribe = remoteUnsubscribe
      }
    }

    void startSync()

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isFirebaseSyncEnabled || !isRemoteReady) {
      return
    }

    if (isApplyingRemoteRef.current) {
      isApplyingRemoteRef.current = false
      return
    }

    if (stateJsonRef.current === lastRemoteJsonRef.current) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void saveRemoteTournamentState(state)
        .then(() => {
          lastRemoteJsonRef.current = stateJsonRef.current
        })
        .catch((error) => {
          console.error('Failed to save remote tournament state:', error)
        })
    }, 500)

    return () => window.clearTimeout(timeoutId)
  }, [state, isRemoteReady])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === null) {
        alert('Warning: Browser storage was cleared in another tab.')
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const setSettings = useCallback((settings: Partial<TournamentState['settings']>) => {
    setState((prev) => {
      const merged = { ...prev.settings, ...settings }
      return {
        ...prev,
        settings: {
          ...merged,
          groupSize: [4, 5, 6, 8].includes(merged.groupSize) ? merged.groupSize : 4,
          qualifiersPerGroup: normalizeQualifiersPerGroup(
            merged.qualifiersPerGroup,
            prev.settings.qualifiersPerGroup,
          ),
          tiebreakers:
            merged.tiebreakers && merged.tiebreakers.length
              ? merged.tiebreakers
              : prev.settings.tiebreakers,
        },
      }
    })
  }, [])

  const setAdminPassword = useCallback((password: string) => {
    setState((prev) => ({
      ...prev,
      settings: {
        ...prev.settings,
        adminPassword: password,
      },
    }))
  }, [])

  const addPlayer = useCallback((name: string, ovr: number, joinedLate = false) => {
    if (state.players.length >= MAX_PLAYERS) {
      throw new Error(`Player limit reached (${MAX_PLAYERS})`)
    }

    const player: Player = {
      id: createId(),
      name: name.trim(),
      ovr,
      groupId: null,
      joinedLate,
    }

    setState((prev) => ({
      ...prev,
      players: [...prev.players, player],
    }))

    return player
  }, [state.players.length])

  const bulkAddPlayers = useCallback(
    (incoming: Array<{ name: string; ovr: number }>) => {
      const normalized = incoming
        .filter((player) => player.name.trim() && Number.isFinite(player.ovr))
        .map((player) => ({
          id: createId(),
          name: player.name.trim(),
          ovr: Math.round(player.ovr),
          groupId: null,
          joinedLate: false,
        }))

      if (!normalized.length) return

      setState((prev) => ({
        ...prev,
        players: [...prev.players, ...normalized].slice(0, MAX_PLAYERS),
      }))
    },
    [],
  )

  const updatePlayer = useCallback((id: string, name: string, ovr: number) => {
    setState((prev) => ({
      ...prev,
      players: prev.players.map((player) =>
        player.id === id ? { ...player, name: name.trim(), ovr } : player,
      ),
    }))
  }, [])

  const removePlayer = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      players: prev.players.filter((player) => player.id !== id),
      groups: prev.groups.map((group) => ({
        ...group,
        playerIds: group.playerIds.filter((playerId) => playerId !== id),
      })),
      fixtures: prev.fixtures.filter(
        (fixture) => fixture.homeId !== id && fixture.awayId !== id,
      ),
    }))
  }, [])

  const clearAllPlayers = useCallback(() => {
    setState((prev) => ({
      ...prev,
      players: [],
      groups: [],
      fixtures: [],
      knockout: defaultState().knockout,
      stage: 'setup',
      groupsLocked: false,
      championId: null,
    }))
  }, [])

  const generateGroups = useCallback(() => {
    setState((prev) => {
      if (prev.players.length < MIN_PLAYERS) return prev
      const result = snakeDraftGroups(
        prev.players,
        prev.settings.groupSize,
        prev.settings.seedingMode,
      )
      return {
        ...prev,
        players: result.players,
        groups: result.groups,
        fixtures: [],
        groupsLocked: false,
        stage: 'setup',
        knockout: defaultState().knockout,
        championId: null,
      }
    })
  }, [])

  const createGroup = useCallback((name?: string) => {
    let createdGroupId: string | null = null

    setState((prev) => {
      const groupName = uniqueGroupName(name ?? '', prev.groups.map((group) => group.name))
      const groupId = createId()
      createdGroupId = groupId

      return {
        ...prev,
        groups: [...prev.groups, { id: groupId, name: groupName, playerIds: [] }],
        knockout: defaultState().knockout,
        championId: null,
      }
    })

    return createdGroupId
  }, [])

  const deleteGroup = useCallback((groupId: string, destinationGroupId?: string | null) => {
    let deleted = false

    setState((prev) => {
      const groupToDelete = prev.groups.find((group) => group.id === groupId)
      if (!groupToDelete || prev.groups.length <= 1) {
        return prev
      }

      const movingPlayers = [...groupToDelete.playerIds]
      const hasPlayers = movingPlayers.length > 0
      const targetGroupId = destinationGroupId ?? null

      if (hasPlayers) {
        if (!targetGroupId || targetGroupId === groupId) {
          return prev
        }

        const targetExists = prev.groups.some((group) => group.id === targetGroupId)
        if (!targetExists) {
          return prev
        }
      }

      const groupsWithoutDeleted = prev.groups.filter((group) => group.id !== groupId)
      const groups = hasPlayers && targetGroupId
        ? groupsWithoutDeleted.map((group) =>
            group.id === targetGroupId
              ? { ...group, playerIds: [...group.playerIds, ...movingPlayers] }
              : group,
          )
        : groupsWithoutDeleted

      const players = hasPlayers && targetGroupId
        ? prev.players.map((player) =>
            movingPlayers.includes(player.id)
              ? { ...player, groupId: targetGroupId }
              : player,
          )
        : prev.players

      let fixtures = prev.fixtures.filter((fixture) => fixture.groupId !== groupId)
      if (hasPlayers && targetGroupId) {
        for (const playerId of movingPlayers) {
          fixtures = addLateEntrantFixtures(playerId, targetGroupId, fixtures, groups)
        }
      }

      const activeFixtureIds = new Set(fixtures.map((fixture) => fixture.id))
      deleted = true

      return {
        ...prev,
        players,
        groups,
        fixtures,
        confirmedFixtures: prev.confirmedFixtures.filter((fixtureId) =>
          activeFixtureIds.has(fixtureId),
        ),
        knockout: defaultState().knockout,
        championId: null,
        stage: prev.groupsLocked ? 'group_stage' : prev.stage,
      }
    })

    return deleted
  }, [])

  const movePlayerToGroup = useCallback((playerId: string, targetGroupId: string) => {
    setState((prev) => {
      const groups = prev.groups.map((group) => ({
        ...group,
        playerIds: group.playerIds.filter((id) => id !== playerId),
      }))

      const target = groups.find((group) => group.id === targetGroupId)
      if (target) {
        target.playerIds.push(playerId)
      }

      return {
        ...prev,
        groups,
        players: prev.players.map((player) =>
          player.id === playerId ? { ...player, groupId: targetGroupId } : player,
        ),
      }
    })
  }, [])

  const lockGroups = useCallback(() => {
    setState((prev) => {
      if (prev.groups.length === 0 || prev.players.length < MIN_PLAYERS) return prev
      return {
        ...prev,
        groupsLocked: true,
        stage: 'group_stage',
        fixtures: generateGroupFixtures(prev.groups),
      }
    })
  }, [])

  const addLatePlayerToSuggestedGroup = useCallback((name: string, ovr: number) => {
    let assignedGroup: string | null = null

    setState((prev) => {
      if (prev.players.length >= MAX_PLAYERS) {
        return prev
      }

      const playerId = createId()
      const suggestedGroupId = suggestBalancedGroup(ovr, prev.groups, prev.players)
      assignedGroup = suggestedGroupId
      if (!suggestedGroupId) return prev

      const players = [
        ...prev.players,
        {
          id: playerId,
          name: name.trim(),
          ovr,
          groupId: suggestedGroupId,
          joinedLate: true,
        },
      ]

      const groups = prev.groups.map((group) =>
        group.id === suggestedGroupId
          ? { ...group, playerIds: [...group.playerIds, playerId] }
          : group,
      )

      const fixtures = addLateEntrantFixtures(playerId, suggestedGroupId, prev.fixtures, groups)

      return {
        ...prev,
        players,
        groups,
        fixtures,
      }
    })

    return assignedGroup
  }, [])

  const setFixtureScore = useCallback((fixtureId: string, homeGoals: number, awayGoals: number) => {
    setState((prev) => {
      const fixtures = prev.fixtures.map((fixture) =>
        fixture.id === fixtureId
          ? {
              ...fixture,
              homeGoals,
              awayGoals,
              completed: true,
            }
          : fixture,
      )
      return {
        ...prev,
        fixtures,
        stage: fixtures.some((fixture) => fixture.completed) ? 'group_stage' : prev.stage,
      }
    })
  }, [])

  const clearFixtureScore = useCallback((fixtureId: string) => {
    setState((prev) => {
      const fixtures = prev.fixtures.map((fixture) =>
        fixture.id === fixtureId
          ? {
              ...fixture,
              homeGoals: null,
              awayGoals: null,
              completed: false,
            }
          : fixture,
      )
      return {
        ...prev,
        fixtures,
      }
    })
  }, [])

  const confirmFixture = useCallback((fixtureId: string) => {
    setState((prev) => {
      if (prev.confirmedFixtures.includes(fixtureId)) {
        return prev
      }
      return {
        ...prev,
        confirmedFixtures: [...prev.confirmedFixtures, fixtureId],
      }
    })
  }, [])

  const isFixtureConfirmed = useCallback((fixtureId: string) => {
    return state.confirmedFixtures.includes(fixtureId)
  }, [state.confirmedFixtures])

  const unconfirmFixture = useCallback((fixtureId: string) => {
    setState((prev) => ({
      ...prev,
      confirmedFixtures: prev.confirmedFixtures.filter(id => id !== fixtureId),
    }))
  }, [])

  const generateKnockout = useCallback(() => {
    setState((prev) => {
      const gdMap = standingsGoalDiffMap(
        prev.groups,
        prev.fixtures,
        prev.settings.tiebreakers,
      )
      const qualifiedPlayers = getQualifiedPlayers(
        prev.groups,
        prev.fixtures,
        prev.settings.qualifiersPerGroup,
        prev.settings.tiebreakers,
      )

      if (qualifiedPlayers.length < 2) {
        return prev
      }

      const knockout = propagateKnockout(createKnockout(qualifiedPlayers, gdMap))

      return {
        ...prev,
        knockout,
        stage: 'knockout',
      }
    })
  }, [])

  const setTieLegScore = useCallback(
    (
      roundIndex: number,
      tieId: string,
      leg: 'leg1' | 'leg2' | 'decider',
      homeGoals: number,
      awayGoals: number,
    ) => {
      setState((prev) => {
        const rounds = prev.knockout.rounds.map((round, index) => {
          if (index !== roundIndex) return round
          return {
            ...round,
            ties: round.ties.map((tie) =>
              tie.id === tieId ? updateTie(tie, leg, homeGoals, awayGoals) : tie,
            ),
          }
        })

        const next = propagateKnockout({ ...prev.knockout, rounds })

        const stage = next.finalSeries?.championId
          ? 'completed'
          : next.finalSeries?.player1Id && next.finalSeries?.player2Id
            ? 'final'
            : 'knockout'

        return {
          ...prev,
          knockout: next,
          championId: next.finalSeries?.championId ?? null,
          stage,
        }
      })
    },
    [],
  )

  const clearTieLegScore = useCallback(
    (roundIndex: number, tieId: string, leg: 'leg1' | 'leg2' | 'decider') => {
      setState((prev) => {
        const rounds = prev.knockout.rounds.map((round, index) => {
          if (index !== roundIndex) return round
          return {
            ...round,
            ties: round.ties.map((tie) => {
              if (tie.id !== tieId) return tie
              if (leg === 'decider') {
                return {
                  ...tie,
                  decider: {
                    ...tie.decider,
                    homeGoals: null,
                    awayGoals: null,
                    completed: false,
                  },
                  manualWinnerId: null,
                }
              }

              return {
                ...tie,
                [leg]: {
                  ...tie[leg],
                  homeGoals: null,
                  awayGoals: null,
                  completed: false,
                },
                manualWinnerId: null,
              }
            }),
          }
        })

        const next = propagateKnockout({ ...prev.knockout, rounds })
        return {
          ...prev,
          knockout: next,
          championId: next.finalSeries?.championId ?? null,
          stage: next.finalSeries?.championId ? 'completed' : prev.stage,
        }
      })
    },
    [],
  )

  const setTieWinner = useCallback((roundIndex: number, tieId: string, winnerId: string | null) => {
    setState((prev) => {
      const rounds = resetKnockoutAfterRound(prev.knockout, roundIndex).rounds.map((round, index) => {
        if (index !== roundIndex) return round

        return {
          ...round,
          ties: round.ties.map((tie) => {
            if (tie.id !== tieId) return tie

            const allowedWinnerIds = new Set([tie.playerAId, tie.playerBId].filter(Boolean))
            const manualWinnerId = winnerId && allowedWinnerIds.has(winnerId) ? winnerId : null

            return {
              ...tie,
              manualWinnerId,
            }
          }),
        }
      })

      const next = propagateKnockout({ ...prev.knockout, rounds })

      const stage = next.finalSeries?.championId
        ? 'completed'
        : next.finalSeries?.player1Id && next.finalSeries?.player2Id
          ? 'final'
          : 'knockout'

      return {
        ...prev,
        knockout: next,
        championId: next.finalSeries?.championId ?? null,
        stage,
      }
    })
  }, [])

  const coinTossTie = useCallback((roundIndex: number, tieId: string) => {
    setState((prev) => {
      const rounds = prev.knockout.rounds.map((round, index) => {
        if (index !== roundIndex) return round
        return {
          ...round,
          ties: round.ties.map((tie) => {
            if (tie.id !== tieId || !tie.playerAId || !tie.playerBId) return tie
            const winner = Math.random() > 0.5 ? tie.playerAId : tie.playerBId
            return {
              ...tie,
              coinTossWinnerId: winner,
              decider: {
                ...tie.decider,
                homeId: winner,
              },
            }
          }),
        }
      })

      return {
        ...prev,
        knockout: { ...prev.knockout, rounds },
      }
    })
  }, [])

  const setFinalGameResult = useCallback(
    (gameId: string, winnerId: string | null, isVoid: boolean) => {
      setState((prev) => {
        if (!prev.knockout.finalSeries) return prev

        const finalSeries = {
          ...prev.knockout.finalSeries,
          games: prev.knockout.finalSeries.games.map((game) =>
            game.id === gameId ? { ...game, winnerId, void: isVoid } : game,
          ),
        }

        const next = propagateKnockout({ ...prev.knockout, finalSeries })

        return {
          ...prev,
          knockout: next,
          championId: next.finalSeries?.championId ?? null,
          stage: next.finalSeries?.championId ? 'completed' : 'final',
        }
      })
    },
    [],
  )

  const clearFinalGameResult = useCallback((gameId: string) => {
    setState((prev) => {
      if (!prev.knockout.finalSeries) return prev

      const finalSeries = {
        ...prev.knockout.finalSeries,
        games: prev.knockout.finalSeries.games.map((game) =>
          game.id === gameId ? { ...game, winnerId: null, void: false } : game,
        ),
      }

      const next = propagateKnockout({ ...prev.knockout, finalSeries })
      return {
        ...prev,
        knockout: next,
        championId: next.finalSeries?.championId ?? null,
        stage: next.finalSeries?.championId ? 'completed' : 'final',
      }
    })
  }, [])

  const importState = useCallback((incoming: TournamentState) => {
    setState(normalizeTournamentState(incoming))
  }, [])

  const exportState = useCallback(() => state, [state])

  const resetTournament = useCallback(() => {
    setState(defaultState())
  }, [])

  const resetKnockout = useCallback(() => {
    setState((prev) => ({
      ...prev,
      knockout: {
        enabled: false,
        rounds: [],
        groupStageGoalDiff: prev.knockout.groupStageGoalDiff,
        finalSeries: null,
      },
      stage: 'group_stage' as const,
      championId: null,
    }))
  }, [])

  const swapBracketPlayersHandler = useCallback((playerId1: string, playerId2: string) => {
    setState((prev) => {
      const updated = swapBracketPlayers(prev.knockout, playerId1, playerId2)
      return {
        ...prev,
        knockout: updated,
      }
    })
  }, [])

  const value = useMemo<TournamentContextType>(
    () => ({
      state,
      resetTournament,
      resetKnockout,
      setAdminPassword,
      setSettings,
      importState,
      exportState,
      addPlayer,
      updatePlayer,
      removePlayer,
      clearAllPlayers,
      bulkAddPlayers,
      generateGroups,
      createGroup,
      deleteGroup,
      movePlayerToGroup,
      lockGroups,
      addLatePlayerToSuggestedGroup,
      setFixtureScore,
      clearFixtureScore,
      confirmFixture,
      isFixtureConfirmed,
      unconfirmFixture,
      generateKnockout,
      setTieLegScore,
      clearTieLegScore,
      coinTossTie,
      setTieWinner,
      setFinalGameResult,
      clearFinalGameResult,
      swapBracketPlayers: swapBracketPlayersHandler,
    }),
    [
      state,
      resetTournament,
      resetKnockout,
      setAdminPassword,
      setSettings,
      importState,
      exportState,
      addPlayer,
      updatePlayer,
      removePlayer,
      clearAllPlayers,
      bulkAddPlayers,
      generateGroups,
      createGroup,
      deleteGroup,
      movePlayerToGroup,
      lockGroups,
      addLatePlayerToSuggestedGroup,
      setFixtureScore,
      clearFixtureScore,
      confirmFixture,
      isFixtureConfirmed,
      unconfirmFixture,
      generateKnockout,
      setTieLegScore,
      clearTieLegScore,
      coinTossTie,
      setFinalGameResult,
      clearFinalGameResult,
      swapBracketPlayersHandler,
    ],
  )

  return <TournamentContext.Provider value={value}>{children}</TournamentContext.Provider>
}

export const useTournament = () => {
  const context = useContext(TournamentContext)
  if (!context) {
    throw new Error('useTournament must be used within TournamentProvider')
  }
  return context
}

export const usePlayerMap = () => {
  const { state } = useTournament()
  return useMemo(
    () =>
      state.players.reduce<Record<string, Player>>((acc, player) => {
        acc[player.id] = player
        return acc
      }, {}),
    [state.players],
  )
}

export const useGroupFixtures = (groupId: string): Fixture[] => {
  const { state } = useTournament()
  return useMemo(
    () => state.fixtures.filter((fixture) => fixture.groupId === groupId),
    [state.fixtures, groupId],
  )
}
