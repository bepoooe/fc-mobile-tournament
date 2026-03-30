import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { TournamentProvider, useGroupFixtures, usePlayerMap, useTournament } from './context/TournamentContext'
import { calculateStandings } from './utils/tournament'
import { MAX_PLAYERS, MIN_PLAYERS } from './utils/tournament'
import type { Fixture, Group, StandingRow, Tiebreaker, TournamentState } from './types'
import { KnockoutPage } from './components/KnockoutPage'

declare global {
  interface Window {
    XLSX?: {
      read: (data: ArrayBuffer, options: { type: string }) => {
        SheetNames: string[]
        Sheets: Record<string, unknown>
      }
      writeFile: (workbook: unknown, fileName: string) => void
      utils: {
        book_new: () => unknown
        book_append_sheet: (workbook: unknown, worksheet: unknown, name: string) => void
        aoa_to_sheet: (data: Array<Array<string | number>>) => unknown
        json_to_sheet: (data: Array<Record<string, string | number>>) => unknown
        sheet_to_json: (
          sheet: unknown,
          options?: Record<string, unknown>,
        ) => Array<Array<string | number>> | Array<Record<string, unknown>>
      }
    }
  }
}

type Page = 'groups' | 'fixtures' | 'knockout' | 'rules' | 'admin'
type AdminTab = 'players' | 'groups' | 'fixtures' | 'score_entry' | 'knockout' | 'settings'

const navItems: Array<{ key: Page; label: string }> = [
  { key: 'groups', label: 'Groups' },
  { key: 'fixtures', label: 'Fixtures' },
  { key: 'knockout', label: 'Knockout' },
  { key: 'rules', label: 'Rules' },
  { key: 'admin', label: 'Admin' },
]

const stageLabel: Record<string, string> = {
  setup: 'Setup Phase',
  group_stage: 'Group Stage Active',
  knockout: 'Knockout Phase Active',
  final: 'Final Best of 3 Active',
  completed: 'Tournament Completed',
}

const readExcelPlayers = async (file: File): Promise<Array<{ name: string; ovr: number }>> => {
  if (!window.XLSX) {
    throw new Error('SheetJS not loaded. Refresh page and try again.')
  }

  const buffer = await file.arrayBuffer()
  const workbook = window.XLSX.read(buffer, { type: 'array' })
  const firstSheet = workbook.SheetNames[0]
  const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
    header: 1,
    defval: '',
  }) as Array<Array<string | number>>

  if (!rows.length) return []

  const normalize = (value: string | number | undefined) =>
    String(value ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')

  const parseName = (value: string | number | undefined) => {
    const cleaned = String(value ?? '')
      .replace(/^\s*\d+\s*[).\-_:]+\s*/, '')
      .replace(/^\s*"|"\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    return cleaned
  }

  const parseUsername = (value: string | number | undefined) =>
    String(value ?? '')
      .replace(/^\s*"|"\s*$/g, '')
      .replace(/\s+/g, ' ')
      .trim()

  const getFirstName = (value: string) => {
    const cleaned = value
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (!cleaned) return ''
    return cleaned.split(' ')[0]
  }

  const parseOvr = (value: string | number | undefined) => {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? Math.round(value) : NaN
    }

    const text = String(value ?? '').trim()
    if (!text) return NaN

    const numeric = Number(text)
    if (Number.isFinite(numeric)) return Math.round(numeric)

    const match = text.match(/\d+(\.\d+)?/)
    if (!match) return NaN
    return Math.round(Number(match[0]))
  }

  const isNameHeader = (text: string) =>
    text === 'name' ||
    text.includes('full name') ||
    text.includes('fullname') ||
    text.includes('player name') ||
    text.includes('participant name') ||
    text.includes('gamer name') ||
    (text.includes('player') && text.includes('name'))

  const isOvrHeader = (text: string) =>
    text === 'ovr' ||
    text.includes('ovr') ||
    text.includes('rating') ||
    text.includes('overall')

  const isUsernameHeader = (text: string) =>
    text === 'ign' ||
    text === 'username' ||
    text === 'user name' ||
    text.includes('fifa username') ||
    text.includes('fifa user name') ||
    text.includes('fifa id') ||
    text.includes('in game name') ||
    text.includes('in-game name') ||
    text.includes('gamertag')

  const headerRowIndex = rows.findIndex((row) => {
    const normalized = row.map((cell) => normalize(cell))
    const hasName = normalized.some((cell) => isNameHeader(cell))
    const hasOvr = normalized.some((cell) => isOvrHeader(cell))
    return hasName && hasOvr
  })

  const startIndex = headerRowIndex >= 0 ? headerRowIndex + 1 : 1
  const header = headerRowIndex >= 0 ? rows[headerRowIndex] : rows[0]

  let nameColumn = 0
  let ovrColumn = 1
  let usernameColumn: number | null = null
  let explicitNameColumn = false
  let explicitOvrColumn = false
  let explicitUsernameColumn = false

  if (header) {
    header.forEach((value, index) => {
      const text = normalize(value)
      if (isNameHeader(text)) {
        nameColumn = index
        explicitNameColumn = true
      }
      if (isOvrHeader(text)) {
        ovrColumn = index
        explicitOvrColumn = true
      }
      if (isUsernameHeader(text)) {
        usernameColumn = index
        explicitUsernameColumn = true
      }
    })
  }

  const dataRows = rows.slice(startIndex).filter((row) =>
    row.some((cell) => String(cell ?? '').trim() !== ''),
  )

  if (dataRows.length) {
    const maxColumns = dataRows.reduce((max, row) => Math.max(max, row.length), 0)
    const columnStats = Array.from({ length: maxColumns }, (_, colIndex) => {
      const sample = dataRows.slice(0, 30).map((row) => row[colIndex])
      const nonEmpty = sample.filter((value) => String(value ?? '').trim() !== '')
      const numericCount = nonEmpty.filter((value) => Number.isFinite(parseOvr(value))).length
      const alphaCount = nonEmpty.filter((value) => /[a-z]/i.test(parseName(value))).length
      return { colIndex, nonEmpty: nonEmpty.length, numericCount, alphaCount }
    })

    const inferredName = [...columnStats]
      .filter((stat) => stat.nonEmpty > 0)
      .sort((a, b) => {
        if (b.alphaCount !== a.alphaCount) return b.alphaCount - a.alphaCount
        return b.nonEmpty - a.nonEmpty
      })[0]

    const inferredOvr = [...columnStats]
      .filter((stat) => stat.nonEmpty > 0)
      .sort((a, b) => {
        if (b.numericCount !== a.numericCount) return b.numericCount - a.numericCount
        return b.nonEmpty - a.nonEmpty
      })[0]

    if (!explicitNameColumn && inferredName && inferredName.alphaCount > 0) {
      nameColumn = inferredName.colIndex
    }
    if (!explicitOvrColumn && inferredOvr && inferredOvr.numericCount > 0) {
      ovrColumn = inferredOvr.colIndex
    }

    if (nameColumn === ovrColumn && columnStats.length > 1) {
      const alternativeName = [...columnStats]
        .filter((stat) => stat.colIndex !== ovrColumn)
        .sort((a, b) => {
          if (b.alphaCount !== a.alphaCount) return b.alphaCount - a.alphaCount
          return b.nonEmpty - a.nonEmpty
        })[0]

      if (alternativeName && alternativeName.alphaCount > 0) {
        nameColumn = alternativeName.colIndex
      }
    }

    if (!explicitUsernameColumn) {
      const inferredUsername = [...columnStats]
        .filter((stat) => stat.nonEmpty > 0 && stat.colIndex !== nameColumn && stat.colIndex !== ovrColumn)
        .sort((a, b) => {
          if (b.alphaCount !== a.alphaCount) return b.alphaCount - a.alphaCount
          return b.nonEmpty - a.nonEmpty
        })[0]

      if (inferredUsername && inferredUsername.alphaCount > 0) {
        usernameColumn = inferredUsername.colIndex
      }
    }
  }

  return rows.slice(startIndex).reduce<Array<{ name: string; ovr: number }>>((acc, row) => {
    const rawName = parseName(row[nameColumn])
    const ovr = parseOvr(row[ovrColumn])

    const usernameFromColumn = usernameColumn === null ? '' : parseUsername(row[usernameColumn])
    const usernameFromName = rawName.match(/\(([^)]+)\)/)?.[1]?.trim() ?? ''
    const fifaUsername = usernameFromColumn || usernameFromName
    const firstName = getFirstName(rawName)

    if (rawName && Number.isFinite(ovr) && ovr > 0) {
      const roundedOvr = Math.round(ovr)
      const name =
        firstName && fifaUsername
          ? `${firstName}(${fifaUsername})${roundedOvr}`
          : rawName
      acc.push({ name, ovr: roundedOvr })
    }
    return acc
  }, [])
}

const groupStandingsMap = (
  groups: Group[],
  fixtures: Fixture[],
  tiebreakers: Tiebreaker[],
): Record<string, StandingRow[]> => {
  const map: Record<string, StandingRow[]> = {}
  for (const group of groups) {
    const ownFixtures = fixtures.filter((fixture) => fixture.groupId === group.id)
    map[group.id] = calculateStandings(group, ownFixtures, tiebreakers)
  }
  return map
}

const exportGroupsToExcel = (
  groups: Group[],
  players: TournamentState['players'],
  tournamentName: string,
) => {
  if (!window.XLSX) {
    throw new Error('SheetJS not loaded. Refresh page and try again.')
  }
  if (!groups.length) {
    throw new Error('Generate groups first, then export.')
  }

  const playerMap = new Map(players.map((player) => [player.id, player]))
  const rows: Array<Record<string, string | number>> = []

  for (const group of groups) {
    group.playerIds.forEach((playerId, index) => {
      const player = playerMap.get(playerId)
      if (!player) return

      rows.push({
        Group: group.name,
        Slot: index + 1,
        Player: player.name,
        OVR: player.ovr,
      })
    })
  }

  const workbook = window.XLSX.utils.book_new()

  const generatedAt = new Date()
  const generatedDate = generatedAt.toISOString().slice(0, 10)
  const generatedTime = generatedAt.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  const overviewRows: Array<Array<string | number>> = [
    ['Tournament', tournamentName],
    ['Export Type', 'Group Allocation'],
    ['Generated On', generatedDate],
    ['Generated At', generatedTime],
    ['Total Groups', groups.length],
    ['Total Players', rows.length],
    [],
    ['Group', 'Players', 'Average OVR', 'Highest OVR', 'Lowest OVR'],
  ]

  for (const group of groups) {
    const groupPlayers = group.playerIds
      .map((id) => playerMap.get(id))
      .filter((player): player is NonNullable<typeof player> => Boolean(player))
    const ovrs = groupPlayers.map((player) => player.ovr)
    const avg = ovrs.length
      ? Number((ovrs.reduce((sum, value) => sum + value, 0) / ovrs.length).toFixed(1))
      : 0

    overviewRows.push([
      group.name,
      groupPlayers.length,
      avg,
      ovrs.length ? Math.max(...ovrs) : '-',
      ovrs.length ? Math.min(...ovrs) : '-',
    ])
  }

  const overviewSheet = window.XLSX.utils.aoa_to_sheet(overviewRows) as {
    [key: string]: unknown
  }
  overviewSheet['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
  overviewSheet['!autofilter'] = { ref: `A8:E${overviewRows.length}` }
  overviewSheet['!freeze'] = { xSplit: 0, ySplit: 8 }
  window.XLSX.utils.book_append_sheet(workbook, overviewSheet, 'Overview')

  const allGroupsRows: Array<Array<string | number>> = [
    [tournamentName],
    ['Group Allocation Export'],
    [`Generated on ${generatedDate} at ${generatedTime}`],
    [],
    ['Group', 'Slot', 'Player Name', 'OVR'],
  ]

  for (const row of rows) {
    allGroupsRows.push([row.Group, row.Slot, row.Player, row.OVR])
  }

  const allGroupsSheet = window.XLSX.utils.aoa_to_sheet(allGroupsRows) as {
    [key: string]: unknown
  }
  allGroupsSheet['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 36 }, { wch: 10 }]
  allGroupsSheet['!autofilter'] = { ref: `A5:D${allGroupsRows.length}` }
  allGroupsSheet['!freeze'] = { xSplit: 0, ySplit: 5 }
  window.XLSX.utils.book_append_sheet(workbook, allGroupsSheet, 'All Groups')

  for (const group of groups) {
    const groupRows: Array<Array<string | number>> = [
      [group.name],
      ['Tournament', tournamentName],
      ['Generated On', generatedDate],
      [],
      ['Slot', 'Player Name', 'OVR'],
    ]

    group.playerIds.forEach((playerId, index) => {
      const player = playerMap.get(playerId)
      if (!player) return
      groupRows.push([index + 1, player.name, player.ovr])
    })

    const groupSheet = window.XLSX.utils.aoa_to_sheet(groupRows) as { [key: string]: unknown }
    groupSheet['!cols'] = [{ wch: 10 }, { wch: 36 }, { wch: 10 }]
    groupSheet['!autofilter'] = { ref: `A5:C${groupRows.length}` }
    groupSheet['!freeze'] = { xSplit: 0, ySplit: 5 }

    const sheetName = group.name.replace(/[^a-z0-9 ]/gi, '').slice(0, 31) || 'Group'
    window.XLSX.utils.book_append_sheet(workbook, groupSheet, sheetName)
  }

  const dateTag = generatedDate
  const safeName = tournamentName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const fileName = `${safeName || 'tournament'}-groups-${dateTag}.xlsx`
  window.XLSX.writeFile(workbook, fileName)
}

const AppShell = () => {
  const { state } = useTournament()
  const [page, setPage] = useState<Page>('groups')
  const isKnockoutPage = page === 'knockout'

  return (
    <div className="min-h-screen text-white" style={{ background: '#09090f' }}>
      <header
        className="sticky top-0 z-40 backdrop-blur-md"
        style={{
          borderBottom: '1px solid rgba(168,85,247,0.12)',
          background: 'rgba(9,9,15,0.88)',
        }}
      >
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-8">
          <div>
            <h1
              style={{
                fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
                fontSize: '13px',
                fontWeight: 700,
                letterSpacing: '3px',
                color: '#d8b4fe',
                textTransform: 'uppercase' as const,
              }}
            >
              TechStorm Tournament
            </h1>
            <p className="mt-0.5 text-[11px]" style={{ color: 'rgba(184,176,200,0.7)' }}>
              FC Mobile Championship Console
            </p>
          </div>
          <span className="status-chip">{stageLabel[state.stage]}</span>
          <nav className="flex flex-wrap gap-2">
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setPage(item.key)}
                className="rounded-lg px-3.5 py-2 text-xs font-semibold uppercase tracking-wider transition-all duration-200"
                style={{
                  fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
                  border: `1px solid ${
                    page === item.key
                      ? 'rgba(168,85,247,0.4)'
                      : 'rgba(168,85,247,0.12)'
                  }`,
                  background:
                    page === item.key
                      ? 'rgba(168,85,247,0.12)'
                      : 'rgba(24,20,34,0.5)',
                  color:
                    page === item.key ? '#d8b4fe' : 'rgba(184,176,200,0.8)',
                  boxShadow:
                    page === item.key
                      ? '0 0 12px rgba(168,85,247,0.1)'
                      : 'none',
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main
        className={`fade-in w-full px-4 py-6 sm:px-6 lg:px-8 ${
          isKnockoutPage ? '' : 'mx-auto max-w-7xl'
        }`}
      >
        <div
          className={`content-shell w-full space-y-6 ${
            isKnockoutPage ? '' : 'mx-auto max-w-6xl'
          }`}
        >
          {page === 'groups' && <GroupsPage />}
          {page === 'fixtures' && <FixturesPage />}
          {page === 'knockout' && <KnockoutPage />}
          {page === 'rules' && <RulesPage />}
          {page === 'admin' && <AdminPage />}
        </div>
      </main>
    </div>
  )
}

const GroupsPage = () => {
  const { state } = useTournament()
  const playerMap = usePlayerMap()
  const standingsByGroup = useMemo(
    () => groupStandingsMap(state.groups, state.fixtures, state.settings.tiebreakers),
    [state.groups, state.fixtures, state.settings.tiebreakers],
  )

  if (!state.groups.length) {
    return <EmptyState text="Groups have not been generated yet." />
  }

  return (
    <section className="space-y-6">
      <div className="panel">
        <h2
          style={{
            fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
            fontSize: '14px',
            fontWeight: 700,
            letterSpacing: '4px',
            color: '#d8b4fe',
            textTransform: 'uppercase' as const,
          }}
        >
          Group Stage Center
        </h2>
        <p className="section-lead">
          Real-time standings and fixtures update instantly as scores are entered from admin.
        </p>
      </div>
      {state.groups.map((group) => (
        <div key={group.id} className="panel">
          <h3
            style={{
              fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '3px',
              color: '#d8b4fe',
              textTransform: 'uppercase' as const,
            }}
          >
            {group.name}
          </h3>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead>
                <tr>
                  {['Player', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'].map((h) => (
                    <th
                      key={h}
                      className="px-3 py-2.5"
                      style={{
                        color: 'rgba(168,85,247,0.7)',
                        fontWeight: 600,
                        fontSize: '10px',
                        letterSpacing: '1px',
                        textTransform: 'uppercase',
                        borderBottom: '1px solid rgba(168,85,247,0.12)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {standingsByGroup[group.id]?.map((row, idx) => (
                  <tr
                    key={row.playerId}
                    style={{
                      borderTop: '1px solid rgba(168,85,247,0.08)',
                      background: idx % 2 === 0 ? 'transparent' : 'rgba(168,85,247,0.03)',
                    }}
                  >
                    <td className="px-3 py-2.5" style={{ color: '#e9d5ff' }}>{playerMap[row.playerId]?.name}</td>
                    <td className="px-3 py-2.5">{row.p}</td>
                    <td className="px-3 py-2.5">{row.w}</td>
                    <td className="px-3 py-2.5">{row.d}</td>
                    <td className="px-3 py-2.5">{row.l}</td>
                    <td className="px-3 py-2.5">{row.gf}</td>
                    <td className="px-3 py-2.5">{row.ga}</td>
                    <td className="px-3 py-2.5">{row.gd}</td>
                    <td className="px-3 py-2.5 font-semibold" style={{ color: '#d8b4fe' }}>{row.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  )
}

const FixturesPage = () => {
  const { state } = useTournament()
  const playerMap = usePlayerMap()

  if (!state.fixtures.length) {
    return <EmptyState text="Fixtures are not available yet. Confirm groups in Admin first." />
  }

  return (
    <section className="space-y-6">
      <div className="panel">
        <h2
          style={{
            fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
            fontSize: '14px',
            fontWeight: 700,
            letterSpacing: '4px',
            color: '#d8b4fe',
            textTransform: 'uppercase' as const,
          }}
        >
          Match Fixtures
        </h2>
        <p className="section-lead">Top 2 teams qualify from each group.</p>
      </div>
      {state.groups.map((group) => {
        const groupFixtures = state.fixtures.filter((fixture) => fixture.groupId === group.id)
        if (!groupFixtures.length) return null

        return (
          <div key={group.id} className="panel">
            <h3
              style={{
                fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '3px',
                color: '#d8b4fe',
                textTransform: 'uppercase' as const,
              }}
            >
              {group.name}
            </h3>
            <div className="mt-4 space-y-2">
              {groupFixtures.map((fixture) => (
                <div
                  key={fixture.id}
                  className="flex items-center justify-between rounded-lg px-4 py-2.5 text-xs transition-all duration-200"
                  style={{
                    border: '1px solid rgba(168,85,247,0.12)',
                    background: fixture.completed
                      ? 'rgba(16,185,129,0.04)'
                      : 'rgba(24,20,34,0.5)',
                  }}
                >
                  <span style={{ color: '#e9d5ff' }}>
                    {playerMap[fixture.homeId]?.name}
                    <span style={{ color: 'rgba(168,85,247,0.4)', margin: '0 8px' }}>vs</span>
                    {playerMap[fixture.awayId]?.name}
                  </span>
                  <span
                    className="font-semibold"
                    style={{
                      color: fixture.completed ? '#6ee7b7' : 'rgba(184,176,200,0.5)',
                      fontSize: fixture.completed ? '12px' : '10px',
                      letterSpacing: fixture.completed ? '1px' : '2px',
                    }}
                  >
                    {fixture.completed ? `${fixture.homeGoals} – ${fixture.awayGoals}` : 'PENDING'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}

const RULES = [
  'Match Format: 1 vs 1',
  'Controls: Any in-game control mode (Buttons/Gestures)',
  'No cross spamming — max 1 cross-to-header attempt per half',
  'Disconnection within 2 in-game minutes = Full rematch',
  'Disconnection after 2 in-game minutes = Score stands; organizers decide rematch',
  'Draws allowed in League Stage; Knockout = rematch until winner',
  "Device issues are player's responsibility; no automatic rematch without organizer approval",
  'Substitutions and tactics allowed before match start only',
  "Final Authority: TechStorm Tournament Management Team's decision is final and binding",
]

const RulesPage = () => (
  <section className="panel space-y-4 text-sm">
    <h2
      style={{
        fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
        fontSize: '14px',
        fontWeight: 700,
        letterSpacing: '4px',
        color: '#d8b4fe',
        textTransform: 'uppercase' as const,
      }}
    >
      Tournament Rules
    </h2>
    <p className="text-xs" style={{ color: 'var(--text-muted)', letterSpacing: '1px' }}>
      {RULES.length} rules govern all matches
    </p>
    <div className="space-y-2">
      {RULES.map((text, i) => (
        <div
          key={i}
          className="flex items-start gap-3 rounded-lg px-4 py-3 transition-all duration-200"
          style={{
            border: '1px solid rgba(168,85,247,0.1)',
            background: i % 2 === 0 ? 'rgba(24,20,34,0.4)' : 'rgba(24,20,34,0.2)',
          }}
        >
          <span
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: '9px',
              fontWeight: 700,
              color: 'rgba(168,85,247,0.5)',
              minWidth: '20px',
              paddingTop: '2px',
            }}
          >
            {String(i + 1).padStart(2, '0')}
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>{text}</span>
        </div>
      ))}
    </div>
  </section>
)

const AdminPage = () => {
  const { state } = useTournament()
  const [authenticated, setAuthenticated] = useState(false)
  const [password, setPassword] = useState('')
  const [adminTab, setAdminTab] = useState<AdminTab>('players')
  const [authError, setAuthError] = useState('')

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (password === state.settings.adminPassword) {
      setAuthenticated(true)
      setPassword('')
      setAuthError('')
    } else {
      setAuthError('Invalid password. Please try again.')
    }
  }

  if (!authenticated) {
    return (
      <section className="panel max-w-md">
        <h2 className="section-heading">Admin Login</h2>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>Default password: techstorm2025</p>
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <input
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value)
              if (authError) setAuthError('')
            }}
            className="input"
            placeholder="Enter admin password"
          />
          {authError && <p className="text-xs text-red-300">{authError}</p>}
          <button className="btn-primary" type="submit">
            Login
          </button>
        </form>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {(['players', 'groups', 'fixtures', 'score_entry', 'knockout', 'settings'] as AdminTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setAdminTab(tab)}
            className="rounded-lg px-3 py-2 text-xs uppercase tracking-wider transition-all duration-200"
            style={{
              border: `1px solid ${
                adminTab === tab ? 'rgba(168,85,247,0.35)' : 'rgba(168,85,247,0.12)'
              }`,
              background: adminTab === tab ? 'rgba(168,85,247,0.1)' : 'rgba(24,20,34,0.4)',
              color: adminTab === tab ? '#d8b4fe' : 'rgba(184,176,200,0.7)',
            }}
          >
            {tab.replace('_', ' ')}
          </button>
        ))}
      </div>
      {adminTab === 'players' && <PlayerManagement />}
      {adminTab === 'groups' && <GroupManagement />}
      {adminTab === 'fixtures' && <FixturesManagement />}
      {adminTab === 'score_entry' && <ScoreEntryManagement />}
      {adminTab === 'knockout' && <KnockoutManagement />}
      {adminTab === 'settings' && <SettingsManagement />}
    </section>
  )
}

const PlayerManagement = () => {
  const {
    state,
    addPlayer,
    bulkAddPlayers,
    updatePlayer,
    removePlayer,
    clearAllPlayers,
    addLatePlayerToSuggestedGroup,
  } = useTournament()
  const [name, setName] = useState('')
  const [ovr, setOvr] = useState<number>(90)
  const [editId, setEditId] = useState<string | null>(null)
  const [excelLoading, setExcelLoading] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const confirmDeletePlayer = (playerId: string, playerName: string) => {
    const proceed = window.confirm(
      `Delete ${playerName}? This removes their fixtures and standings impact.`,
    )
    if (!proceed) return
    removePlayer(playerId)
    setFeedback({ tone: 'ok', text: `${playerName} removed successfully.` })
  }

  const confirmDeleteAllPlayers = () => {
    const proceed = window.confirm(
      'Delete ALL players? This will clear groups, fixtures, and knockout progress.',
    )
    if (!proceed) return
    clearAllPlayers()
    setFeedback({ tone: 'ok', text: 'All players removed. Tournament reset to setup phase.' })
  }

  const submitPlayer = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setFeedback({ tone: 'error', text: 'Player name is required.' })
      return
    }
    if (!Number.isFinite(ovr) || ovr < 1 || ovr > 999) {
      setFeedback({ tone: 'error', text: 'OVR must be between 1 and 999.' })
      return
    }

    if (!editId && state.players.length >= MAX_PLAYERS) {
      setFeedback({ tone: 'error', text: `Maximum ${MAX_PLAYERS} players supported.` })
      return
    }

    if (state.groupsLocked) {
      const groupId = addLatePlayerToSuggestedGroup(name, ovr)
      if (groupId) {
        const group = state.groups.find((item) => item.id === groupId)
        setFeedback({ tone: 'ok', text: `Late player assigned to ${group?.name}.` })
      } else {
        setFeedback({ tone: 'error', text: 'Could not assign late player to a group.' })
      }
    } else if (editId) {
      updatePlayer(editId, name, ovr)
      setFeedback({ tone: 'ok', text: 'Player updated successfully.' })
      setEditId(null)
    } else {
      try {
        addPlayer(name, ovr)
        setFeedback({ tone: 'ok', text: 'Player added successfully.' })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Could not add player.'
        setFeedback({ tone: 'error', text: message })
      }
    }

    setName('')
    setOvr(90)
  }

  const onExcelUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setExcelLoading(true)
    try {
      const rows = await readExcelPlayers(file)
      if (!rows.length) {
        throw new Error(
          'No valid players found. Make sure the sheet has Player Name and OVR Rating columns with values.',
        )
      }
      bulkAddPlayers(rows)
      setFeedback({ tone: 'ok', text: `Imported up to ${rows.length} players from Excel.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not parse file'
      setFeedback({ tone: 'error', text: message })
    } finally {
      setExcelLoading(false)
      event.target.value = ''
    }
  }

  return (
    <section className="space-y-4">
      <div className="panel space-y-3">
        <h3 className="section-heading">Player Management</h3>
        <p className="text-xs text-zinc-300">{state.players.length}/{MAX_PLAYERS} players configured.</p>
        {feedback && (
          <p className={`rounded border px-3 py-2 text-xs ${feedback.tone === 'ok' ? 'border-emerald-300/50 bg-emerald-500/10 text-emerald-100' : 'border-red-300/50 bg-red-500/10 text-red-100'}`}>
            {feedback.text}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <label className="btn-secondary cursor-pointer">
            Upload Excel (.xlsx)
            <input type="file" accept=".xlsx" onChange={onExcelUpload} className="hidden" />
          </label>
          <button
            type="button"
            className="btn-danger"
            onClick={confirmDeleteAllPlayers}
            disabled={!state.players.length}
          >
            Delete All Players
          </button>
          <span className="text-xs text-zinc-400">
            Required columns: Player Name | OVR Rating {excelLoading ? '(processing...)' : ''}
          </span>
        </div>
        <form className="grid gap-2 md:grid-cols-3" onSubmit={submitPlayer}>
          <input
            className="input"
            placeholder="Player Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <input
            className="input"
            type="number"
            min={1}
            value={ovr}
            onChange={(event) => setOvr(Number(event.target.value))}
          />
          <button className="btn-primary" type="submit">
            {state.groupsLocked ? 'Add Late Player' : editId ? 'Update Player' : 'Add Player'}
          </button>
          {editId && !state.groupsLocked && (
            <button
              className="btn-secondary"
              type="button"
              onClick={() => {
                setEditId(null)
                setName('')
                setOvr(90)
              }}
            >
              Cancel Edit
            </button>
          )}
        </form>
      </div>

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="text-neonPurple">
            <tr>
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">OVR</th>
              <th className="px-2 py-2">Group</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {state.players.map((player) => (
              <tr key={player.id} className="border-t border-neonPurple/20">
                <td className="px-2 py-2">{player.name}</td>
                <td className="px-2 py-2">{player.ovr}</td>
                <td className="px-2 py-2">{state.groups.find((group) => group.id === player.groupId)?.name || '-'}</td>
                <td className="px-2 py-2">
                  <div className="flex gap-2">
                    <button
                      className="btn-secondary px-2 py-1"
                      type="button"
                      onClick={() => {
                        setEditId(player.id)
                        setName(player.name)
                        setOvr(player.ovr)
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-danger px-2 py-1"
                      type="button"
                      onClick={() => confirmDeletePlayer(player.id, player.name)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const GroupManagement = () => {
  const { state, setSettings, generateGroups, movePlayerToGroup, lockGroups } = useTournament()
  const canGenerate = state.players.length >= MIN_PLAYERS
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const onExportGroups = () => {
    try {
      exportGroupsToExcel(state.groups, state.players, state.settings.tournamentName)
      setFeedback({ tone: 'ok', text: 'Groups exported to Excel successfully.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export groups.'
      setFeedback({ tone: 'error', text: message })
    }
  }

  return (
    <section className="space-y-4">
      <div className="panel space-y-3">
        <h3 className="section-heading">Group Generator</h3>
        <p className="text-xs text-zinc-300">
          Configure groups for {state.players.length} players. Minimum {MIN_PLAYERS}, maximum {MAX_PLAYERS}.
        </p>
        <div className="grid gap-2 md:grid-cols-4">
          <label className="text-xs text-zinc-300">
            Group Size
            <select
              value={state.settings.groupSize}
              onChange={(event) =>
                setSettings({ groupSize: Number(event.target.value) as 4 | 5 | 6 | 8 })
              }
              className="input mt-1"
            >
              <option value={4}>4</option>
              <option value={5}>5</option>
              <option value={6}>6</option>
              <option value={8}>8</option>
            </select>
          </label>
          <label className="text-xs text-zinc-300">
            Seeding Mode
            <select
              value={state.settings.seedingMode}
              onChange={(event) =>
                setSettings({
                  seedingMode: event.target.value as 'ovr_snake' | 'random' | 'manual',
                })
              }
              className="input mt-1"
            >
              <option value="ovr_snake">OVR Snake Draft</option>
              <option value="random">Random Draw</option>
              <option value="manual">Manual Order</option>
            </select>
          </label>
          <button type="button" className="btn-primary" onClick={generateGroups} disabled={!canGenerate}>
            {state.settings.seedingMode === 'ovr_snake'
              ? 'Generate OVR Snake Groups'
              : state.settings.seedingMode === 'random'
                ? 'Generate Random Groups'
                : 'Generate Manual Order Groups'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={lockGroups}
            disabled={!state.groups.length}
          >
            Confirm Groups & Create Fixtures
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={onExportGroups}
            disabled={!state.groups.length}
          >
            Export Groups (.xlsx)
          </button>
          {!canGenerate && <p className="text-xs text-amber-300 md:col-span-4">Add at least two players before generating groups.</p>}
        </div>
        {feedback && (
          <p className={`rounded border px-3 py-2 text-xs ${feedback.tone === 'ok' ? 'border-emerald-300/50 bg-emerald-500/10 text-emerald-100' : 'border-red-300/50 bg-red-500/10 text-red-100'}`}>
            {feedback.text}
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {state.groups.map((group) => (
          <div key={group.id} className="panel">
            <h4 className="section-heading">{group.name}</h4>
            <div className="mt-3 space-y-2">
              {group.playerIds.map((playerId) => {
                const player = state.players.find((item) => item.id === playerId)
                if (!player) return null
                return (
                  <div key={player.id} className="flex items-center justify-between rounded border border-neonPurple/25 bg-zinc-950/80 p-2 text-xs">
                    <span>
                      {player.name} ({player.ovr})
                    </span>
                    {!state.groupsLocked && (
                      <select
                        className="input w-32 px-2 py-1 text-xs"
                        value={group.id}
                        onChange={(event) => movePlayerToGroup(player.id, event.target.value)}
                      >
                        {state.groups.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {state.groupsLocked && <span className="text-[11px] text-zinc-500">Locked</span>}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

const FixturesManagement = () => {
  const { state, setSettings } = useTournament()
  const playerMap = usePlayerMap()

  if (!state.fixtures.length) {
    return <EmptyState text="No fixtures available. Confirm groups first." />
  }

  return (
    <section className="space-y-4">
      <div className="panel flex flex-wrap items-center gap-3">
        <p className="rounded border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          Top 2 teams qualify from each group.
        </p>
        <label className="text-xs text-zinc-200">
          Primary Tiebreaker
          <select
            className="input mt-1 w-48"
            value={state.settings.tiebreakers[0] ?? 'points'}
            onChange={(event) =>
              setSettings({
                tiebreakers: [
                  event.target.value as 'points' | 'gd' | 'gf' | 'head_to_head',
                  'gd',
                  'gf',
                  'head_to_head',
                ],
              })
            }
          >
            <option value="points">Points</option>
            <option value="gd">Goal Difference</option>
            <option value="gf">Goals For</option>
            <option value="head_to_head">Head to Head</option>
          </select>
        </label>
      </div>
      {state.groups.map((group) => (
        <GroupFixtureCard key={group.id} group={group} playerMap={playerMap} />
      ))}
    </section>
  )
}

const ScoreEntryManagement = () => {
  const { state, setFixtureScore, clearFixtureScore } = useTournament()
  const playerMap = usePlayerMap()

  if (!state.fixtures.length) {
    return <EmptyState text="No fixtures available for score entry yet." />
  }

  return (
    <section className="panel overflow-x-auto">
      <h3 className="section-heading">Score Entry</h3>
      <p className="mt-2 text-xs text-zinc-300">Enter scores using the keyboard and confirm each fixture.</p>
      <div className="mt-3 space-y-2">
        {state.fixtures.map((fixture) => (
          <FixtureEditor
            key={fixture.id}
            fixture={fixture}
            homeName={playerMap[fixture.homeId]?.name || 'Player A'}
            awayName={playerMap[fixture.awayId]?.name || 'Player B'}
            onConfirm={(home, away) => setFixtureScore(fixture.id, home, away)}
            onClear={() => clearFixtureScore(fixture.id)}
          />
        ))}
      </div>
    </section>
  )
}

const GroupFixtureCard = ({
  group,
  playerMap,
}: {
  group: Group
  playerMap: Record<string, { name: string }>
}) => {
  const { state } = useTournament()
  const fixtures = useGroupFixtures(group.id)
  const standings = useMemo(
    () => calculateStandings(group, fixtures, state.settings.tiebreakers),
    [group, fixtures, state.settings.tiebreakers],
  )

  return (
    <div className="panel">
      <h3 className="section-heading">{group.name} Standings</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="text-neonPurple">
            <tr>
              <th className="px-2 py-2">Player</th>
              <th className="px-2 py-2">P</th>
              <th className="px-2 py-2">W</th>
              <th className="px-2 py-2">D</th>
              <th className="px-2 py-2">L</th>
              <th className="px-2 py-2">GF</th>
              <th className="px-2 py-2">GA</th>
              <th className="px-2 py-2">GD</th>
              <th className="px-2 py-2">Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row) => (
              <tr key={row.playerId} className="border-t border-neonPurple/20">
                <td className="px-2 py-2">{playerMap[row.playerId]?.name || '-'}</td>
                <td className="px-2 py-2">{row.p}</td>
                <td className="px-2 py-2">{row.w}</td>
                <td className="px-2 py-2">{row.d}</td>
                <td className="px-2 py-2">{row.l}</td>
                <td className="px-2 py-2">{row.gf}</td>
                <td className="px-2 py-2">{row.ga}</td>
                <td className="px-2 py-2">{row.gd}</td>
                <td className="px-2 py-2 font-semibold text-neonPink">{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const FixtureEditor = ({
  fixture,
  homeName,
  awayName,
  onConfirm,
  onClear,
}: {
  fixture: Fixture
  homeName: string
  awayName: string
  onConfirm: (home: number, away: number) => void
  onClear: () => void
}) => {
  const [home, setHome] = useState<string>(fixture.homeGoals?.toString() ?? '')
  const [away, setAway] = useState<string>(fixture.awayGoals?.toString() ?? '')

  useEffect(() => {
    setHome(fixture.homeGoals?.toString() ?? '')
    setAway(fixture.awayGoals?.toString() ?? '')
  }, [fixture.homeGoals, fixture.awayGoals])

  const typedNumber = (value: string) => value.replace(/[^0-9]/g, '')

  const parsedHome = home === '' ? NaN : Number(home)
  const parsedAway = away === '' ? NaN : Number(away)
  const canConfirm = Number.isInteger(parsedHome) && Number.isInteger(parsedAway)

  return (
    <div className="grid gap-2 rounded border border-neonPurple/30 bg-zinc-950/70 p-3 text-xs md:grid-cols-[1fr_auto_auto_auto_auto] md:items-center">
      <p>
        {homeName} vs {awayName}
      </p>
      <input
        className="input input-score w-20"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="0"
        value={home}
        onChange={(event) => setHome(typedNumber(event.target.value))}
      />
      <input
        className="input input-score w-20"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="0"
        value={away}
        onChange={(event) => setAway(typedNumber(event.target.value))}
      />
      <button
        type="button"
        className="btn-primary"
        disabled={!canConfirm}
        onClick={() => onConfirm(parsedHome, parsedAway)}
      >
        Confirm
      </button>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => {
          setHome('')
          setAway('')
          onClear()
        }}
      >
        Reset
      </button>
    </div>
  )
}

const KnockoutManagement = () => {
  const {
    state,
    generateKnockout,
    setTieLegScore,
    clearTieLegScore,
    coinTossTie,
    setFinalGameResult,
    clearFinalGameResult,
  } = useTournament()
  const playerMap = usePlayerMap()
  const finalSeries = state.knockout.finalSeries

  return (
    <section className="space-y-4">
      <div className="panel">
        <button
          className="btn-primary"
          type="button"
          onClick={generateKnockout}
          disabled={!state.fixtures.length}
        >
          Generate Knockout Bracket
        </button>
      </div>

      {state.knockout.rounds.map((round, roundIndex) => (
        <div key={round.id} className="panel space-y-3">
          <h3 className="section-heading">{round.name}</h3>
          {round.ties.map((tie) => (
            <div key={tie.id} className="rounded border border-neonPurple/30 bg-zinc-950/70 p-3 text-xs">
              <p className="font-semibold text-zinc-100">
                {(tie.playerAId && playerMap[tie.playerAId]?.name) || 'TBD'} vs {(tie.playerBId && playerMap[tie.playerBId]?.name) || 'TBD'}
              </p>
              <ScoreLegInput
                label="Leg 1"
                defaultHome={tie.leg1.homeGoals}
                defaultAway={tie.leg1.awayGoals}
                onSave={(home, away) => setTieLegScore(roundIndex, tie.id, 'leg1', home, away)}
                onClear={() => clearTieLegScore(roundIndex, tie.id, 'leg1')}
              />
              <ScoreLegInput
                label="Leg 2"
                defaultHome={tie.leg2.homeGoals}
                defaultAway={tie.leg2.awayGoals}
                onSave={(home, away) => setTieLegScore(roundIndex, tie.id, 'leg2', home, away)}
                onClear={() => clearTieLegScore(roundIndex, tie.id, 'leg2')}
              />
              <div className="mt-2 rounded border border-neonPink/20 p-2">
                <button type="button" className="btn-secondary" onClick={() => coinTossTie(roundIndex, tie.id)}>
                  Coin Toss for Decider Home
                </button>
                <p className="mt-1 text-zinc-400">
                  Decider home: {(tie.coinTossWinnerId && playerMap[tie.coinTossWinnerId]?.name) || 'Not decided'}
                </p>
                <ScoreLegInput
                  label="Deciding Match"
                  defaultHome={tie.decider.homeGoals}
                  defaultAway={tie.decider.awayGoals}
                  onSave={(home, away) => setTieLegScore(roundIndex, tie.id, 'decider', home, away)}
                  onClear={() => clearTieLegScore(roundIndex, tie.id, 'decider')}
                />
              </div>
              <p className="mt-2 text-neonPink">Winner: {(tie.winnerId && playerMap[tie.winnerId]?.name) || 'Pending'}</p>
            </div>
          ))}
        </div>
      ))}

      {finalSeries && (
        <div className="panel space-y-3">
          <h3 className="section-heading">Final Match - Best of 3</h3>
          <p className="text-xs text-zinc-300">
            {(finalSeries.player1Id && playerMap[finalSeries.player1Id]?.name) || 'TBD'} vs {(finalSeries.player2Id && playerMap[finalSeries.player2Id]?.name) || 'TBD'}
          </p>
          {finalSeries.games.map((game, index) => (
            <div key={game.id} className="grid gap-2 rounded border border-neonPurple/25 bg-zinc-950/70 p-2 text-xs md:grid-cols-[1fr_auto_auto_auto] md:items-center">
              <span>Match {index + 1}</span>
              <select
                className="input"
                value={game.winnerId ?? ''}
                onChange={(event) =>
                  setFinalGameResult(game.id, event.target.value || null, false)
                }
              >
                <option value="">Pending</option>
                {finalSeries.player1Id && (
                  <option value={finalSeries.player1Id}>
                    {playerMap[finalSeries.player1Id]?.name}
                  </option>
                )}
                {finalSeries.player2Id && (
                  <option value={finalSeries.player2Id}>
                    {playerMap[finalSeries.player2Id]?.name}
                  </option>
                )}
              </select>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => setFinalGameResult(game.id, null, true)}
              >
                Mark Void
              </button>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => clearFinalGameResult(game.id)}
              >
                Clear
              </button>
              <span className="text-zinc-400">{game.void ? 'Replay Required' : 'Recorded'}</span>
            </div>
          ))}
          <p className="text-sm text-neonPink">
            Champion: {(finalSeries.championId && playerMap[finalSeries.championId]?.name) || 'Pending'}
          </p>
        </div>
      )}
    </section>
  )
}

const ScoreLegInput = ({
  label,
  defaultHome,
  defaultAway,
  onSave,
  onClear,
}: {
  label: string
  defaultHome: number | null
  defaultAway: number | null
  onSave: (home: number, away: number) => void
  onClear: () => void
}) => {
  const [home, setHome] = useState<string>(defaultHome?.toString() ?? '')
  const [away, setAway] = useState<string>(defaultAway?.toString() ?? '')

  useEffect(() => {
    setHome(defaultHome?.toString() ?? '')
    setAway(defaultAway?.toString() ?? '')
  }, [defaultHome, defaultAway])

  const typedNumber = (value: string) => value.replace(/[^0-9]/g, '')
  const parsedHome = home === '' ? NaN : Number(home)
  const parsedAway = away === '' ? NaN : Number(away)
  const canSave = Number.isInteger(parsedHome) && Number.isInteger(parsedAway)

  return (
    <div className="mt-2 grid gap-2 md:grid-cols-[100px_80px_80px_auto_auto] md:items-center">
      <span>{label}</span>
      <input
        className="input input-score"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="0"
        value={home}
        onChange={(event) => setHome(typedNumber(event.target.value))}
      />
      <input
        className="input input-score"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="0"
        value={away}
        onChange={(event) => setAway(typedNumber(event.target.value))}
      />
      <button className="btn-primary" type="button" disabled={!canSave} onClick={() => onSave(parsedHome, parsedAway)}>
        Save
      </button>
      <button
        className="btn-secondary"
        type="button"
        onClick={() => {
          setHome('')
          setAway('')
          onClear()
        }}
      >
        Reset
      </button>
    </div>
  )
}

const SettingsManagement = () => {
  const { state, setSettings, setAdminPassword, exportState, importState, resetTournament } = useTournament()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [newPassword, setNewPassword] = useState(state.settings.adminPassword)
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  const exportData = () => {
    const blob = new Blob([JSON.stringify(exportState(), null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'techstorm-tournament-backup.json'
    anchor.click()
    URL.revokeObjectURL(url)
    setFeedback({ tone: 'ok', text: 'Backup exported successfully.' })
  }

  const importData = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Record<string, unknown>
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.players)) {
          throw new Error('Backup format is invalid.')
        }
        importState(parsed as unknown as TournamentState)
        setFeedback({ tone: 'ok', text: 'Data imported successfully.' })
      } catch {
        setFeedback({ tone: 'error', text: 'Invalid backup file.' })
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  const warnAndReset = () => {
    const proceed = window.confirm(
      'Warning: This will clear all localStorage tournament data. Continue?',
    )
    if (!proceed) return
    resetTournament()
    setFeedback({ tone: 'ok', text: 'Tournament data cleared.' })
  }

  return (
    <section className="space-y-4">
      <div className="panel space-y-3">
        <h3 className="section-heading">Settings</h3>
        {feedback && (
          <p className={`rounded border px-3 py-2 text-xs ${feedback.tone === 'ok' ? 'border-emerald-300/50 bg-emerald-500/10 text-emerald-100' : 'border-red-300/50 bg-red-500/10 text-red-100'}`}>
            {feedback.text}
          </p>
        )}
        <label className="text-xs text-zinc-300">
          Tournament Name
          <input
            className="input mt-1"
            value={state.settings.tournamentName}
            onChange={(event) => setSettings({ tournamentName: event.target.value })}
          />
        </label>
        <label className="text-xs text-zinc-300">
          Admin Password
          <div className="mt-1 flex gap-2">
            <input
              className="input"
              type="text"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                if (!newPassword.trim()) {
                  setFeedback({ tone: 'error', text: 'Admin password cannot be empty.' })
                  return
                }
                setAdminPassword(newPassword)
                setFeedback({ tone: 'ok', text: 'Admin password updated.' })
              }}
            >
              Save Password
            </button>
          </div>
        </label>
      </div>

      <div className="panel flex flex-wrap gap-2">
        <button type="button" className="btn-secondary" onClick={exportData}>
          Export Data
        </button>
        <button type="button" className="btn-secondary" onClick={() => fileRef.current?.click()}>
          Import Data
        </button>
        <button type="button" className="btn-danger" onClick={warnAndReset}>
          Clear Tournament Data
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={importData} />
      </div>
      <div className="panel">
        <p className="text-xs text-amber-300">
          Warning banner: clearing browser storage removes all saved tournament progress unless exported.
        </p>
      </div>
    </section>
  )
}

const EmptyState = ({ text }: { text: string }) => (
  <section className="panel">
    <p className="text-sm text-zinc-300">{text}</p>
  </section>
)

const App = () => (
  <TournamentProvider>
    <AppShell />
  </TournamentProvider>
)

export default App
