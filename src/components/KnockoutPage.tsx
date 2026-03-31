import { useMemo } from 'react'
import { usePlayerMap, useTournament } from '../context/TournamentContext'
import type { KnockoutTie } from '../types'

/* ─── Types ─── */
type Team = { name: string; logo: string }
type Match = { id: string; team1: Team | null; team2: Team | null; winner: Team | null }

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
})
const splitHalf = (ties: KnockoutTie[]) => {
  const mid = Math.ceil(ties.length / 2)
  return { left: ties.slice(0, mid), right: ties.slice(mid) }
}

/* ══════════════════════════════════════════════════════
   GEOMETRY
   ══════════════════════════════════════════════════════
   ROW_H  = height of a single team slot
   PAIR_H = height of a match pair (2 rows + 1px divider)
   GAP    = gap between pairs in the R16 column
   LABEL_H= height reserved for the round label above the pairs

   Y-origin for each column is the TOP of the column div.
   The connector line for a pair exits at the DIVIDER line
   between its two team rows, i.e. at:
     topPad + LABEL_H + ROW_H + pairIndex * (PAIR_H + gap)
   ══════════════════════════════════════════════════════ */
const ROW_H   = 37    // px — single team slot height
const PAIR_H  = ROW_H * 2 + 1  // 75px — two rows + 1px divider
const GAP     = 16   // px — gap between R16 pairs
const LABEL_H = 28   // px — round label height
const CONN_W  = 28   // px — connector SVG width
const FINAL_CARD_BORDER = 1 // px per side
const FINAL_MID_Y = (PAIR_H + FINAL_CARD_BORDER * 2) / 2 // visual midpoint of bordered final card

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
  // LABEL_H + topPad + ROW_H = targets[0]  →  topPad = targets[0] - LABEL_H - ROW_H
  const topPad = Math.max(0, Math.round(targets[0] - LABEL_H - ROW_H))
  const gap = n > 1 && targets[1] !== undefined
    ? Math.max(8, Math.round(targets[1] - targets[0] - PAIR_H))
    : GAP
  return { topPad, gap, cs: pairCenters(n, topPad, gap) }
}

/** Build geometry for all three rounds on one side. */
const buildSide = (n0: number, n1: number, n2: number) => {
  const cs0 = pairCenters(n0, 0, GAP)
  const a1  = alignTo(pairMids(cs0), n1)
  const a2  = alignTo(pairMids(a1.cs), n2)
  return { cs0, a1, a2 }
}

/* ══════════════════════════════════════════════════════
   BRACKET CONNECTOR
   Draws strict L-shaped right-angle lines:
     • Horizontal from the card column edge → vertical bar
     • Single vertical bar connecting pair A and pair B
     • Horizontal from vertical bar midpoint → next round
   `srcs`  = Y positions of each pair's connector point
   `flip`  = true for right half (lines drawn right→left)
   ══════════════════════════════════════════════════════ */
const LINE = 'rgba(168,85,247,0.6)'

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
              {/* ① Horizontal in — pair A */}
              <line x1={xCard} y1={yA}   x2={xBar}  y2={yA}   stroke={LINE} strokeWidth="1.5" />
              {/* ② Horizontal in — pair B */}
              {hasB && <line x1={xCard} y1={yB}   x2={xBar}  y2={yB}   stroke={LINE} strokeWidth="1.5" />}
              {/* ③ Vertical bar joining A and B */}
              {hasB && <line x1={xBar}  y1={yA}   x2={xBar}  y2={yB}   stroke={LINE} strokeWidth="1.5" />}
              {/* ④ Horizontal out — from midpoint of vertical bar */}
              <line x1={xBar}  y1={yMid} x2={xNext} y2={yMid} stroke={LINE} strokeWidth="1.5" />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ─── Final bridge: single horizontal line from SF to the Final card ─── */
function FinalBridge({ srcs, flip }: { srcs: number[]; flip?: boolean }) {
  const y = srcs[0] ?? LABEL_H + ROW_H
  const h = Math.max(60, Math.ceil(y + ROW_H + 10))
  const w = 32

  return (
    <div style={{ width: w, flexShrink: 0, alignSelf: 'flex-start' }} aria-hidden>
      <svg width={w} height={h} overflow="visible">
        <line
          x1={flip ? w : 0} y1={y}
          x2={flip ? 0 : w} y2={y}
          stroke={LINE} strokeWidth="1.5" strokeLinecap="square"
        />
      </svg>
    </div>
  )
}

/* ─── Team Row ─── */
function TeamRow({ team, isWinner }: { team: Team | null; isWinner: boolean }) {
  if (!team) {
    return (
      <div className="bk-row bk-row--empty">
        <span className="bk-logo bk-logo--ghost" aria-hidden>•</span>
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

/* ══════════════════════════════════════════════════════
   MATCH PAIR
   Two bare team rows + divider. No outer border / background box.
   The `bk-pair` class controls only width.
   ══════════════════════════════════════════════════════ */
function MatchPair({ match, size = 'md' }: { match: Match; size?: 'sm' | 'md' | 'lg' }) {
  const won = (t: Team | null) => !!match.winner && !!t && match.winner.name === t.name
  return (
    <div className={`bk-pair bk-pair--${size}`}>
      <TeamRow team={match.team1} isWinner={won(match.team1)} />
      <div className="bk-divider" />
      <TeamRow team={match.team2} isWinner={won(match.team2)} />
    </div>
  )
}

/* ══════════════════════════════════════════════════════
   ROUND COLUMN
   Uses absolute positioning so every pair sits at the
   exact pixel row computed by the geometry functions.
   ══════════════════════════════════════════════════════ */
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
      <div className="bk-label">{label}</div>
      {/* Relative container so pairs can be absolutely positioned */}
      <div style={{ position: 'relative', height: totalH - LABEL_H }}>
        {matches.map((m, i) => (
          <div
            key={m.id}
            style={{
              position: 'absolute',
              top: topPad + i * (PAIR_H + gap),
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

/* ─── One half of the bracket ─── */
function BracketHalf({
  r0, r1, r2, side, finalY,
}: { r0: Match[]; r1: Match[]; r2: Match[]; side: 'left' | 'right'; finalY?: number }) {
  const geo  = useMemo(() => buildSide(r0.length, r1.length, r2.length), [r0.length, r1.length, r2.length])
  const flip = side === 'right'

  // Y that the FinalBridge line should be drawn at
  const bridgeSrc = r2.length > 0
    ? pairMids(geo.a2.cs)
    : r1.length > 0
    ? pairMids(geo.a1.cs)
    : pairMids(geo.cs0)
  const bridgeY = finalY ?? bridgeSrc[0]

  const cols: React.ReactNode[] = []

  if (r0.length > 0) {
    cols.push(
      <RoundCol
        key="r0"
        label={r0.length > 2 ? 'R16' : 'SF'}
        matches={r0}
        size="md"
        topPad={0}
        gap={GAP}
      />
    )
    if (r1.length > 0 || r2.length > 0) {
      cols.push(<BracketConnector key="c0" srcs={geo.cs0} flip={flip} />)
    }
  }

  if (r1.length > 0) {
    cols.push(
      <RoundCol
        key="r1"
        label="QF"
        matches={r1}
        size="sm"
        topPad={geo.a1.topPad}
        gap={geo.a1.gap}
      />
    )
    if (r2.length > 0) {
      cols.push(<BracketConnector key="c1" srcs={geo.a1.cs} flip={flip} />)
    }
  }

  if (r2.length > 0) {
    cols.push(
      <RoundCol
        key="r2"
        label="SF"
        matches={r2}
        size="sm"
        topPad={geo.a2.topPad}
        gap={geo.a2.gap}
      />
    )
  }

  cols.push(<FinalBridge key="arm" srcs={[bridgeY]} flip={flip} />)

  return (
    <div className="bk-half">
      {flip ? [...cols].reverse() : cols}
    </div>
  )
}


/* ─── Main Page ─── */
export const KnockoutPage = () => {
  const { state } = useTournament()
  const playerMap = usePlayerMap()
  const tournamentName = state.settings.tournamentName?.trim() || 'TechStorm Tournament'

  const roundMap = useMemo(() => {
    const r16 = state.knockout.rounds.find(r => /round of 16|r16/i.test(r.name))
    const qf  = state.knockout.rounds.find(r => /quarter|qf/i.test(r.name))
    const sf  = state.knockout.rounds.find(r => /semi|sf/i.test(r.name))
    return {
      r16: r16 ?? state.knockout.rounds[0],
      qf:  qf  ?? state.knockout.rounds[1],
      sf:  sf  ?? state.knockout.rounds[2],
    }
  }, [state.knockout.rounds])

  const mk = (round: typeof roundMap.r16, half: 'left' | 'right'): Match[] => {
    if (!round) return []
    const { left, right } = splitHalf(round.ties)
    return (half === 'left' ? left : right).map(t => toMatch(t, playerMap))
  }

  const leftR16  = useMemo(() => mk(roundMap.r16, 'left'),  [roundMap.r16, playerMap])
  const rightR16 = useMemo(() => mk(roundMap.r16, 'right'), [roundMap.r16, playerMap])
  const leftQF   = useMemo(() => mk(roundMap.qf,  'left'),  [roundMap.qf,  playerMap])
  const rightQF  = useMemo(() => mk(roundMap.qf,  'right'), [roundMap.qf,  playerMap])
  const leftSF   = useMemo(() => mk(roundMap.sf,  'left'),  [roundMap.sf,  playerMap])
  const rightSF  = useMemo(() => mk(roundMap.sf,  'right'), [roundMap.sf,  playerMap])

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

  if (!state.knockout.enabled) {
    return (
      <section 
        style={{
          background: 'linear-gradient(145deg, rgba(24, 18, 38, 0.95) 0%, rgba(14, 9, 24, 0.98) 100%)',
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
          color: 'rgba(168,85,247,0.45)',
          marginBottom: '12px',
        }}>✦ ✦ ✦</div>
        <h1 style={{
          fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
          fontSize: 'clamp(32px, 6vw, 52px)',
          fontWeight: 800,
          color: '#f0edf5',
          textShadow: '0 0 28px rgba(168, 85, 247, 0.18)',
          letterSpacing: '3px',
          lineHeight: 1.1,
          margin: '16px 0',
        }}>
          Welcome to <span style={{ color: '#d8b4fe', textShadow: '0 0 18px rgba(168,85,247,0.3)' }}>KNOCKOUT ARENA</span>
        </h1>
        <p style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: 'clamp(14px, 2vw, 16px)',
          letterSpacing: '2px',
          color: 'rgba(216,180,254,0.6)',
          margin: '16px 0 0 0',
        }}>
          The knockout bracket will appear here once generated in the Admin panel
        </p>
        <div style={{
          fontSize: 'clamp(14px, 2.5vw, 18px)',
          letterSpacing: '8px',
          color: 'rgba(168,85,247,0.45)',
          marginTop: '12px',
        }}>✦ ✦ ✦</div>
      </section>
    )
  }

  const won = (t: Team | null) =>
    !!finalMatch.winner && !!t && finalMatch.winner.name === t.name

  const leftGeo = useMemo(
    () => buildSide(leftR16.length, leftQF.length, leftSF.length),
    [leftR16.length, leftQF.length, leftSF.length]
  )
  const rightGeo = useMemo(
    () => buildSide(rightR16.length, rightQF.length, rightSF.length),
    [rightR16.length, rightQF.length, rightSF.length]
  )

  const leftBridgeSrcY = useMemo(() => {
    if (leftSF.length > 0) return pairMids(leftGeo.a2.cs)[0]
    if (leftQF.length > 0) return pairMids(leftGeo.a1.cs)[0]
    return pairMids(leftGeo.cs0)[0]
  }, [leftGeo, leftSF.length, leftQF.length])
  const rightBridgeSrcY = useMemo(() => {
    if (rightSF.length > 0) return pairMids(rightGeo.a2.cs)[0]
    if (rightQF.length > 0) return pairMids(rightGeo.a1.cs)[0]
    return pairMids(rightGeo.cs0)[0]
  }, [rightGeo, rightSF.length, rightQF.length])

  const sharedFinalY = useMemo(() => {
    const ys = [leftBridgeSrcY, rightBridgeSrcY].filter((y): y is number => typeof y === 'number')
    if (!ys.length) return LABEL_H + ROW_H
    return ys.reduce((a, b) => a + b, 0) / ys.length
  }, [leftBridgeSrcY, rightBridgeSrcY])

  // Position .bk-center so the connector lands on the true middle of the winner box.
  // The center block is anchored to the final card (header is absolutely positioned above it).
  const centerCardTop = Math.max(0, sharedFinalY - FINAL_MID_Y)

  return (
    <section className="bk-page">
      {/* ── Title ── */}
      <div className="bk-header">
        <div className="bk-stars">✦ ✦ ✦ ✦ ✦</div>
        <div className="bk-eyebrow">{tournamentName}</div>
        <div className="bk-title">KNOCKOUT <span>ARENA</span></div>
        <div className="bk-subtitle">FC Mobile Elimination Bracket</div>
      </div>

      {/* ── Status Badge ── */}
      {(leftR16.some(m => !m.team1 || !m.team2) || rightR16.some(m => !m.team1 || !m.team2)) && (
        <div style={{
          background: 'rgba(251, 146, 60, 0.1)',
          border: '1px solid rgba(251, 146, 60, 0.3)',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '24px',
          textAlign: 'center',
          fontSize: '14px',
          color: 'rgba(251, 146, 60, 0.8)',
        }}>
          ⚠ Some groups are still being completed · Bracket will update as results come in
        </div>
      )}

      {/* ── Bracket ── */}
      <div className="overflow-x-auto w-full" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="bk-bracket" style={{ minWidth: 'min-content' }}>
          <BracketHalf r0={leftR16}  r1={leftQF}  r2={leftSF}  side="left" finalY={sharedFinalY} />

          {/* Center: final card is the anchor; trophy/label are absolutely placed above */}
          <div className="bk-center" style={{ marginTop: centerCardTop }}>
            <div className="bk-center-head" aria-hidden>
              <div className="bk-trophy">🏆</div>
              <div className="bk-label" style={{ color: '#d8b4fe', letterSpacing: '5px' }}>FINAL</div>
            </div>
            <div className="bk-card bk-card--final">
              <TeamRow team={finalMatch.team1} isWinner={won(finalMatch.team1)} />
              <div className="bk-divider" />
              <TeamRow team={finalMatch.team2} isWinner={won(finalMatch.team2)} />
            </div>
          </div>

          <BracketHalf r0={rightR16} r1={rightQF} r2={rightSF} side="right" finalY={sharedFinalY} />
        </div>
      </div>

      {/* ── Champion ── */}
      {champion && (
        <div className="bk-champion">
          <div className="bk-champion__label">TechStorm Champion</div>
          <div className="bk-champion__name">{champion.name}</div>
        </div>
      )}

      <div className="bk-note">Home and Away Legs · Decider if required</div>
    </section>
  )
}
