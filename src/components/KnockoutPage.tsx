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

/* ────────────────────────────────────────────
   Geometry engine — calculates vertical positions
   for match cards and SVG connectors.
   Card height = 69px (two 33px rows + 1px divider + 2px padding)
   ──────────────────────────────────────────── */

const CARD_H = 69 // actual rendered height of .ucl-match-card
const GAP = 14 // gap between cards in a round column
const LABEL_H = 26 // round-label height + margin

/** Compute vertical centers for N cards stacked with a given gap, offset by paddingTop */
const cardCenters = (count: number, paddingTop: number, gap: number): number[] =>
  Array.from({ length: Math.max(0, count) }, (_, i) =>
    LABEL_H + paddingTop + CARD_H / 2 + i * (CARD_H + gap),
  )

/** Find the midpoint of each pair of source centers (for next-round alignment) */
const pairMids = (centers: number[]): number[] => {
  const mids: number[] = []
  for (let i = 0; i < centers.length; i += 2) {
    const a = centers[i]
    const b = centers[i + 1]
    mids.push(b !== undefined ? (a + b) / 2 : a)
  }
  return mids
}

/** Derive paddingTop + gap required to align `count` cards to the given target centers */
const alignToTargets = (targets: number[], count: number) => {
  if (count <= 0) return { pt: 0, gap: GAP, centers: [] as number[] }

  const first = targets[0] ?? LABEL_H + CARD_H / 2
  const pt = Math.max(0, Math.round(first - (LABEL_H + CARD_H / 2)))

  const gap =
    count > 1 && targets[1] !== undefined
      ? Math.max(8, Math.round(targets[1] - targets[0] - CARD_H))
      : GAP

  return { pt, gap, centers: cardCenters(count, pt, gap) }
}

/** Build geometry for an entire bracket side (R16 → QF → SF) */
const buildSide = (r16n: number, qfn: number, sfn: number) => {
  const r16 = cardCenters(r16n, 0, GAP)
  const qf = alignToTargets(pairMids(r16), qfn)
  const sf = alignToTargets(pairMids(qf.centers), sfn)
  return { r16, qf, sf }
}

/* ────────────────────────────────────────────
   SVG Connector
   Draws bracket lines between rounds
   ──────────────────────────────────────────── */

const CONN_W = 28
const CONN_COLOR = 'rgba(168,85,247,0.35)'

function SVGConnector({ sourceCenters, flip }: { sourceCenters: number[]; flip?: boolean }) {
  if (!sourceCenters.length)
    return <div style={{ width: CONN_W, flexShrink: 0 }} aria-hidden />

  const maxY = sourceCenters[sourceCenters.length - 1] + CARD_H / 2 + 8
  const svgH = Math.max(120, Math.ceil(maxY))
  const w = CONN_W

  const pairs = Math.max(1, Math.ceil(sourceCenters.length / 2))

  return (
    <div style={{ width: w, flexShrink: 0 }} aria-hidden>
      <svg width={w} height={svgH} style={{ overflow: 'visible' }}>
        {Array.from({ length: pairs }).map((_, p) => {
          const a = sourceCenters[p * 2]
          if (a === undefined) return null
          const b = sourceCenters[p * 2 + 1]
          const hasB = b !== undefined
          const bClamped = hasB ? Math.min(svgH - 4, b as number) : a
          const mid = (a + bClamped) / 2

          const x1 = flip ? w : 0
          const x2 = flip ? 0 : w

          return (
            <g key={p}>
              {/* horizontal from source card */}
              <line x1={x1} y1={a} x2={w / 2} y2={a} stroke={CONN_COLOR} strokeWidth="1.5" />
              {hasB && (
                <line x1={x1} y1={bClamped} x2={w / 2} y2={bClamped} stroke={CONN_COLOR} strokeWidth="1.5" />
              )}
              {/* vertical stem */}
              {hasB && (
                <line x1={w / 2} y1={a} x2={w / 2} y2={bClamped} stroke={CONN_COLOR} strokeWidth="1.5" />
              )}
              {/* horizontal to target card */}
              <line x1={w / 2} y1={mid} x2={x2} y2={mid} stroke={CONN_COLOR} strokeWidth="1.5" />
              {/* arrowhead */}
              <polyline
                points={
                  flip
                    ? `4,${mid - 3} 1,${mid} 4,${mid + 3}`
                    : `${w - 4},${mid - 3} ${w - 1},${mid} ${w - 4},${mid + 3}`
                }
                fill="none"
                stroke={CONN_COLOR}
                strokeWidth="1.5"
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ────────────────────────────────────────────
   Component: Team Row
   ──────────────────────────────────────────── */

function TeamRow({ team, isWinner }: { team: Team | null; isWinner: boolean }) {
  if (!team) {
    return (
      <div className="ucl-team-row empty">
        <span className="ucl-team-name tbd">TBD</span>
      </div>
    )
  }

  // dynamic sizing for long names
  const over = Math.max(0, team.name.length - 14)
  const fontSize = Math.max(7, 10.5 - over * 0.25)
  const ls = fontSize <= 8.2 ? 0 : 0.3

  return (
    <div className={`ucl-team-row${isWinner ? ' winner' : ''}`}>
      <span className="ucl-team-logo">{team.logo}</span>
      <span
        className="ucl-team-name"
        style={{ fontSize: `${fontSize}px`, letterSpacing: `${ls}px` }}
        title={team.name}
      >
        {team.name}
      </span>
      {isWinner && <span className="ucl-check">✓</span>}
    </div>
  )
}

/* ────────────────────────────────────────────
   Component: Match Card
   ──────────────────────────────────────────── */

function MatchCard({ match, small }: { match: Match; small?: boolean }) {
  return (
    <div className={`ucl-match-card${small ? ' small' : ''}`}>
      <TeamRow
        team={match.team1}
        isWinner={!!match.winner && match.winner.name === match.team1?.name}
      />
      <div className="ucl-match-divider" />
      <TeamRow
        team={match.team2}
        isWinner={!!match.winner && match.winner.name === match.team2?.name}
      />
    </div>
  )
}

/* ────────────────────────────────────────────
   Component: RoundColumn
   Renders a round label + stacked match cards
   ──────────────────────────────────────────── */

function RoundColumn({
  label,
  matches,
  small,
  paddingTop = 0,
  gap = GAP,
  className = '',
}: {
  label: string
  matches: Match[]
  small?: boolean
  paddingTop?: number
  gap?: number
  className?: string
}) {
  return (
    <div
      className={`ucl-round-col ${className}`}
      style={{ paddingTop: `${paddingTop}px`, gap: `${gap}px` }}
    >
      <div className="ucl-round-label">{label}</div>
      {matches.map((m) => (
        <MatchCard key={m.id} match={m} small={small} />
      ))}
    </div>
  )
}

/* ────────────────────────────────────────────
   Component: BracketSide
   One side of the bracket (left or right)
   ──────────────────────────────────────────── */

function BracketSide({
  r16,
  qf,
  sf,
  side,
}: {
  r16: Match[]
  qf: Match[]
  sf: Match[]
  side: 'left' | 'right'
}) {
  const geo = useMemo(() => buildSide(r16.length, qf.length, sf.length), [r16.length, qf.length, sf.length])
  const isRight = side === 'right'

  // The final arm arrow points inward
  const arrowTop = Math.max(0, Math.round((geo.sf.centers[0] ?? 100) - 20))

  const columns = [
    // R16 column
    r16.length > 0 && (
      <RoundColumn key="r16" label="Round of 16" matches={r16} gap={GAP} />
    ),
    // R16→QF connector
    r16.length > 0 && (
      <SVGConnector key="r16-qf" sourceCenters={geo.r16} flip={isRight} />
    ),
    // QF column
    qf.length > 0 && (
      <RoundColumn key="qf" label="QF" matches={qf} small paddingTop={geo.qf.pt} gap={geo.qf.gap} />
    ),
    // QF→SF connector
    qf.length > 0 && (
      <SVGConnector key="qf-sf" sourceCenters={geo.qf.centers} flip={isRight} />
    ),
    // SF column
    sf.length > 0 && (
      <RoundColumn key="sf" label="SF" matches={sf} small paddingTop={geo.sf.pt} gap={geo.sf.gap} />
    ),
    // Final arm
    <div key="arm" className="ucl-final-arm" aria-hidden style={{ paddingTop: `${arrowTop}px` }}>
      <svg width="22" height="40">
        {isRight ? (
          <>
            <line x1="6" y1="20" x2="22" y2="20" stroke="currentColor" strokeWidth="1.5" />
            <polyline points="10,15 3,20 10,25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </>
        ) : (
          <>
            <line x1="0" y1="20" x2="16" y2="20" stroke="currentColor" strokeWidth="1.5" />
            <polyline points="12,15 19,20 12,25" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </>
        )}
      </svg>
    </div>,
  ]

  return (
    <div className={`ucl-side-shell ${side}`}>
      <div className={`ucl-side ${side}`}>
        {isRight ? columns.filter(Boolean).reverse() : columns.filter(Boolean)}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────
   Main component
   ──────────────────────────────────────────── */

export const KnockoutPage = () => {
  const { state } = useTournament()
  const playerMap = usePlayerMap()
  const tournamentName = state.settings.tournamentName?.trim() || 'TechStorm Tournament'

  // ─── Identify rounds ───
  const roundMap = useMemo(() => {
    const r16 = state.knockout.rounds.find((r) => /round of 16|r16/i.test(r.name))
    const qf = state.knockout.rounds.find((r) => /quarter|qf/i.test(r.name))
    const sf = state.knockout.rounds.find((r) => /semi|sf/i.test(r.name))
    return {
      r16: r16 ?? state.knockout.rounds[0],
      qf: qf ?? state.knockout.rounds[1],
      sf: sf ?? state.knockout.rounds[2],
    }
  }, [state.knockout.rounds])

  // ─── Split each round into left/right halves ───
  const leftR16 = useMemo(
    () => (roundMap.r16 ? splitRound(roundMap.r16.ties).left.map((t) => toMatch(t, playerMap)) : []),
    [roundMap.r16, playerMap],
  )
  const rightR16 = useMemo(
    () => (roundMap.r16 ? splitRound(roundMap.r16.ties).right.map((t) => toMatch(t, playerMap)) : []),
    [roundMap.r16, playerMap],
  )
  const leftQF = useMemo(
    () => (roundMap.qf ? splitRound(roundMap.qf.ties).left.map((t) => toMatch(t, playerMap)) : []),
    [roundMap.qf, playerMap],
  )
  const rightQF = useMemo(
    () => (roundMap.qf ? splitRound(roundMap.qf.ties).right.map((t) => toMatch(t, playerMap)) : []),
    [roundMap.qf, playerMap],
  )
  const leftSF = useMemo(
    () => (roundMap.sf ? splitRound(roundMap.sf.ties).left.map((t) => toMatch(t, playerMap)) : []),
    [roundMap.sf, playerMap],
  )
  const rightSF = useMemo(
    () => (roundMap.sf ? splitRound(roundMap.sf.ties).right.map((t) => toMatch(t, playerMap)) : []),
    [roundMap.sf, playerMap],
  )

  // ─── Final match ───
  const finalMatch = useMemo<Match>(() => {
    const fs = state.knockout.finalSeries
    if (!fs) return { id: 'final', team1: null, team2: null, winner: null }
    return {
      id: 'final',
      team1: toTeam(fs.player1Id, playerMap),
      team2: toTeam(fs.player2Id, playerMap),
      winner: toTeam(fs.championId, playerMap),
    }
  }, [state.knockout.finalSeries, playerMap])

  const champion = useMemo(() => toTeam(state.championId, playerMap), [state.championId, playerMap])

  // ─── Empty state ───
  if (!state.knockout.enabled) {
    return (
      <section className="panel">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Knockout bracket has not been generated yet.
        </p>
      </section>
    )
  }

  return (
    <section className="ucl-bracket-page">
      {/* Title */}
      <div className="ucl-title-block">
        <div className="ucl-stars">✦ ✦ ✦ ✦ ✦</div>
        <div className="ucl-road-to">{tournamentName}</div>
        <div className="ucl-city-name">
          KNOCKOUT <span>ARENA</span>
        </div>
        <div className="ucl-subtitle">FC Mobile Elimination Bracket</div>
      </div>

      {/* Bracket */}
      <div className="ucl-bracket-wrapper">
        <BracketSide r16={leftR16} qf={leftQF} sf={leftSF} side="left" />

        <div className="ucl-center-block">
          <div className="ucl-round-label ucl-final-label">Final</div>
          <div className="ucl-trophy-wrap" aria-hidden>🏆</div>
          <div className="ucl-final-match-card">
            <TeamRow
              team={finalMatch.team1}
              isWinner={!!finalMatch.winner && finalMatch.winner.name === finalMatch.team1?.name}
            />
            <div className="ucl-match-divider" />
            <TeamRow
              team={finalMatch.team2}
              isWinner={!!finalMatch.winner && finalMatch.winner.name === finalMatch.team2?.name}
            />
          </div>
        </div>

        <BracketSide r16={rightR16} qf={rightQF} sf={rightSF} side="right" />
      </div>

      {/* Champion banner */}
      {champion && (
        <div className="ucl-champion-banner">
          <div className="ucl-champion-label">TechStorm Champion</div>
          <div className="ucl-champion-name">{champion.name}</div>
        </div>
      )}

      <div className="ucl-note-tag">Home and Away Legs • Decider if required</div>
    </section>
  )
}
