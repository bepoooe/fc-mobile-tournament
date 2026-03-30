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
  const name = pm[id]?.name ?? 'TBD'
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

/* ─── Geometry ─── */
const CARD_H = 76   // height of a match card (two 37px rows + 2px divider)
const ROW_H = 37    // each team row height
const GAP = 18      // gap between cards in same round
const LABEL_H = 28  // round label height (above cards)

const centers = (n: number, pt: number, gap: number) =>
  Array.from({ length: Math.max(0, n) }, (_, i) => LABEL_H + pt + ROW_H + i * (CARD_H + gap))

const pairMids = (cs: number[]) => {
  const out: number[] = []
  for (let i = 0; i < cs.length; i += 2) {
    const b = cs[i + 1]
    out.push(b !== undefined ? (cs[i] + b) / 2 : cs[i])
  }
  return out
}

const alignTo = (targets: number[], n: number) => {
  if (n <= 0) return { pt: 0, gap: GAP, cs: [] as number[] }
  const pt = Math.max(0, Math.round((targets[0] ?? LABEL_H + ROW_H) - (LABEL_H + ROW_H)))
  const gap = n > 1 && targets[1] !== undefined
    ? Math.max(8, Math.round(targets[1] - targets[0] - CARD_H))
    : GAP
  return { pt, gap, cs: centers(n, pt, gap) }
}

const buildSide = (n0: number, n1: number, n2: number) => {
  const r0 = centers(n0, 0, GAP)
  const r1 = alignTo(pairMids(r0), n1)
  const r2 = alignTo(pairMids(r1.cs), n2)
  return { r0, r1, r2 }
}

/* ─── Bracket Connector SVG ───
   Classic tournament bracket tree: horizontal-in → vertical bar → horizontal-out
   No arrowheads — just clean bracket lines like UCL.
*/
const LINE = 'rgba(168,85,247,0.6)'
const CONN_W = 30

function BracketConnector({ srcs, flip }: { srcs: number[]; flip?: boolean }) {
  if (!srcs.length) return <div style={{ width: CONN_W, flexShrink: 0 }} aria-hidden />

  const maxY = srcs[srcs.length - 1] + ROW_H + 8
  const h = Math.max(100, Math.ceil(maxY))
  const w = CONN_W
  const pairs = Math.ceil(srcs.length / 2)

  return (
    <div style={{ width: w, flexShrink: 0 }} aria-hidden>
      <svg width={w} height={h} overflow="visible">
        {Array.from({ length: pairs }).map((_, p) => {
          const a = srcs[p * 2]
          if (a === undefined) return null
          const b = srcs[p * 2 + 1]
          const hasB = b !== undefined
          const bC = hasB ? Math.min(h - 4, b) : a
          const mid = (a + bC) / 2
          const xIn = flip ? w : 0   // inbound side (where cards are)
          const xOut = flip ? 0 : w  // outbound side (to next round)
          const xBar = w / 2

          return (
            <g key={p} strokeLinecap="square">
              {/* horizontal in from card 1 */}
              <line x1={xIn} y1={a}   x2={xBar} y2={a}   stroke={LINE} strokeWidth="1.5" />
              {/* horizontal in from card 2 */}
              {hasB && <line x1={xIn} y1={bC}  x2={xBar} y2={bC}  stroke={LINE} strokeWidth="1.5" />}
              {/* vertical bar connecting them */}
              {hasB && <line x1={xBar} y1={a}  x2={xBar} y2={bC}  stroke={LINE} strokeWidth="1.5" />}
              {/* horizontal out from midpoint to next round */}
              <line x1={xBar} y1={mid} x2={xOut} y2={mid} stroke={LINE} strokeWidth="1.5" />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ─── Final bridge: simple horizontal line from SF to Final ─── */
function FinalBridge({ srcs, flip }: { srcs: number[]; flip?: boolean }) {
  const y = srcs[0] ?? LABEL_H + ROW_H
  const h = Math.max(60, Math.ceil(y + ROW_H + 10))
  const w = 32

  return (
    <div style={{ width: w, flexShrink: 0 }} aria-hidden>
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
        <span className="bk-name bk-name--tbd">TBD</span>
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

/* ─── Match Card ─── */
function Card({ match, size = 'md' }: { match: Match; size?: 'sm' | 'md' | 'lg' }) {
  const won = (t: Team | null) => !!match.winner && !!t && match.winner.name === t.name
  return (
    <div className={`bk-card bk-card--${size}`}>
      <TeamRow team={match.team1} isWinner={won(match.team1)} />
      <div className="bk-divider" />
      <TeamRow team={match.team2} isWinner={won(match.team2)} />
    </div>
  )
}

/* ─── Round Column ─── */
function RoundCol({
  label, matches, size = 'md', pt = 0, gap = GAP,
}: {
  label: string; matches: Match[]; size?: 'sm' | 'md' | 'lg'; pt?: number; gap?: number
}) {
  return (
    <div className="bk-col" style={{ paddingTop: pt, gap }}>
      <div className="bk-label">{label}</div>
      {matches.map(m => <Card key={m.id} match={m} size={size} />)}
    </div>
  )
}

/* ─── One half of the bracket ─── */
function BracketHalf({
  r0, r1, r2, side,
}: { r0: Match[]; r1: Match[]; r2: Match[]; side: 'left' | 'right' }) {
  const geo = useMemo(() => buildSide(r0.length, r1.length, r2.length), [r0.length, r1.length, r2.length])
  const flip = side === 'right'

  const bridgeSrc = r2.length > 0
    ? geo.r2.cs
    : r1.length > 0
    ? pairMids(geo.r1.cs)
    : pairMids(geo.r0)

  const cols: React.ReactNode[] = []

  if (r0.length > 0) {
    cols.push(
      <RoundCol key="r0" label={r0.length > 2 ? 'R16' : 'SF'}
        matches={r0} size="md" gap={GAP} />
    )
    if (r1.length > 0 || r2.length > 0) {
      cols.push(<BracketConnector key="c0" srcs={geo.r0} flip={flip} />)
    }
  }
  if (r1.length > 0) {
    cols.push(
      <RoundCol key="r1" label="QF" matches={r1} size="sm" pt={geo.r1.pt} gap={geo.r1.gap} />
    )
    if (r2.length > 0) {
      cols.push(<BracketConnector key="c1" srcs={geo.r1.cs} flip={flip} />)
    }
  }
  if (r2.length > 0) {
    cols.push(
      <RoundCol key="r2" label="SF" matches={r2} size="sm" pt={geo.r2.pt} gap={geo.r2.gap} />
    )
  }

  cols.push(<FinalBridge key="arm" srcs={bridgeSrc} flip={flip} />)

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
      <section className="panel">
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          Knockout bracket has not been generated yet.
        </p>
      </section>
    )
  }

  const won = (t: Team | null) =>
    !!finalMatch.winner && !!t && finalMatch.winner.name === t.name

  return (
    <section className="bk-page">
      {/* ── Title ── */}
      <div className="bk-header">
        <div className="bk-stars">✦ ✦ ✦ ✦ ✦</div>
        <div className="bk-eyebrow">{tournamentName}</div>
        <div className="bk-title">KNOCKOUT <span>ARENA</span></div>
        <div className="bk-subtitle">FC Mobile Elimination Bracket</div>
      </div>

      {/* ── Bracket ── */}
      <div className="bk-bracket">
        <BracketHalf r0={leftR16}  r1={leftQF}  r2={leftSF}  side="left" />

        {/* Center: trophy + final */}
        <div className="bk-center">
          <div className="bk-label" style={{ color: '#d8b4fe', letterSpacing: '5px' }}>FINAL</div>
          <div className="bk-trophy">🏆</div>
          <div className="bk-card bk-card--final">
            <TeamRow team={finalMatch.team1} isWinner={won(finalMatch.team1)} />
            <div className="bk-divider" />
            <TeamRow team={finalMatch.team2} isWinner={won(finalMatch.team2)} />
          </div>
        </div>

        <BracketHalf r0={rightR16} r1={rightQF} r2={rightSF} side="right" />
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
