import { useMemo } from 'react'
import { usePlayerMap, useTournament } from '../context/TournamentContext'
import type { KnockoutTie } from '../types'

type Team = {
  name: string
  logo: string
}

type Match = {
  id: string
  team1: Team | null
  team2: Team | null
  winner: Team | null
}

const TEAM_LOGOS: Record<string, string> = {
  PARIS: '🔵',
  CHELSEA: '🔵',
  GALATASARAY: '🟡',
  LIVERPOOL: '🔴',
  'REAL MADRID': '⚪',
  'MAN CITY': '🔵',
  ATALANTA: '⚫',
  'BAYERN MÜNCHEN': '🔴',
  NEWCASTLE: '⚫',
  BARCELONA: '🔴',
  ATLETI: '🔴',
  TOTTENHAM: '⚪',
  'BODØ/GLIMT': '🟡',
  'SPORTING CP': '🟢',
  LEVERKUSEN: '🔴',
  ARSENAL: '🔴',
}

const logoForName = (name: string) => TEAM_LOGOS[name.toUpperCase()] ?? '⚽'

const toTeam = (playerId: string | null, playerMap: Record<string, { name: string }>): Team | null => {
  if (!playerId) return null
  const name = playerMap[playerId]?.name ?? 'TBD'
  return { name, logo: logoForName(name) }
}

const toMatch = (tie: KnockoutTie, playerMap: Record<string, { name: string }>): Match => ({
  id: tie.id,
  team1: toTeam(tie.playerAId, playerMap),
  team2: toTeam(tie.playerBId, playerMap),
  winner: toTeam(tie.winnerId, playerMap),
})

const splitRound = (ties: KnockoutTie[]) => {
  const splitAt = Math.ceil(ties.length / 2)
  return {
    left: ties.slice(0, splitAt),
    right: ties.slice(splitAt),
  }
}

// Keep geometry constants synced with rendered match card dimensions from CSS.
const CONNECTOR_CARD_HEIGHT = 91
const CONNECTOR_GAP = 12
const CONNECTOR_LABEL_HEIGHT = 22
const CONNECTOR_WIDTH = 30

const buildCenters = (count: number, paddingTop: number, gap: number) =>
  Array.from({ length: Math.max(0, count) }, (_, index) =>
    CONNECTOR_LABEL_HEIGHT + paddingTop + CONNECTOR_CARD_HEIGHT / 2 + index * (CONNECTOR_CARD_HEIGHT + gap),
  )

const pairMidCenters = (centers: number[]) => {
  const mids: number[] = []
  for (let index = 0; index < centers.length; index += 2) {
    const first = centers[index]
    const second = centers[index + 1]
    if (second === undefined) {
      mids.push(first)
    } else {
      mids.push((first + second) / 2)
    }
  }
  return mids
}

const deriveColumnLayout = (targetCenters: number[], count: number) => {
  if (count <= 0) {
    return {
      paddingTop: 0,
      gap: CONNECTOR_GAP,
      centers: [] as number[],
    }
  }

  const firstTarget = targetCenters[0] ?? CONNECTOR_LABEL_HEIGHT + CONNECTOR_CARD_HEIGHT / 2
  const paddingTop = Math.max(
    0,
    Math.round(firstTarget - (CONNECTOR_LABEL_HEIGHT + CONNECTOR_CARD_HEIGHT / 2)),
  )

  const gap =
    count > 1 && targetCenters[1] !== undefined
      ? Math.max(8, Math.round(targetCenters[1] - targetCenters[0] - CONNECTOR_CARD_HEIGHT))
      : CONNECTOR_GAP

  return {
    paddingTop,
    gap,
    centers: buildCenters(count, paddingTop, gap),
  }
}

const buildSideGeometry = (r16Count: number, qfCount: number, sfCount: number) => {
  const r16Centers = buildCenters(r16Count, 0, CONNECTOR_GAP)
  const qfTargetCenters = pairMidCenters(r16Centers)
  const qf = deriveColumnLayout(qfTargetCenters, qfCount)
  const sfTargetCenters = pairMidCenters(qf.centers)
  const sf = deriveColumnLayout(sfTargetCenters, sfCount)

  return {
    r16Centers,
    qf,
    sf,
  }
}

export const KnockoutPage = () => {
  const { state } = useTournament()
  const playerMap = usePlayerMap()
  const tournamentName = state.settings.tournamentName?.trim() || 'TechStorm Tournament'

  const roundMap = useMemo(() => {
    const r16 = state.knockout.rounds.find((round) => /round of 16|r16/i.test(round.name))
    const qf = state.knockout.rounds.find((round) => /quarter|qf/i.test(round.name))
    const sf = state.knockout.rounds.find((round) => /semi|sf/i.test(round.name))

    const fallbackR16 = state.knockout.rounds[0]
    const fallbackQf = state.knockout.rounds[1]
    const fallbackSf = state.knockout.rounds[2]

    return {
      r16: r16 ?? fallbackR16,
      qf: qf ?? fallbackQf,
      sf: sf ?? fallbackSf,
    }
  }, [state.knockout.rounds])

  const leftR16 = useMemo(
    () => (roundMap.r16 ? splitRound(roundMap.r16.ties).left.map((tie) => toMatch(tie, playerMap)) : []),
    [roundMap.r16, playerMap],
  )
  const rightR16 = useMemo(
    () => (roundMap.r16 ? splitRound(roundMap.r16.ties).right.map((tie) => toMatch(tie, playerMap)) : []),
    [roundMap.r16, playerMap],
  )
  const leftQF = useMemo(
    () => (roundMap.qf ? splitRound(roundMap.qf.ties).left.map((tie) => toMatch(tie, playerMap)) : []),
    [roundMap.qf, playerMap],
  )
  const rightQF = useMemo(
    () => (roundMap.qf ? splitRound(roundMap.qf.ties).right.map((tie) => toMatch(tie, playerMap)) : []),
    [roundMap.qf, playerMap],
  )
  const leftSF = useMemo(
    () => (roundMap.sf ? splitRound(roundMap.sf.ties).left.map((tie) => toMatch(tie, playerMap)) : []),
    [roundMap.sf, playerMap],
  )
  const rightSF = useMemo(
    () => (roundMap.sf ? splitRound(roundMap.sf.ties).right.map((tie) => toMatch(tie, playerMap)) : []),
    [roundMap.sf, playerMap],
  )

  const finalMatch = useMemo<Match>(() => {
    const finalSeries = state.knockout.finalSeries
    if (!finalSeries) {
      return {
        id: 'final',
        team1: null,
        team2: null,
        winner: null,
      }
    }

    return {
      id: 'final',
      team1: toTeam(finalSeries.player1Id, playerMap),
      team2: toTeam(finalSeries.player2Id, playerMap),
      winner: toTeam(finalSeries.championId, playerMap),
    }
  }, [state.knockout.finalSeries, playerMap])

  const champion = useMemo(() => toTeam(state.championId, playerMap), [state.championId, playerMap])

  const leftGeometry = useMemo(
    () => buildSideGeometry(leftR16.length, leftQF.length, leftSF.length),
    [leftR16.length, leftQF.length, leftSF.length],
  )

  const rightGeometry = useMemo(
    () => buildSideGeometry(rightR16.length, rightQF.length, rightSF.length),
    [rightR16.length, rightQF.length, rightSF.length],
  )

  const leftFinalArrowTop = Math.max(0, Math.round((leftGeometry.sf.centers[0] ?? 160) - 20))
  const rightFinalArrowTop = Math.max(0, Math.round((rightGeometry.sf.centers[0] ?? 160) - 20))

  if (!state.knockout.enabled) {
    return (
      <section className="panel">
        <p className="text-sm text-zinc-300">Knockout bracket has not been generated yet.</p>
      </section>
    )
  }

  return (
    <section className="ucl-bracket-page">
      <div className="ucl-title-block">
        <div className="ucl-stars">* * * * *</div>
        <div className="ucl-road-to">{tournamentName}</div>
        <div className="ucl-city-name">
          KNOCKOUT <span>ARENA</span>
        </div>
        <div className="ucl-subtitle">FC Mobile Elimination Bracket</div>
      </div>

      <div className="ucl-bracket-wrapper">
        <div className="ucl-side-shell left">
          <div className="ucl-side left">
          <div className="ucl-round-col">
            <div className="ucl-round-label">Round of 16</div>
            {leftR16.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>

          <SVGConnectorBetweenRounds sourceCenters={leftGeometry.r16Centers} />

          <div
            className="ucl-round-col ucl-qf-col"
            style={{
              paddingTop: `${leftGeometry.qf.paddingTop}px`,
              paddingBottom: `${leftGeometry.qf.paddingTop}px`,
              gap: `${leftGeometry.qf.gap}px`,
            }}
          >
            <div className="ucl-round-label">QF</div>
            {leftQF.map((match) => (
              <MatchCard key={match.id} match={match} small />
            ))}
          </div>

          <SVGConnectorBetweenRounds sourceCenters={leftGeometry.qf.centers} />

          <div
            className="ucl-round-col ucl-sf-col"
            style={{
              paddingTop: `${leftGeometry.sf.paddingTop}px`,
              paddingBottom: `${leftGeometry.sf.paddingTop}px`,
              gap: `${leftGeometry.sf.gap}px`,
            }}
          >
            <div className="ucl-round-label">SF</div>
            {leftSF.map((match) => (
              <MatchCard key={match.id} match={match} small />
            ))}
          </div>

          <div className="ucl-final-arm" aria-hidden style={{ paddingTop: `${leftFinalArrowTop}px` }}>
            <svg width="24" height="40">
              <line x1="0" y1="20" x2="18" y2="20" stroke="currentColor" strokeWidth="2" />
              <polyline points="14,14 22,20 14,26" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          </div>
        </div>

        <div className="ucl-center-block">
          <div className="ucl-round-label ucl-final-label">Final</div>
          <div className="ucl-trophy-wrap" aria-hidden>
            🏆
          </div>
          <div className="ucl-final-match-card">
            <TeamRow
              team={finalMatch.team1}
              isWinner={!!finalMatch.winner && finalMatch.winner?.name === finalMatch.team1?.name}
            />
            <div className="ucl-match-divider" />
            <TeamRow
              team={finalMatch.team2}
              isWinner={!!finalMatch.winner && finalMatch.winner?.name === finalMatch.team2?.name}
            />
          </div>
        </div>

        <div className="ucl-side-shell right">
          <div className="ucl-side right">
          <div className="ucl-round-col">
            <div className="ucl-round-label">Round of 16</div>
            {rightR16.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>

          <SVGConnectorBetweenRounds sourceCenters={rightGeometry.r16Centers} flip />

          <div
            className="ucl-round-col ucl-qf-col"
            style={{
              paddingTop: `${rightGeometry.qf.paddingTop}px`,
              paddingBottom: `${rightGeometry.qf.paddingTop}px`,
              gap: `${rightGeometry.qf.gap}px`,
            }}
          >
            <div className="ucl-round-label">QF</div>
            {rightQF.map((match) => (
              <MatchCard key={match.id} match={match} small />
            ))}
          </div>

          <SVGConnectorBetweenRounds sourceCenters={rightGeometry.qf.centers} flip />

          <div
            className="ucl-round-col ucl-sf-col"
            style={{
              paddingTop: `${rightGeometry.sf.paddingTop}px`,
              paddingBottom: `${rightGeometry.sf.paddingTop}px`,
              gap: `${rightGeometry.sf.gap}px`,
            }}
          >
            <div className="ucl-round-label">SF</div>
            {rightSF.map((match) => (
              <MatchCard key={match.id} match={match} small />
            ))}
          </div>

          <div className="ucl-final-arm" aria-hidden style={{ paddingTop: `${rightFinalArrowTop}px` }}>
            <svg width="24" height="40">
              <line x1="6" y1="20" x2="24" y2="20" stroke="currentColor" strokeWidth="2" />
              <polyline points="10,14 2,20 10,26" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </div>
          </div>
        </div>
      </div>

      {champion && (
        <div className="ucl-champion-banner">
          <div className="ucl-champion-label">TechStorm Champion</div>
          <div className="ucl-champion-name">{champion.name}</div>
        </div>
      )}

      <div className="ucl-note-tag">Home and Away Legs | Decider if required</div>
    </section>
  )
}

function TeamRow({ team, isWinner }: { team: Team | null; isWinner: boolean }) {
  if (!team) {
    return (
      <div className="ucl-team-row empty">
        <span className="ucl-team-name tbd">TBD</span>
      </div>
    )
  }

  const overflowChars = Math.max(0, team.name.length - 16)
  const computedFontSize = Math.max(6.6, 10.4 - overflowChars * 0.24)
  const computedLetterSpacing = computedFontSize <= 8.2 ? 0 : 0.2

  return (
    <div className={`ucl-team-row${isWinner ? ' winner' : ''}`}>
      <span className="ucl-team-logo">{team.logo}</span>
      <span
        className="ucl-team-name"
        style={{
          fontSize: `${computedFontSize}px`,
          letterSpacing: `${computedLetterSpacing}px`,
        }}
        title={team.name}
      >
        {team.name}
      </span>
      {isWinner && <span className="ucl-check">✓</span>}
    </div>
  )
}

function MatchCard({ match, small }: { match: Match; small?: boolean }) {
  return (
    <div className={`ucl-match-card${small ? ' small' : ''}`}>
      <TeamRow
        team={match.team1}
        isWinner={!!match.winner && match.winner?.name === match.team1?.name}
      />
      <div className="ucl-match-divider" />
      <TeamRow
        team={match.team2}
        isWinner={!!match.winner && match.winner?.name === match.team2?.name}
      />
    </div>
  )
}

function SVGConnectorBetweenRounds({ sourceCenters, flip }: { sourceCenters: number[]; flip?: boolean }) {
  if (!sourceCenters.length) {
    return <div className="ucl-connector-lane" style={{ width: `${CONNECTOR_WIDTH}px` }} aria-hidden />
  }

  const total = Math.max(120, Math.ceil(sourceCenters[sourceCenters.length - 1] + CONNECTOR_CARD_HEIGHT / 2 + 8))
  const pairs = Math.max(1, Math.ceil(sourceCenters.length / 2))
  const w = CONNECTOR_WIDTH
  const color = '#cc4dff'

  return (
    <div className="ucl-connector-lane" style={{ width: `${w}px` }} aria-hidden>
      <svg width={w} height={total} style={{ overflow: 'hidden', flexShrink: 0 }}>
        {Array.from({ length: pairs }).map((_, pair) => {
          const first = sourceCenters[pair * 2]
          if (first === undefined) return null

          const second = sourceCenters[pair * 2 + 1]
          const hasSecond = second !== undefined
          const clampedSecond = hasSecond ? Math.min(total - 8, second as number) : first
          const mid = (first + clampedSecond) / 2
          const x1 = flip ? w : 0
          const x2 = flip ? 0 : w

          return (
            <g key={pair}>
              <line x1={x1} y1={first} x2={w / 2} y2={first} stroke={color} strokeWidth="1.5" />
              {hasSecond && (
                <line x1={x1} y1={clampedSecond} x2={w / 2} y2={clampedSecond} stroke={color} strokeWidth="1.5" />
              )}
              {hasSecond && (
                <line x1={w / 2} y1={first} x2={w / 2} y2={clampedSecond} stroke={color} strokeWidth="1.5" />
              )}
              <line x1={w / 2} y1={mid} x2={x2} y2={mid} stroke={color} strokeWidth="1.5" />
              <polyline
                points={
                  flip
                    ? `4,${mid - 3} 1,${mid} 4,${mid + 3}`
                    : `${w - 4},${mid - 3} ${w - 1},${mid} ${w - 4},${mid + 3}`
                }
                fill="none"
                stroke={color}
                strokeWidth="1.5"
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}
