import { useCallback, useMemo } from 'react'
import { usePlayerMap, useTournament } from '../context/TournamentContext'
import type { KnockoutTie } from '../types'

/*  Types  */
type Team = { name: string; logo: string }
type Match = { id: string; team1: Team | null; team2: Team | null; winner: Team | null; aggregate: string | null }
type RoundSlice = { ties: KnockoutTie[] } | null | undefined

const LOGOS: Record<string, string> = {
  PARIS: '🔵', CHELSEA: '🔵', LIVERPOOL: '🔴', 'REAL MADRID': '⚪',
  'MAN CITY': '🔵', ATALANTA: '⚫', 'BAYERN MÜNCHEN': '🔴', NEWCASTLE: '⚫',
  BARCELONA: '🔴', ATLETI: '🔴', TOTTENHAM: '⚪', ARSENAL: '🔴',
  JUVENTUS: '⚫', GALATASARAY: '🟡', 'SPORTING CP': '🟢', LEVERKUSEN: '🔴',
}

const logoFor = (n: string) => LOGOS[n.toUpperCase()] ?? '⚽'
const toTeam = (id: string | null, pm: Record<string, { name: string }>): Team | null => {
  if (!id) return null
  const player = pm[id]
  if (!player) return null
  const name = player.name
  return { name, logo: logoFor(name) }
}
const toMatch = (tie: KnockoutTie, pm: Record<string, { name: string }>): Match => ({
  id: tie.id,
  team1: toTeam(tie.playerAId, pm),
  team2: toTeam(tie.playerBId, pm),
  winner: toTeam(tie.winnerId, pm),
  aggregate: getAggregateScore(tie),
})

const getAggregateScore = (tie: KnockoutTie): string | null => {
  const { leg1, leg2 } = tie

  if (
    !leg1.completed ||
    !leg2.completed ||
    leg1.homeGoals === null ||
    leg1.awayGoals === null ||
    leg2.homeGoals === null ||
    leg2.awayGoals === null
  ) {
    return null
  }

  const aggregateA = leg1.homeGoals + leg2.awayGoals
  const aggregateB = leg1.awayGoals + leg2.homeGoals

  return `${aggregateA}-${aggregateB}`
}
const splitHalf = (ties: KnockoutTie[]) => {
  const mid = Math.ceil(ties.length / 2)
  return { left: ties.slice(0, mid), right: ties.slice(mid) }
}

/* """"""""""""""""""""""""""""""""""""""""""""""""""""""
   GEOMETRY
   """"""""""""""""""""""""""""""""""""""""""""""""""""""
   ROW_H  = height of a single team slot
   PAIR_H = height of a match pair (2 rows + 1px divider)
   GAP    = gap between pairs in the R16 column
   LABEL_H= height reserved for the round label above the pairs

   Y-origin for each column is the TOP of the column div.
   The connector line for a pair exits at the DIVIDER line
   between its two team rows, i.e. at:
     topPad + LABEL_H + ROW_H + pairIndex * (PAIR_H + gap)
   """""""""""""""""""""""""""""""""""""""""""""""""""""" */
const ROW_H   = 32    // px  single team slot height
const PAIR_H  = ROW_H * 2 + 1  // 65px  two rows + 1px divider
const GAP     = 12   // px  gap between R16 pairs
const LABEL_H = 20   // px  round label height
const CONN_W  = 20   // px  connector SVG width

/** Y positions of the connector point (divider) for each pair in a round column. */
const pairCenters = (n: number, topPad: number, gap: number): number[] =>
  Array.from({ length: Math.max(0, n) }, (_, i) =>
    LABEL_H + topPad + ROW_H + i * (PAIR_H + gap)
  )

/** For every consecutive pair of centers, compute their average (next-round target). */
const pairMids = (cs: number[]): number[] => {
  const out: number[] = []
  for (let i = 0; i < cs.length; i += 2) {
    const b = cs[i + 1]
    out.push(b !== undefined ? (cs[i] + b) / 2 : cs[i])
  }
  return out
}

/** Align `n` pairs so their connector points land on `targets`. */
const alignTo = (targets: number[], n: number) => {
  if (n <= 0 || targets.length === 0) return { topPad: 0, gap: GAP, cs: [] as number[] }
  // LABEL_H + topPad + ROW_H = targets[0]     topPad = targets[0] - LABEL_H - ROW_H
  const topPad = Math.max(0, Math.round(targets[0] - LABEL_H - ROW_H))
  const gap = n > 1 && targets[1] !== undefined
    ? Math.max(8, Math.round(targets[1] - targets[0] - PAIR_H))
    : GAP
  return { topPad, gap, cs: pairCenters(n, topPad, gap) }
}

/** Build geometry for all rounds on one side (can be 3 or 4 rounds). */
const buildSide = (n0: number, n1: number, n2: number, n3: number = 0) => {
  const cs0 = pairCenters(n0, 0, GAP)
  const a1  = alignTo(pairMids(cs0), n1)
  const a2  = alignTo(pairMids(a1.cs), n2)
  const a3  = n3 > 0 ? alignTo(pairMids(a2.cs), n3) : { topPad: 0, gap: GAP, cs: [] as number[] }
  return { cs0, a1, a2, a3 }
}

/* """"""""""""""""""""""""""""""""""""""""""""""""""""""
   BRACKET CONNECTOR
   Draws strict L-shaped right-angle lines:
     ⬢ Horizontal from the card column edge   vertical bar
     ⬢ Single vertical bar connecting pair A and pair B
     ⬢ Horizontal from vertical bar midpoint   next round
   `srcs`  = Y positions of each pair's connector point
   `flip`  = true for right half (lines drawn right left)
   """""""""""""""""""""""""""""""""""""""""""""""""""""" */
const LINE = 'rgba(245, 184, 0,0.6)'

function BracketConnector({ srcs, flip }: { srcs: number[]; flip?: boolean }) {
  if (!srcs.length) return <div style={{ width: CONN_W, flexShrink: 0 }} aria-hidden />

  const h = Math.max(100, Math.ceil(srcs[srcs.length - 1] + ROW_H + 16))
  const w = CONN_W
  const pairs = Math.ceil(srcs.length / 2)

  // Shared X coordinates for all pairs in this connector
  const xCard = flip ? w : 0   // edge that touches the card column
  const xNext = flip ? 0 : w   // edge that touches the next-round column
  const xBar  = w / 2          // X of the single shared vertical bar

  return (
    <div style={{ width: w, flexShrink: 0, alignSelf: 'flex-start' }} aria-hidden>
      <svg width={w} height={h} overflow="visible">
        {Array.from({ length: pairs }).map((_, p) => {
          const yA = srcs[p * 2]        // connector Y of pair A
          if (yA === undefined) return null
          const yB   = srcs[p * 2 + 1] // connector Y of pair B (may be undefined)
          const hasB = yB !== undefined
          const yMid = hasB ? (yA + yB) / 2 : yA

          return (
            <g key={p} strokeLinecap="square" fill="none">
              {/*  Horizontal in  pair A */}
              <line x1={xCard} y1={yA}   x2={xBar}  y2={yA}   stroke={LINE} strokeWidth="1.5" />
              {/*  Horizontal in  pair B */}
              {hasB && <line x1={xCard} y1={yB}   x2={xBar}  y2={yB}   stroke={LINE} strokeWidth="1.5" />}
              {/*  Vertical bar joining A and B */}
              {hasB && <line x1={xBar}  y1={yA}   x2={xBar}  y2={yB}   stroke={LINE} strokeWidth="1.5" />}
              {/*  Horizontal out  from midpoint of vertical bar */}
              <line x1={xBar}  y1={yMid} x2={xNext} y2={yMid} stroke={LINE} strokeWidth="1.5" />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/*  Final Box - Match display with Final label  */
function FinalBox({ match }: { match: Match | null }) {
  const boxWidth = 160
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      {/* Trophy Emoji */}
      <div style={{ fontSize: '48px', marginBottom: '4px' }}>🏆</div>
      
      {/* Final Label */}
      <div style={{ marginBottom: '8px', fontSize: '16px', fontWeight: 700, color: '#F5B800', letterSpacing: '2px' }}>
        FINAL
      </div>
      
      {/* Match display box */}
      <div
        style={{
          width: `${boxWidth}px`,
          position: 'relative',
          background: 'linear-gradient(135deg, rgba(245, 184, 0,0.15) 0%, rgba(88,28,135,0.1) 100%)',
          border: '2px solid rgba(245, 184, 0,0.4)',
          borderRadius: '8px',
          overflow: 'hidden',
          boxShadow: '0 0 16px rgba(245, 184, 0,0.2)',
        }}
      >
        {match ? (
          <>
            <TeamRow team={match.team1} isWinner={!!match.winner && !!match.team1 && match.winner.name === match.team1.name} />
            <div className="bk-divider" />
            <TeamRow team={match.team2} isWinner={!!match.winner && !!match.team2 && match.winner.name === match.team2.name} />
          </>
        ) : (
          <>
            <div className="bk-row bk-row--empty">
              <span className="bk-logo bk-logo--ghost" aria-hidden>⬢</span>
              <span className="bk-name bk-name--tbd">TBD</span>
              <span className="bk-check bk-check--ghost" aria-hidden>✓</span>
            </div>
            <div className="bk-divider" />
            <div className="bk-row bk-row--empty">
              <span className="bk-logo bk-logo--ghost" aria-hidden>⬢</span>
              <span className="bk-name bk-name--tbd">TBD</span>
              <span className="bk-check bk-check--ghost" aria-hidden>✓</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/*  Unified final connection: left bridge + center arrow + right bridge all meeting at one point  */
function FinalConnection({ meetY, match }: { meetY: number; match: Match | null }) {
  const leftW = 32
  const centerW = 20
  const rightW = 32
  const totalW = leftW + centerW + rightW  // 84
  const arrowH = 50
  const finalBoxHeight = 180  // Trophy (52px) + label (24px) + match box (96px) + margins = 180px
  const h = Math.max(arrowH + finalBoxHeight + 20, Math.ceil(meetY + 20))
  
  const centerX = leftW + centerW / 2
  const arrowTipY = meetY - arrowH
  
  return (
    <div style={{ width: totalW, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', height: h }} aria-hidden={false}>
      <svg width={totalW} height={h} style={{ position: 'absolute', top: 0, left: 0 }} overflow="visible">
        {/* Left horizontal line extending to center */}
        <line
          x1={0} y1={meetY}
          x2={centerX} y2={meetY}
          stroke={LINE} strokeWidth="1.5" strokeLinecap="square"
        />
        
        {/* Right horizontal line extending from center */}
        <line
          x1={centerX} y1={meetY}
          x2={totalW} y2={meetY}
          stroke={LINE} strokeWidth="1.5" strokeLinecap="square"
        />
        
        {/* Vertical line pointing upward from meet point */}
        <line
          x1={centerX} y1={meetY}
          x2={centerX} y2={arrowTipY + 4}
          stroke={LINE} strokeWidth="2" strokeLinecap="round"
        />
        
        {/* Arrowhead at top */}
        <polygon
          points={`${centerX},${arrowTipY} ${centerX - 4},${arrowTipY + 8} ${centerX + 4},${arrowTipY + 8}`}
          fill={LINE}
        />
      </svg>
      
      {/* Final Box: bottom edge touches arrow tip */}
      <div
        style={{
          position: 'absolute',
          top: arrowTipY - finalBoxHeight + 5,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 10,
        }}
        aria-hidden={false}
      >
        <FinalBox match={match} />
      </div>
    </div>
  )
}

/*  Team Row  */
function TeamRow({ team, isWinner }: { team: Team | null; isWinner: boolean }) {
  if (!team) {
    return (
      <div className="bk-row bk-row--empty">
        <span className="bk-logo bk-logo--ghost" aria-hidden>⬢</span>
        <span className="bk-name bk-name--tbd">TBD</span>
        <span className="bk-check bk-check--ghost" aria-hidden>✓</span>
      </div>
    )
  }
  const over = Math.max(0, team.name.length - 16)
  const fs = Math.max(7.5, 10 - over * 0.2)

  return (
    <div className={`bk-row${isWinner ? ' bk-row--win' : ''}`}>
      <span className="bk-logo">{team.logo}</span>
      <span className="bk-name" style={{ fontSize: `${fs}px` }} title={team.name}>
        {team.name}
      </span>
      {isWinner && <span className="bk-check">✓</span>}
    </div>
  )
}

/* """"""""""""""""""""""""""""""""""""""""""""""""""""""
   MATCH PAIR
   Two bare team rows + divider. No outer border / background box.
   The `bk-pair` class controls only width.
   """""""""""""""""""""""""""""""""""""""""""""""""""""" */
function MatchPair({ match, size = 'md', label }: { match: Match; size?: 'sm' | 'md' | 'lg'; label?: string }) {
  const won = (t: Team | null) => !!match.winner && !!t && match.winner.name === t.name
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {label && <div className="bk-label" style={{ marginBottom: '4px' }}>{label}</div>}
      <div className={`bk-pair bk-pair--${size}`}>
        <TeamRow team={match.team1} isWinner={won(match.team1)} />
        <div className="bk-divider" />
        <TeamRow team={match.team2} isWinner={won(match.team2)} />
        {match.aggregate && <div className="bk-aggregate">{match.aggregate}</div>}
      </div>
    </div>
  )
}

/* """"""""""""""""""""""""""""""""""""""""""""""""""""""
   ROUND COLUMN
   Uses absolute positioning so every pair sits at the
   exact pixel row computed by the geometry functions.
   """""""""""""""""""""""""""""""""""""""""""""""""""""" */
function RoundCol({
  label, matches, size = 'md', topPad = 0, gap = GAP,
}: {
  label: string
  matches: Match[]
  size?: 'sm' | 'md' | 'lg'
  topPad?: number
  gap?: number
}) {
  const totalH =
    LABEL_H + topPad + matches.length * PAIR_H + Math.max(0, matches.length - 1) * gap

  return (
    <div className={`bk-col bk-col--${size}`} style={{ height: totalH }}>
      {/* Relative container so pairs can be absolutely positioned */}
      <div style={{ position: 'relative', height: totalH }}>
        {/* Label above first match */}
        <div style={{ position: 'absolute', top: topPad, left: 0, right: 0 }}>
          <div className="bk-label">{label}</div>
        </div>
        
        {matches.map((m, i) => (
          <div
            key={m.id}
            style={{
              position: 'absolute',
              top: LABEL_H + topPad + i * (PAIR_H + gap),
              left: 0,
              right: 0,
            }}
          >
            <MatchPair match={m} size={size} />
          </div>
        ))}
      </div>
    </div>
  )
}

/*  One half of the bracket  */
function BracketHalf({
  r0, r1, r2, r3 = [], side, hasR32 = false,
}: { r0: Match[]; r1: Match[]; r2: Match[]; r3?: Match[]; side: 'left' | 'right'; hasR32?: boolean }) {
  const geo  = useMemo(() => buildSide(r0.length, r1.length, r2.length, r3.length), [r0.length, r1.length, r2.length, r3.length])
  const flip = side === 'right'

  // Determine the round labels based on match count and whether R32 exists
  const getRoundLabel = (_matches: Match[], index: number) => {
    if (hasR32) {
      // 4-round bracket: R32   R16   QF   SF
      if (index === 0) return 'Round of 32'
      if (index === 1) return 'Round of 16'
      if (index === 2) return 'Quarter Final'
      if (index === 3) return 'Semi Final'
    } else {
      // 3-round bracket: R16   QF   SF
      if (index === 0) return 'Round of 16'
      if (index === 1) return 'Quarter Final'
      if (index === 2) return 'Semi Final'
    }
    return 'Final'
  }

  const cols: React.ReactNode[] = []

  if (r0.length > 0) {
    cols.push(
      <RoundCol
        key="r0"
        label={getRoundLabel(r0, 0)}
        matches={r0}
        size="md"
        topPad={0}
        gap={GAP}
      />
    )
    if (r1.length > 0 || r2.length > 0 || r3.length > 0) {
      cols.push(<BracketConnector key="c0" srcs={geo.cs0} flip={flip} />)
    }
  }

  if (r1.length > 0) {
    cols.push(
      <RoundCol
        key="r1"
        label={getRoundLabel(r1, 1)}
        matches={r1}
        size="sm"
        topPad={geo.a1.topPad}
        gap={geo.a1.gap}
      />
    )
    if (r2.length > 0 || r3.length > 0) {
      cols.push(<BracketConnector key="c1" srcs={geo.a1.cs} flip={flip} />)
    }
  }

  if (r2.length > 0) {
    cols.push(
      <RoundCol
        key="r2"
        label={getRoundLabel(r2, 2)}
        matches={r2}
        size="sm"
        topPad={geo.a2.topPad}
        gap={geo.a2.gap}
      />
    )
    if (r3.length > 0) {
      cols.push(<BracketConnector key="c2" srcs={geo.a2.cs} flip={flip} />)
    }
  }

  if (r3.length > 0) {
    cols.push(
      <RoundCol
        key="r3"
        label={getRoundLabel(r3, 3)}
        matches={r3}
        size="sm"
        topPad={geo.a3.topPad}
        gap={geo.a3.gap}
      />
    )
  }

  return (
    <div className="bk-half">
      {flip ? [...cols].reverse() : cols}
    </div>
  )
}


/*  Main Page  */
export const KnockoutPage = () => {
  const { state } = useTournament()
  const playerMap = usePlayerMap()
  const tournamentName = state.settings.tournamentName?.trim() || 'TechStorm EA FC Mobile Tournament'
  const knockoutDisabled = !state.knockout.enabled

  const roundMap = useMemo(() => {
    const r32 = state.knockout.rounds.find(r => /round of 32|r32/i.test(r.name))
    const r16 = state.knockout.rounds.find(r => /round of 16|r16/i.test(r.name))
    const qf  = state.knockout.rounds.find(r => /quarter|qf/i.test(r.name))
    const sf  = state.knockout.rounds.find(r => /semi|sf/i.test(r.name))
    return {
      r32: r32 ?? null,
      r16: r16 ?? state.knockout.rounds[0],
      qf:  qf  ?? state.knockout.rounds[1],
      sf:  sf  ?? state.knockout.rounds[2],
    }
  }, [state.knockout.rounds])

  const mk = useCallback((round: RoundSlice, half: 'left' | 'right'): Match[] => {
    if (!round) return []
    const { left, right } = splitHalf(round.ties)
    return (half === 'left' ? left : right).map(t => toMatch(t, playerMap))
  }, [playerMap])

  const leftR32  = useMemo(() => mk(roundMap.r32, 'left'),  [roundMap.r32, mk])
  const rightR32 = useMemo(() => mk(roundMap.r32, 'right'), [roundMap.r32, mk])
  const leftR16  = useMemo(() => mk(roundMap.r16, 'left'),  [roundMap.r16, mk])
  const rightR16 = useMemo(() => mk(roundMap.r16, 'right'), [roundMap.r16, mk])
  const leftQF   = useMemo(() => mk(roundMap.qf,  'left'),  [roundMap.qf, mk])
  const rightQF  = useMemo(() => mk(roundMap.qf,  'right'), [roundMap.qf, mk])
  const leftSF   = useMemo(() => mk(roundMap.sf,  'left'),  [roundMap.sf, mk])
  const rightSF  = useMemo(() => mk(roundMap.sf,  'right'), [roundMap.sf, mk])

  const champion = useMemo(() => toTeam(state.championId, playerMap), [state.championId, playerMap])

  const disabledView = (
      <section
        className="welcome-mascot-bg"
        style={{
          minHeight: 'calc(100vh - 120px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 'clamp(2rem, 4vw, 3rem)',
          textAlign: 'center',
        }}
      >
        <div style={{
          fontSize: 'clamp(14px, 2.5vw, 18px)',
          letterSpacing: '8px',
          color: 'rgba(245, 184, 0,0.45)',
          marginBottom: '12px',
        }}>✦ ✦ ✦</div>
        <h1 style={{
          fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
          fontSize: 'clamp(32px, 6vw, 52px)',
          fontWeight: 800,
          color: '#f0edf5',
          textShadow: '0 0 28px rgba(245, 184, 0, 0.18)',
          letterSpacing: '3px',
          lineHeight: 1.1,
          margin: '16px 0',
        }}>
          Welcome to <span style={{ color: '#F5B800', textShadow: '0 0 18px rgba(245, 184, 0,0.3)' }}>KNOCKOUT ARENA</span>
        </h1>
        <p style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: 'clamp(14px, 2vw, 16px)',
          letterSpacing: '2px',
          color: 'rgba(245, 184, 0,0.6)',
          margin: '16px 0 0 0',
        }}>
          The knockout bracket will appear here once generated in the Admin panel
        </p>
        <div style={{
          fontSize: 'clamp(14px, 2.5vw, 18px)',
          letterSpacing: '8px',
          color: 'rgba(245, 184, 0,0.45)',
          marginTop: '12px',
        }}>✦ ✦ ✦</div>
      </section>
    )

  const leftGeo = useMemo(
    () => buildSide(leftR32.length || leftR16.length, leftR32.length ? leftR16.length : leftQF.length, leftR32.length ? leftQF.length : leftSF.length, leftR32.length ? leftSF.length : 0),
    [leftR32.length, leftR16.length, leftQF.length, leftSF.length]
  )
  const rightGeo = useMemo(
    () => buildSide(rightR32.length || rightR16.length, rightR32.length ? rightR16.length : rightQF.length, rightR32.length ? rightQF.length : rightSF.length, rightR32.length ? rightSF.length : 0),
    [rightR32.length, rightR16.length, rightQF.length, rightSF.length]
  )

  const leftBridgeSrcY = useMemo(() => {
    if (leftR32.length > 0) {
      if (leftSF.length > 0) return pairMids(leftGeo.a3.cs)[0]
      if (leftQF.length > 0) return pairMids(leftGeo.a2.cs)[0]
      if (leftR16.length > 0) return pairMids(leftGeo.a1.cs)[0]
      return pairMids(leftGeo.cs0)[0]
    } else {
      if (leftSF.length > 0) return pairMids(leftGeo.a2.cs)[0]
      if (leftQF.length > 0) return pairMids(leftGeo.a1.cs)[0]
      return pairMids(leftGeo.cs0)[0]
    }
  }, [leftGeo, leftR32.length, leftR16.length, leftQF.length, leftSF.length])
  
  const rightBridgeSrcY = useMemo(() => {
    if (rightR32.length > 0) {
      if (rightSF.length > 0) return pairMids(rightGeo.a3.cs)[0]
      if (rightQF.length > 0) return pairMids(rightGeo.a2.cs)[0]
      if (rightR16.length > 0) return pairMids(rightGeo.a1.cs)[0]
      return pairMids(rightGeo.cs0)[0]
    } else {
      if (rightSF.length > 0) return pairMids(rightGeo.a2.cs)[0]
      if (rightQF.length > 0) return pairMids(rightGeo.a1.cs)[0]
      return pairMids(rightGeo.cs0)[0]
    }
  }, [rightGeo, rightR32.length, rightR16.length, rightQF.length, rightSF.length])

  const sharedFinalY = useMemo(() => {
    const ys = [leftBridgeSrcY, rightBridgeSrcY].filter((y): y is number => typeof y === 'number')
    if (!ys.length) return LABEL_H + ROW_H
    return ys.reduce((a, b) => a + b, 0) / ys.length
  }, [leftBridgeSrcY, rightBridgeSrcY])

  // Create final match from the two semifinal matches
  const finalMatch = useMemo(() => {
    const leftWinner = leftSF[0]?.winner || null
    const rightWinner = rightSF[0]?.winner || null
    const finalWinner = champion
    
    return {
      id: 'final',
      team1: leftWinner,
      team2: rightWinner,
      winner: finalWinner,
      aggregate: null,
    }
  }, [leftSF, rightSF, champion])

  if (knockoutDisabled) {
    return disabledView
  }

  return (
    <section className="bk-page">
      {/*  Title  */}
      <div className="bk-header">
        <div className="bk-stars">✦ ✦ ✦ ✦ ✦</div>
        <div className="bk-eyebrow">{tournamentName}</div>
        <div className="bk-title">KNOCKOUT <span>ARENA</span></div>
        <div className="bk-subtitle">FC Mobile Elimination Bracket</div>
      </div>

      {/*  Bracket  */}
      <div className="bk-scroll-wrap">
        <div className="bk-scroll-hint">↔ swipe to explore ↔</div>
        <div className="bk-bracket" style={{ minWidth: 'max-content', margin: '0 auto', position: 'relative' }}>
          <BracketHalf 
            r0={leftR32.length > 0 ? leftR32 : leftR16}  
            r1={leftR32.length > 0 ? leftR16 : leftQF}  
            r2={leftR32.length > 0 ? leftQF : leftSF}
            r3={leftR32.length > 0 ? leftSF : []}
            side="left"
            hasR32={leftR32.length > 0}
          />

          <FinalConnection meetY={sharedFinalY} match={finalMatch} />

          <BracketHalf 
            r0={rightR32.length > 0 ? rightR32 : rightR16} 
            r1={rightR32.length > 0 ? rightR16 : rightQF} 
            r2={rightR32.length > 0 ? rightQF : rightSF}
            r3={rightR32.length > 0 ? rightSF : []}
            side="right"
            hasR32={rightR32.length > 0}
          />
        </div>
      </div>

      <div className="bk-note">Home and Away Legs · Decider if required</div>
    </section>
  )
}

