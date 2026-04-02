import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { TournamentProvider, useGroupFixtures, usePlayerMap, useTournament } from './context/TournamentContext'
import { calculateStandings } from './utils/tournament'
import { MAX_PLAYERS, MIN_PLAYERS } from './utils/tournament'
import type { Fixture, Group, StandingRow, Tiebreaker, TournamentState, KnockoutRound } from './types'
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

type Page = 'groups' | 'fixtures' | 'stats' | 'knockout' | 'rules' | 'admin'
type AdminTab = 'players' | 'groups' | 'fixtures' | 'score_entry' | 'knockout' | 'settings'

const navItems: Array<{ key: Page; label: string }> = [
  { key: 'groups', label: 'Groups' },
  { key: 'fixtures', label: 'Fixtures' },
  { key: 'stats', label: 'Stats' },
  { key: 'knockout', label: 'Knockout' },
  { key: 'rules', label: 'Rules' },
  { key: 'admin', label: 'Admin' },
]

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
  const [page, setPage] = useState<Page>('groups')
  const isKnockoutPage = page === 'knockout'

  return (
    <div 
      className="min-h-screen text-white" 
      style={{ 
        background: '#09090f',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header
        className="sticky top-0 z-40 backdrop-blur-md"
        style={{
          borderBottom: '1px solid rgba(168,85,247,0.12)',
          background: 'rgba(9,9,15,0.88)',
          paddingTop: 'env(safe-area-inset-top)',
        }}
      >
        <div className="mx-auto flex max-w-full flex-col md:flex-row md:items-center md:justify-between gap-2 md:gap-4 px-2 py-2 sm:px-3 sm:py-2.5 md:px-4 md:py-3.5 lg:px-8">
          <div className="flex-shrink-0">
            <h1
              style={{
                fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
                fontSize: 'clamp(10px, 3vw, 13px)',
                fontWeight: 700,
                letterSpacing: '2px',
                color: '#d8b4fe',
                textTransform: 'uppercase' as const,
                margin: 0,
                lineHeight: 1.2,
              }}
            >
              TechStorm EA FC Mobile Tournament
            </h1>
            <p 
              className="mt-0.5" 
              style={{ 
                fontSize: 'clamp(8px, 1.8vw, 10px)',
                color: 'rgba(184,176,200,0.7)',
                margin: 0,
                lineHeight: 1.2,
                letterSpacing: '0.5px',
              }}
            >
              FC Mobile Championship Console
            </p>
          </div>
          <nav 
            className="flex flex-wrap gap-1 sm:gap-1.5 md:gap-2 justify-start md:justify-end"
            role="navigation"
          >
            {navItems.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setPage(item.key)}
                className="rounded-lg px-1.5 sm:px-2.5 md:px-3.5 py-1.5 sm:py-2 font-semibold uppercase tracking-wider transition-all duration-200 touch-manipulation text-xs flex-1 sm:flex-initial min-h-[40px] sm:min-h-[44px] flex items-center justify-center"
                style={{
                  fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
                  fontSize: 'clamp(0.65rem, 1.5vw, 0.75rem)',
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
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 'clamp(4px, 1vw, 8px) clamp(8px, 1.5vw, 14px)',
                }}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main
        className={`fade-in w-full px-3 py-4 sm:px-4 md:px-6 lg:px-8 flex-1 ${
          isKnockoutPage ? '' : 'mx-auto max-w-7xl'
        }`}
        style={{
          paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
          paddingLeft: 'max(var(--spacing-md), env(safe-area-inset-left))',
          paddingRight: 'max(var(--spacing-md), env(safe-area-inset-right))',
        }}
      >
        <div
          className={`content-shell w-full space-y-6 ${
            isKnockoutPage ? '' : 'mx-auto max-w-6xl'
          }`}
        >
          {page === 'groups' && <GroupsPage />}
          {page === 'fixtures' && <FixturesPage />}
          {page === 'stats' && <StatsPage />}
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
          Welcome to <span style={{ color: '#d8b4fe', textShadow: '0 0 18px rgba(168,85,247,0.3)' }}>GROUP STAGE</span>
        </h1>
        <p style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: 'clamp(14px, 2vw, 16px)',
          letterSpacing: '2px',
          color: 'rgba(216,180,254,0.6)',
          margin: '16px 0 0 0',
        }}>
          Groups will appear here once generated in the Admin panel
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

  return (
    <section className="space-y-6">
      {/* Header with arena-style title */}
      <div 
        className="panel text-center space-y-2"
        style={{
          background: 'linear-gradient(145deg, rgba(24, 18, 38, 0.95) 0%, rgba(14, 9, 24, 0.98) 100%)',
          border: '1px solid rgba(168,85,247,0.2)',
          padding: 'clamp(1.5rem, 3vw, 2rem)',
        }}
      >
        <div style={{
          fontSize: 'clamp(10px, 2vw, 12px)',
          letterSpacing: '8px',
          color: 'rgba(168,85,247,0.45)',
          marginBottom: '4px',
        }}>✦ ✦ ✦</div>
        <div style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: 'clamp(9px, 1.8vw, 10px)',
          fontWeight: 700,
          letterSpacing: '6px',
          color: 'rgba(216,180,254,0.65)',
          textTransform: 'uppercase' as const,
          marginBottom: '2px',
        }}>
          TechStorm EA FC Mobile Tournament
        </div>
        <h1 style={{
          fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
          fontSize: 'clamp(24px, 5vw, 40px)',
          fontWeight: 800,
          color: '#f0edf5',
          textShadow: '0 0 28px rgba(168, 85, 247, 0.18)',
          letterSpacing: '2px',
          lineHeight: 1.1,
          margin: '0.5rem 0 0 0',
        }}>
          GROUP <span style={{ color: '#d8b4fe', textShadow: '0 0 18px rgba(168,85,247,0.3)' }}>STAGE</span>
        </h1>
        <p style={{
          fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
          fontSize: 'clamp(8px, 1.5vw, 9px)',
          letterSpacing: '4px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase' as const,
          marginTop: '8px',
        }}>
          Real-time standings update as scores are entered
        </p>
      </div>
      {state.groups.map((group) => (
        <div key={group.id} className="panel">
          <h3
            style={{
              fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
              fontSize: 'clamp(11px, 3vw, 11px)',
              fontWeight: 700,
              letterSpacing: '3px',
              color: '#d8b4fe',
              textTransform: 'uppercase' as const,
              margin: 0,
            }}
          >
            {group.name}
          </h3>
          <div className="mt-4 w-full overflow-x-auto -mx-3 px-3 sm:-mx-4 sm:px-4 md:mx-0 md:px-0">
            <table className="w-full text-left text-xs md:text-sm" style={{ minWidth: '400px' }}>
              <thead>
                <tr>
                  {['Player', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts'].map((h) => (
                    <th
                      key={h}
                      className="px-1.5 sm:px-3 py-1.5 sm:py-2.5"
                      style={{
                        color: 'rgba(168,85,247,0.7)',
                        fontWeight: 600,
                        fontSize: 'clamp(7px, 2vw, 10px)',
                        letterSpacing: '0.5px',
                        textTransform: 'uppercase',
                        borderBottom: '1px solid rgba(168,85,247,0.12)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const groupFixtures = state.fixtures.filter((fixture) => fixture.groupId === group.id)
                  const completedGroupFixtures = groupFixtures.filter((fixture) => fixture.completed)
                  const showFullQualifierHighlight =
                    groupFixtures.length > 0 && completedGroupFixtures.length === groupFixtures.length

                  return standingsByGroup[group.id]?.map((row, idx) => {
                    const isQualifier = state.stage !== 'setup' && idx < 2
                    const useFullQualifierStyle = isQualifier && showFullQualifierHighlight

                    return (
                      <tr
                        key={row.playerId}
                        style={{
                          borderTop: '1px solid rgba(168,85,247,0.08)',
                          background: useFullQualifierStyle
                            ? 'rgba(34, 197, 94, 0.15)'
                            : idx % 2 === 0
                            ? 'transparent'
                            : 'rgba(168,85,247,0.03)',
                          borderLeft: isQualifier ? '3px solid rgba(34, 197, 94, 0.6)' : 'none',
                        }}
                      >
                        <td
                          className="px-1.5 sm:px-3 py-1.5 sm:py-2.5 font-medium"
                          style={{
                            color: useFullQualifierStyle ? '#86efac' : '#e9d5ff',
                            maxWidth: '80px',
                            fontSize: 'clamp(7px, 2vw, 0.875rem)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={playerMap[row.playerId]?.name}
                        >
                          {playerMap[row.playerId]?.name}
                        </td>
                        <td className="px-1.5 sm:px-3 py-1.5 sm:py-2.5 text-center text-xs sm:text-sm">{row.p}</td>
                        <td className="px-1.5 sm:px-3 py-1.5 sm:py-2.5 text-center text-xs sm:text-sm">{row.w}</td>
                        <td className="px-1.5 sm:px-3 py-1.5 sm:py-2.5 text-center text-xs sm:text-sm">{row.d}</td>
                        <td className="px-1.5 sm:px-3 py-1.5 sm:py-2.5 text-center text-xs sm:text-sm">{row.l}</td>
                        <td className="px-1.5 sm:px-3 py-1.5 sm:py-2.5 text-center text-xs sm:text-sm">{row.gf}</td>
                        <td className="px-1.5 sm:px-3 py-1.5 sm:py-2.5 text-center text-xs sm:text-sm">{row.ga}</td>
                        <td className="px-1.5 sm:px-3 py-1.5 sm:py-2.5 text-center text-xs sm:text-sm">{row.gd}</td>
                        <td
                          className="px-1.5 sm:px-3 py-1.5 sm:py-2.5 font-semibold text-center text-xs sm:text-sm"
                          style={{ color: useFullQualifierStyle ? '#86efac' : '#d8b4fe' }}
                        >
                          {row.points}
                        </td>
                      </tr>
                    )
                  })
                })()}
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
          Welcome to <span style={{ color: '#d8b4fe', textShadow: '0 0 18px rgba(168,85,247,0.3)' }}>MATCH FIXTURES</span>
        </h1>
        <p style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: 'clamp(14px, 2vw, 16px)',
          letterSpacing: '2px',
          color: 'rgba(216,180,254,0.6)',
          margin: '16px 0 0 0',
        }}>
          Fixtures will appear here once groups are confirmed in the Admin panel
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

  return (
    <section className="space-y-6">
      {/* Header with arena-style title */}
      <div 
        className="panel text-center space-y-2"
        style={{
          background: 'linear-gradient(145deg, rgba(24, 18, 38, 0.95) 0%, rgba(14, 9, 24, 0.98) 100%)',
          border: '1px solid rgba(168,85,247,0.2)',
          padding: 'clamp(1.5rem, 3vw, 2rem)',
        }}
      >
        <div style={{
          fontSize: 'clamp(10px, 2vw, 12px)',
          letterSpacing: '8px',
          color: 'rgba(168,85,247,0.45)',
          marginBottom: '4px',
        }}>✦ ✦ ✦</div>
        <div style={{
          fontFamily: "'Rajdhani', sans-serif",
          fontSize: 'clamp(9px, 1.8vw, 10px)',
          fontWeight: 700,
          letterSpacing: '6px',
          color: 'rgba(216,180,254,0.65)',
          textTransform: 'uppercase' as const,
          marginBottom: '2px',
        }}>
          TechStorm EA FC Mobile Tournament
        </div>
        <h1 style={{
          fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
          fontSize: 'clamp(24px, 5vw, 40px)',
          fontWeight: 800,
          color: '#f0edf5',
          textShadow: '0 0 28px rgba(168, 85, 247, 0.18)',
          letterSpacing: '2px',
          lineHeight: 1.1,
          margin: '0.5rem 0 0 0',
        }}>
          MATCH <span style={{ color: '#d8b4fe', textShadow: '0 0 18px rgba(168,85,247,0.3)' }}>FIXTURES</span>
        </h1>
        <p style={{
          fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
          fontSize: 'clamp(8px, 1.5vw, 9px)',
          letterSpacing: '4px',
          color: 'var(--text-muted)',
          textTransform: 'uppercase' as const,
          marginTop: '8px',
        }}>
          Top 2 teams qualify from each group
        </p>
      </div>
      {state.groups.map((group) => {
        const groupFixtures = state.fixtures.filter((fixture) => fixture.groupId === group.id)
        if (!groupFixtures.length) return null

        return (
          <div key={group.id} className="panel space-y-4">
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              paddingBottom: '12px',
              borderBottom: '1px solid rgba(168,85,247,0.1)',
            }}>
              <div style={{
                width: '4px',
                height: '24px',
                background: 'linear-gradient(180deg, rgba(168,85,247,0.6), rgba(236,72,153,0.5))',
                borderRadius: '4px',
              }}></div>
              <h3
                style={{
                  fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
                  fontSize: 'clamp(11px, 3vw, 13px)',
                  fontWeight: 700,
                  letterSpacing: '2px',
                  color: '#d8b4fe',
                  textTransform: 'uppercase' as const,
                  margin: 0,
                }}
              >
                {group.name}
              </h3>
              <div style={{
                marginLeft: 'auto',
                fontSize: '11px',
                color: 'rgba(168,85,247,0.6)',
                letterSpacing: '1px',
              }}>
                {groupFixtures.length} Match{groupFixtures.length !== 1 ? 'es' : ''}
              </div>
            </div>
            <div className="space-y-2">
              {groupFixtures.map((fixture) => (
                <div
                  key={fixture.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg px-3 sm:px-4 py-3 sm:py-3 text-xs sm:text-sm transition-all duration-200 hover:border-opacity-50"
                  style={{
                    border: `1px solid ${fixture.completed ? 'rgba(16,185,129,0.3)' : 'rgba(168,85,247,0.15)'}`,
                    background: fixture.completed
                      ? 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(16,185,129,0.03) 100%)'
                      : 'linear-gradient(135deg, rgba(168,85,247,0.06) 0%, rgba(24,20,34,0.8) 100%)',
                    backdropFilter: 'blur(4px)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: '#e9d5ff', fontSize: 'clamp(0.75rem, 1.5vw, 0.875rem)', wordBreak: 'break-word', fontWeight: 500 }}>
                      {playerMap[fixture.homeId]?.name}
                    </div>
                    <div style={{ color: 'rgba(168,85,247,0.4)', fontSize: '10px', margin: '4px 0', letterSpacing: '1px' }}>vs</div>
                    <div style={{ color: '#e9d5ff', fontSize: 'clamp(0.75rem, 1.5vw, 0.875rem)', wordBreak: 'break-word', fontWeight: 500 }}>
                      {playerMap[fixture.awayId]?.name}
                    </div>
                  </div>
                  <div
                    className="font-semibold whitespace-nowrap px-3 py-1.5 rounded-lg"
                    style={{
                      background: fixture.completed ? 'rgba(16,185,129,0.12)' : 'rgba(168,85,247,0.08)',
                      color: fixture.completed ? '#6ee7b7' : 'rgba(184,176,200,0.7)',
                      fontSize: fixture.completed ? 'clamp(0.75rem, 1.5vw, 0.875rem)' : '10px',
                      letterSpacing: fixture.completed ? '1px' : '2px',
                      textAlign: 'center',
                      minWidth: '80px',
                    }}
                  >
                    {fixture.completed ? `${fixture.homeGoals} – ${fixture.awayGoals}` : 'PENDING'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </section>
  )
}

type PlayerStatsRow = {
  playerId: string
  matches: number
  goalsFor: number
  goalsAgainst: number
  cleanSheets: number
  highestGoalsInMatch: number
}

const aggregatePlayerStats = (state: TournamentState): PlayerStatsRow[] => {
  const stats = state.players.reduce<Record<string, PlayerStatsRow>>((acc, player) => {
    acc[player.id] = {
      playerId: player.id,
      matches: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      cleanSheets: 0,
      highestGoalsInMatch: 0,
    }
    return acc
  }, {})

  const recordMatch = (
    homeId: string | null,
    awayId: string | null,
    homeGoals: number | null,
    awayGoals: number | null,
    completed: boolean,
  ) => {
    if (!completed || homeId === null || awayId === null) return
    if (homeGoals === null || awayGoals === null) return
    if (!stats[homeId] || !stats[awayId]) return

    stats[homeId].matches += 1
    stats[awayId].matches += 1

    stats[homeId].goalsFor += homeGoals
    stats[homeId].goalsAgainst += awayGoals
    stats[awayId].goalsFor += awayGoals
    stats[awayId].goalsAgainst += homeGoals

    if (awayGoals === 0) stats[homeId].cleanSheets += 1
    if (homeGoals === 0) stats[awayId].cleanSheets += 1

    stats[homeId].highestGoalsInMatch = Math.max(stats[homeId].highestGoalsInMatch, homeGoals)
    stats[awayId].highestGoalsInMatch = Math.max(stats[awayId].highestGoalsInMatch, awayGoals)
  }

  state.fixtures.forEach((fixture) => {
    recordMatch(
      fixture.homeId,
      fixture.awayId,
      fixture.homeGoals,
      fixture.awayGoals,
      fixture.completed,
    )
  })

  state.knockout.rounds.forEach((round) => {
    round.ties.forEach((tie) => {
      recordMatch(
        tie.playerAId,
        tie.playerBId,
        tie.leg1.homeGoals,
        tie.leg1.awayGoals,
        tie.leg1.completed,
      )
      recordMatch(
        tie.playerBId,
        tie.playerAId,
        tie.leg2.homeGoals,
        tie.leg2.awayGoals,
        tie.leg2.completed,
      )

      const deciderHomeId = tie.decider.homeId
      const deciderAwayId =
        deciderHomeId && tie.playerAId && tie.playerBId
          ? deciderHomeId === tie.playerAId
            ? tie.playerBId
            : tie.playerAId
          : null

      recordMatch(
        deciderHomeId,
        deciderAwayId,
        tie.decider.homeGoals,
        tie.decider.awayGoals,
        tie.decider.completed,
      )
    })
  })

  return Object.values(stats)
}

const StatsPage = () => {
  const { state } = useTournament()
  const playerMap = usePlayerMap()

  const statsRows = useMemo(() => aggregatePlayerStats(state), [state])
  const hasCompletedMatch = useMemo(
    () => statsRows.some((row) => row.matches > 0),
    [statsRows],
  )

  const topScorers = useMemo(
    () =>
      [...statsRows]
        .filter((row) => row.goalsFor > 0)
        .sort((a, b) => {
          if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor
          if (a.matches !== b.matches) return a.matches - b.matches
          return (playerMap[a.playerId]?.name ?? '').localeCompare(playerMap[b.playerId]?.name ?? '')
        })
        .slice(0, 10),
    [statsRows, playerMap],
  )

  const leastConceders = useMemo(
    () =>
      [...statsRows]
        .filter((row) => row.matches > 0)
        .sort((a, b) => {
          if (a.goalsAgainst !== b.goalsAgainst) return a.goalsAgainst - b.goalsAgainst
          if (b.matches !== a.matches) return b.matches - a.matches
          return (playerMap[a.playerId]?.name ?? '').localeCompare(playerMap[b.playerId]?.name ?? '')
        })
        .slice(0, 10),
    [statsRows, playerMap],
  )

  const mostCleanSheets = useMemo(() => {
    const best = [...statsRows].sort((a, b) => {
      if (b.cleanSheets !== a.cleanSheets) return b.cleanSheets - a.cleanSheets
      if (b.matches !== a.matches) return b.matches - a.matches
      return (playerMap[a.playerId]?.name ?? '').localeCompare(playerMap[b.playerId]?.name ?? '')
    })[0] ?? null

    if (!best || best.cleanSheets <= 0) return null
    return best
  }, [statsRows, playerMap])

  const bestSingleMatchScorer = useMemo(() => {
    const best = [...statsRows].sort((a, b) => {
      if (b.highestGoalsInMatch !== a.highestGoalsInMatch) {
        return b.highestGoalsInMatch - a.highestGoalsInMatch
      }
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor
      return (playerMap[a.playerId]?.name ?? '').localeCompare(playerMap[b.playerId]?.name ?? '')
    })[0] ?? null

    if (!best || best.highestGoalsInMatch <= 0) return null
    return best
  }, [statsRows, playerMap])

  if (!state.players.length) {
    return (
      <StatsWelcomeState
        title="TOURNAMENT STATS"
        message="Add players and start the tournament to unlock leaderboard insights."
      />
    )
  }

  if (!hasCompletedMatch) {
    return (
      <StatsWelcomeState
        title="TOURNAMENT STATS"
        message="No data yet. Stats will appear after at least 1 match is completed."
      />
    )
  }

  return (
    <section className="space-y-6">
      <div className="panel space-y-3">
        <h2 className="section-heading">Tournament Stats</h2>
        <p className="text-xs text-zinc-300">
          Rankings include completed group-stage matches and completed knockout legs.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="panel space-y-2">
          <p className="text-xs uppercase tracking-wider text-neonPurple">Most Clean Sheets</p>
          <p className="text-lg font-semibold text-zinc-100">
            {mostCleanSheets ? playerMap[mostCleanSheets.playerId]?.name : 'No clean sheets yet'}
          </p>
          <p className="text-xs text-zinc-400">
            {mostCleanSheets ? `${mostCleanSheets.cleanSheets} clean sheet(s)` : 'Play and complete matches to unlock this stat.'}
          </p>
        </div>
        <div className="panel space-y-2">
          <p className="text-xs uppercase tracking-wider text-neonPink">Highest Goals in a Single Match</p>
          <p className="text-lg font-semibold text-zinc-100">
            {bestSingleMatchScorer ? playerMap[bestSingleMatchScorer.playerId]?.name : 'No data'}
          </p>
          <p className="text-xs text-zinc-400">
            {bestSingleMatchScorer
              ? `${bestSingleMatchScorer.highestGoalsInMatch} goal(s) in one match`
              : 'Enter completed scores to calculate.'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel overflow-x-auto">
          <h3 className="section-heading text-xs sm:text-sm">Top 10 Highest Goal Scorers</h3>
          <table className="mt-3 w-full text-left text-xs sm:text-sm" style={{ minWidth: '420px' }}>
            <thead className="text-neonPurple">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Player</th>
                <th className="px-2 py-2 text-center">GF</th>
                <th className="px-2 py-2 text-center">Matches</th>
              </tr>
            </thead>
            <tbody>
              {topScorers.length > 0 ? (
                topScorers.map((row, index) => (
                  <tr key={row.playerId} className="border-t border-neonPurple/20">
                    <td className="px-2 py-2">{index + 1}</td>
                    <td className="px-2 py-2">{playerMap[row.playerId]?.name ?? 'Unknown'}</td>
                    <td className="px-2 py-2 text-center font-semibold text-neonPink">{row.goalsFor}</td>
                    <td className="px-2 py-2 text-center">{row.matches}</td>
                  </tr>
                ))
              ) : (
                <tr className="border-t border-neonPurple/20">
                  <td className="px-2 py-3 text-center text-zinc-400" colSpan={4}>
                    No goal scorers yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="panel overflow-x-auto">
          <h3 className="section-heading text-xs sm:text-sm">Top 10 Least Goal Conceders</h3>
          <table className="mt-3 w-full text-left text-xs sm:text-sm" style={{ minWidth: '420px' }}>
            <thead className="text-neonPurple">
              <tr>
                <th className="px-2 py-2">#</th>
                <th className="px-2 py-2">Player</th>
                <th className="px-2 py-2 text-center">GA</th>
                <th className="px-2 py-2 text-center">Matches</th>
              </tr>
            </thead>
            <tbody>
              {leastConceders.map((row, index) => (
                <tr key={row.playerId} className="border-t border-neonPurple/20">
                  <td className="px-2 py-2">{index + 1}</td>
                  <td className="px-2 py-2">{playerMap[row.playerId]?.name ?? 'Unknown'}</td>
                  <td className="px-2 py-2 text-center font-semibold text-emerald-300">{row.goalsAgainst}</td>
                  <td className="px-2 py-2 text-center">{row.matches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

const StatsWelcomeState = ({ title, message }: { title: string; message: string }) => (
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
    <div
      style={{
        fontSize: 'clamp(14px, 2.5vw, 18px)',
        letterSpacing: '8px',
        color: 'rgba(168,85,247,0.45)',
        marginBottom: '12px',
      }}
    >
      ✦ ✦ ✦
    </div>
    <h1
      style={{
        fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
        fontSize: 'clamp(32px, 6vw, 52px)',
        fontWeight: 800,
        color: '#f0edf5',
        textShadow: '0 0 28px rgba(168, 85, 247, 0.18)',
        letterSpacing: '3px',
        lineHeight: 1.1,
        margin: '16px 0',
      }}
    >
      Welcome to <span style={{ color: '#d8b4fe', textShadow: '0 0 18px rgba(168,85,247,0.3)' }}>{title}</span>
    </h1>
    <p
      style={{
        fontFamily: "'Rajdhani', sans-serif",
        fontSize: 'clamp(14px, 2vw, 16px)',
        letterSpacing: '2px',
        color: 'rgba(216,180,254,0.6)',
        margin: '16px 0 0 0',
      }}
    >
      {message}
    </p>
    <div
      style={{
        fontSize: 'clamp(14px, 2.5vw, 18px)',
        letterSpacing: '8px',
        color: 'rgba(168,85,247,0.45)',
        marginTop: '12px',
      }}
    >
      ✦ ✦ ✦
    </div>
  </section>
)

const RULES_SECTIONS = [
  {
    title: 'General Guidelines',
    rules: [
      'Platform: EA SPORTS FC™ Mobile (FIFA Mobile)',
      'Game Mode: Head-to-Head (H2H) Friendly Match',
      'Tournament Format: Multi-stage tournament consisting of a Group Stage (League System) followed by Knockout Rounds',
      'Matchmaking: OVR-based matchmaking/seeding may be used where applicable',
      'Minimum OVR Requirement: All participants must have at least an OVR of 110',
      'Device Policy: Players must use their own mobile device. Power banks are allowed',
      'Internet Policy: Players may use the provided Wi-Fi. Players may also use their own mobile network at their own risk',
      'Accounts: Borrowed accounts are allowed only with prior declaration during registration and consent of the account owner',
      'Fair Play Policy: Any exploitation of bugs or glitches will result in immediate disqualification. Toxic behavior, abuse, or misconduct may lead to removal from the tournament',
      'Reporting Time: Players must report 10 minutes before their scheduled match. A 5-minute grace period is allowed; failure to report results in a walkover',
      'Event Authority: Decisions made by tournament organizers/referees are final and binding',
      'Event Type: This is an offline event conducted at the event venue',
      'Registration Policy: Registration fees are strictly non-refundable',
    ]
  },
  {
    title: 'Match Guidelines',
    rules: [
      'Match Format: 1 vs 1',
      'Team Type: Play with your account',
      'Controls: Any in-game control mode is allowed (Buttons/Gestures)',
      'Camera: Any in-game camera angle is allowed',
      'Substitutions & Tactics: Allowed',
      'Cross Spamming Rule: Cross spamming is strictly prohibited. Maximum 1 intentional cross-to-header attempt per half. Referee\'s discretion will apply in unclear situations',
    ]
  },
  {
    title: 'Disconnection & Technical Rules',
    rules: [
      'Disconnection (Within 2 in-game minutes): Full rematch',
      'Disconnection (After 2 in-game minutes): Score stands; organizers decide whether to resume or rematch',
      'Draw Rule - League Stage: Draws allowed',
      'Draw Rule - Knockout Stage: Immediate rematch until a winner is decided',
      'Match Recording: Organizers/players reserve the right to record matches for verification',
      'Device Malfunction: Device-related issues are the player\'s responsibility. No automatic rematch unless approved by organizers/referees',
    ]
  },
  {
    title: 'Tournament Structure',
    rules: [
      'League Stage (Group-Based): All registered players will be divided into groups based on OVR balancing. Each group will follow a League format, where players play within their group. Draws are allowed during League Stage. Group rankings and qualification will be determined based on overall match performance, as decided by the tournament organizers. Qualified players from each group will qualify for the Knockout Rounds',
      'Knockout Rounds: Players who qualify from the League Stage will advance to Knockout Rounds. From the Knockout Rounds onwards, matches will follow a Home & Away (Two-Leg) System. Each knockout pairing will consist of: One Home match and One Away match. Winner Determination: The player with the higher aggregate score across both matches will advance. If Aggregate Score is Tied: The player with more home goals will be declared the winner. If still tied, one deciding match will be played. The home goal advantage of the rematch will be decided by a toss. Knockout rounds will continue until the Final. If draw happens rematch will be conducted followed by higher Group Stage goal difference (GD) count in case of another draw in the rematch',
    ]
  },
  {
    title: 'Final Match Rules',
    rules: [
      'Format: The Final will be played in a Best of 3 format',
      'Victory: The first player to win 2 matches will be declared the Champion',
      'Disconnection: If a match in the Final is disconnected, only that particular match will be replaced',
      'Guidelines: All general and match guidelines remain applicable during the Final',
    ]
  },
  {
    title: 'Final Authority',
    rules: [
      'The decision of the TechStorm EA FC Mobile Tournament Management Team will be final and binding in all matters, including but not limited to match outcomes, rule interpretations, disputes, and unforeseen situations',
    ]
  },
];

const RulesPage = () => (
  <section className="panel space-y-4 sm:space-y-6 text-sm">
    <h2
      style={{
        fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
        fontSize: 'clamp(13px, 4vw, 14px)',
        fontWeight: 700,
        letterSpacing: '4px',
        color: '#d8b4fe',
        textTransform: 'uppercase' as const,
        margin: 0,
      }}
    >
      Tournament Rules
    </h2>
    
    <div className="space-y-5 sm:space-y-6">
      {RULES_SECTIONS.map((section, sectionIdx) => (
        <div key={sectionIdx} className="space-y-2.5">
          <h3
            style={{
              fontFamily: "'Orbitron', 'Rajdhani', sans-serif",
              fontSize: 'clamp(11px, 3vw, 12px)',
              fontWeight: 700,
              letterSpacing: '2px',
              color: '#ec4899',
              textTransform: 'uppercase' as const,
              margin: 0,
              paddingBottom: '0.5rem',
              borderBottom: '2px solid rgba(236,72,153,0.3)',
            }}
          >
            {section.title}
          </h3>
          
          <div className="space-y-2 pl-2">
            {section.rules.map((rule, ruleIdx) => (
              <div
                key={ruleIdx}
                className="flex items-start gap-2.5 sm:gap-3 rounded-lg px-3 sm:px-4 py-2 sm:py-2.5 transition-all duration-200 hover:border-purple-400/30"
                style={{
                  border: '1px solid rgba(168,85,247,0.15)',
                  background: 'rgba(24,20,34,0.3)',
                }}
              >
                <span
                  style={{
                    fontFamily: "'Orbitron', sans-serif",
                    fontSize: 'clamp(7px, 1.5vw, 8px)',
                    fontWeight: 700,
                    color: 'rgba(236,72,153,0.6)',
                    minWidth: '20px',
                    paddingTop: '2px',
                    flexShrink: 0,
                  }}
                >
                  ▸
                </span>
                <span 
                  style={{ 
                    color: 'var(--text-secondary)',
                    fontSize: 'clamp(0.8rem, 2.5vw, 0.875rem)',
                    lineHeight: '1.5',
                  }}
                >
                  {rule}
                </span>
              </div>
            ))}
          </div>
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
      <section 
        style={{
          minHeight: 'calc(100vh - 120px)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 'clamp(1.5rem, 3vw, 2rem)',
        }}
      >
        <div className="panel max-w-md w-full">
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
        </div>
      </section>
    )
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap gap-1 sm:gap-2">
        {(['players', 'groups', 'fixtures', 'score_entry', 'knockout', 'settings'] as AdminTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setAdminTab(tab)}
            className="rounded-lg px-2 sm:px-3 py-2 text-xs uppercase tracking-wider transition-all duration-200 touch-manipulation flex-1 min-w-fit sm:flex-initial min-h-[44px] flex items-center justify-center"
            style={{
              border: `1px solid ${
                adminTab === tab ? 'rgba(168,85,247,0.35)' : 'rgba(168,85,247,0.12)'
              }`,
              background: adminTab === tab ? 'rgba(168,85,247,0.1)' : 'rgba(24,20,34,0.4)',
              color: adminTab === tab ? '#d8b4fe' : 'rgba(184,176,200,0.7)',
              fontSize: 'clamp(0.65rem, 2vw, 0.75rem)',
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
        <div className="flex flex-col sm:flex-row gap-2 flex-wrap">
          <label className="btn-secondary cursor-pointer flex-1 sm:flex-initial text-center">
            Upload Excel (.xlsx)
            <input type="file" accept=".xlsx" onChange={onExcelUpload} className="hidden" />
          </label>
          <button
            type="button"
            className="btn-danger flex-1 sm:flex-initial"
            onClick={confirmDeleteAllPlayers}
            disabled={!state.players.length}
          >
            Delete All Players
          </button>
          <span className="text-xs text-zinc-400 self-center">
            Required columns: Player Name | OVR Rating {excelLoading ? '(processing...)' : ''}
          </span>
        </div>
        <form className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3" onSubmit={submitPlayer}>
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
              className="btn-secondary col-span-1 sm:col-span-2 lg:col-span-1"
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
        <div className="hidden sm:block">
          <table className="w-full text-left text-xs sm:text-sm">
            <thead className="text-neonPurple">
              <tr>
                <th className="px-2 sm:px-3 py-2 sm:py-3 text-xs sm:text-sm">Name</th>
                <th className="px-2 sm:px-3 py-2 sm:py-3 text-xs sm:text-sm">OVR</th>
                <th className="px-2 sm:px-3 py-2 sm:py-3 text-xs sm:text-sm">Group</th>
                <th className="px-2 sm:px-3 py-2 sm:py-3 text-xs sm:text-sm">Actions</th>
              </tr>
            </thead>
            <tbody>
              {state.players.map((player) => (
                <tr key={player.id} className="border-t border-neonPurple/20">
                  <td className="px-2 sm:px-3 py-2 sm:py-3 text-xs sm:text-sm truncate">{player.name}</td>
                  <td className="px-2 sm:px-3 py-2 sm:py-3 text-xs sm:text-sm">{player.ovr}</td>
                  <td className="px-2 sm:px-3 py-2 sm:py-3 text-xs sm:text-sm">{state.groups.find((group) => group.id === player.groupId)?.name || '-'}</td>
                  <td className="px-2 sm:px-3 py-2 sm:py-3">
                    <div className="flex gap-1 sm:gap-2 flex-wrap">
                      <button
                        className="btn-secondary px-1.5 sm:px-2 py-1 text-xs"
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
                        className="btn-danger px-1.5 sm:px-2 py-1 text-xs"
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

        {/* Mobile card view */}
        <div className="sm:hidden space-y-2 p-2">
          {state.players.map((player) => (
            <div key={player.id} className="rounded border border-neonPurple/30 bg-zinc-950/70 p-3 space-y-2">
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-neonPurple font-semibold uppercase tracking-wider mb-1">Name</p>
                  <p className="text-sm font-semibold text-zinc-100 truncate">{player.name}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-neonPurple font-semibold uppercase tracking-wider mb-1">OVR</p>
                  <p className="text-sm font-semibold text-zinc-100">{player.ovr}</p>
                </div>
              </div>
              <div className="flex justify-between items-start gap-2">
                <div className="flex-1">
                  <p className="text-xs text-neonPurple font-semibold uppercase tracking-wider mb-1">Group</p>
                  <p className="text-sm text-zinc-300">{state.groups.find((group) => group.id === player.groupId)?.name || '-'}</p>
                </div>
              </div>
              <div className="flex gap-2 pt-2 border-t border-neonPurple/20">
                <button
                  className="btn-secondary flex-1 py-2 text-xs"
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
                  className="btn-danger flex-1 py-2 text-xs"
                  type="button"
                  onClick={() => confirmDeletePlayer(player.id, player.name)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

const GroupManagement = () => {
  const {
    state,
    setSettings,
    generateGroups,
    createGroup,
    deleteGroup,
    movePlayerToGroup,
    lockGroups,
  } = useTournament()
  const canGenerate = state.players.length >= MIN_PLAYERS
  const [feedback, setFeedback] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [newGroupName, setNewGroupName] = useState('')
  const [groupToDeleteId, setGroupToDeleteId] = useState('')
  const [destinationGroupId, setDestinationGroupId] = useState('')

  const onExportGroups = () => {
    try {
      exportGroupsToExcel(state.groups, state.players, state.settings.tournamentName)
      setFeedback({ tone: 'ok', text: 'Groups exported to Excel successfully.' })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not export groups.'
      setFeedback({ tone: 'error', text: message })
    }
  }

  const onCreateGroup = () => {
    const groupId = createGroup(newGroupName)
    if (!groupId) {
      setFeedback({ tone: 'error', text: 'Could not create group.' })
      return
    }

    const displayName = newGroupName.trim() || 'New group'
    setFeedback({ tone: 'ok', text: `${displayName} created.` })
    setNewGroupName('')
  }

  const onDeleteGroup = () => {
    if (!groupToDeleteId) {
      setFeedback({ tone: 'error', text: 'Select a group to delete.' })
      return
    }

    const group = state.groups.find((item) => item.id === groupToDeleteId)
    if (!group) {
      setFeedback({ tone: 'error', text: 'Selected group was not found.' })
      return
    }

    const hasPlayers = group.playerIds.length > 0
    const destination = hasPlayers ? destinationGroupId : null

    if (hasPlayers && (!destination || destination === groupToDeleteId)) {
      setFeedback({
        tone: 'error',
        text: 'Choose a valid destination group to move players before deletion.',
      })
      return
    }

    const proceed = window.confirm(
      hasPlayers
        ? `Delete ${group.name}? Players will be moved and fixtures updated.`
        : `Delete ${group.name}?`,
    )

    if (!proceed) return

    const deleted = deleteGroup(groupToDeleteId, destination)
    if (!deleted) {
      setFeedback({ tone: 'error', text: 'Could not delete group. Check selected options.' })
      return
    }

    setFeedback({ tone: 'ok', text: `${group.name} deleted successfully.` })
    setGroupToDeleteId('')
    setDestinationGroupId('')
  }

  return (
    <section className="space-y-4">
      <div className="panel space-y-3">
        <h3 className="section-heading">Group Generator</h3>
        <p className="text-xs text-zinc-300">
          Configure groups for {state.players.length} players. Minimum {MIN_PLAYERS}, maximum {MAX_PLAYERS}.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
          <button type="button" className="btn-primary mt-auto" onClick={generateGroups} disabled={!canGenerate}>
            {state.settings.seedingMode === 'ovr_snake'
              ? 'Generate OVR Snake Groups'
              : state.settings.seedingMode === 'random'
                ? 'Generate Random Groups'
                : 'Generate Manual Order Groups'}
          </button>
          <button
            type="button"
            className="btn-secondary mt-auto"
            onClick={lockGroups}
            disabled={!state.groups.length}
          >
            Confirm Groups & Create Fixtures
          </button>
          <button
            type="button"
            className="btn-secondary sm:col-span-2 lg:col-span-1 mt-auto"
            onClick={onExportGroups}
            disabled={!state.groups.length}
          >
            Export Groups (.xlsx)
          </button>
          {!canGenerate && <p className="text-xs text-amber-300 sm:col-span-2 lg:col-span-4">Add at least two players before generating groups.</p>}
        </div>
        <div className="grid gap-2 border-t border-neonPurple/20 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-zinc-300 sm:col-span-2">
            Create Group (optional custom name)
            <input
              className="input mt-1"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="e.g. Group H"
            />
          </label>
          <button type="button" className="btn-primary mt-auto" onClick={onCreateGroup}>
            Create Group Mid-Tournament
          </button>
          <p className="text-xs text-zinc-400 mt-auto">
            Useful for late player entry when current groups are full.
          </p>
        </div>
        <div className="grid gap-2 border-t border-neonPurple/20 pt-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-zinc-300">
            Group To Delete
            <select
              className="input mt-1"
              value={groupToDeleteId}
              onChange={(event) => {
                setGroupToDeleteId(event.target.value)
                if (destinationGroupId === event.target.value) {
                  setDestinationGroupId('')
                }
              }}
            >
              <option value="">Select group</option>
              {state.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name} ({group.playerIds.length} players)
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-300">
            Move Players To (if needed)
            <select
              className="input mt-1"
              value={destinationGroupId}
              onChange={(event) => setDestinationGroupId(event.target.value)}
            >
              <option value="">Select destination</option>
              {state.groups
                .filter((group) => group.id !== groupToDeleteId)
                .map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            type="button"
            className="btn-danger mt-auto"
            onClick={onDeleteGroup}
            disabled={state.groups.length <= 1}
          >
            Delete Selected Group
          </button>
          <p className="text-xs text-zinc-400 mt-auto">
            Deletion removes that group&apos;s fixtures and resets knockout progress.
          </p>
        </div>
        {feedback && (
          <p className={`rounded border px-3 py-2 text-xs ${feedback.tone === 'ok' ? 'border-emerald-300/50 bg-emerald-500/10 text-emerald-100' : 'border-red-300/50 bg-red-500/10 text-red-100'}`}>
            {feedback.text}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {state.groups.map((group) => (
          <div key={group.id} className="panel">
            <h4 className="section-heading text-xs sm:text-sm">{group.name}</h4>
            <div className="mt-3 space-y-2">
              {group.playerIds.map((playerId) => {
                const player = state.players.find((item) => item.id === playerId)
                if (!player) return null
                return (
                  <div key={player.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 rounded border border-neonPurple/25 bg-zinc-950/80 p-2 text-xs">
                    <span className="truncate">
                      {player.name} ({player.ovr})
                    </span>
                    {!state.groupsLocked && (
                      <select
                        className="input w-full sm:w-32 px-2 py-1 text-xs"
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
      <div className="panel flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
        <p className="rounded border border-emerald-300/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100">
          Top 2 teams qualify from each group.
        </p>
        <label className="text-xs text-zinc-200">
          Primary Tiebreaker
          <select
            className="input mt-1 w-full sm:w-48"
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
            key={`${fixture.id}:${fixture.homeGoals ?? ''}:${fixture.awayGoals ?? ''}`}
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
      <h3 className="section-heading text-xs sm:text-sm">{group.name} Standings</h3>
      <div className="mt-3 overflow-x-auto -mx-3 px-3 sm:-mx-4 sm:px-4 md:mx-0 md:px-0">
        <table className="w-full text-left text-xs sm:text-sm" style={{ minWidth: '500px' }}>
          <thead className="text-neonPurple">
            <tr>
              <th className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm">Player</th>
              <th className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">P</th>
              <th className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">W</th>
              <th className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">D</th>
              <th className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">L</th>
              <th className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">GF</th>
              <th className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">GA</th>
              <th className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">GD</th>
              <th className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">Pts</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row) => (
              <tr key={row.playerId} className="border-t border-neonPurple/20">
                <td className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm truncate">{playerMap[row.playerId]?.name || '-'}</td>
                <td className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">{row.p}</td>
                <td className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">{row.w}</td>
                <td className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">{row.d}</td>
                <td className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">{row.l}</td>
                <td className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">{row.gf}</td>
                <td className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">{row.ga}</td>
                <td className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center">{row.gd}</td>
                <td className="px-1.5 sm:px-2 py-1.5 sm:py-2 text-xs sm:text-sm text-center font-semibold text-neonPink">{row.points}</td>
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
  const { confirmFixture, isFixtureConfirmed, unconfirmFixture } = useTournament()
  const [home, setHome] = useState<string>(fixture.homeGoals?.toString() ?? '')
  const [away, setAway] = useState<string>(fixture.awayGoals?.toString() ?? '')
  const [isUpdating, setIsUpdating] = useState(false)
  const isConfirmed = isFixtureConfirmed(fixture.id)

  const typedNumber = (value: string) => value.replace(/[^0-9]/g, '')

  const parsedHome = home === '' ? NaN : Number(home)
  const parsedAway = away === '' ? NaN : Number(away)
  const canConfirm = Number.isInteger(parsedHome) && Number.isInteger(parsedAway) && !isConfirmed

  const handleConfirm = () => {
    setIsUpdating(true)
    onConfirm(parsedHome, parsedAway)
    setTimeout(() => {
      confirmFixture(fixture.id)
      setIsUpdating(false)
    }, 300)
  }

  const getButtonText = () => {
    if (isConfirmed) return 'Confirmed'
    if (isUpdating) return 'Updating...'
    return 'Confirm'
  }

  return (
    <div className={`grid gap-2 rounded border p-2 text-xs sm:grid-cols-[1fr_60px_60px_auto] sm:items-center md:grid-cols-[1fr_auto_auto_auto_auto] md:gap-2 ${
      isConfirmed 
        ? 'border-green-500/50 bg-green-950/30' 
        : 'border-neonPurple/30 bg-zinc-950/70'
    }`}>
      <p className="sm:col-span-4 md:col-span-1">
        {homeName} vs {awayName}
      </p>
      <input
        className="input input-score w-full sm:w-[60px]"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="0"
        value={home}
        onChange={(event) => setHome(typedNumber(event.target.value))}
        disabled={isConfirmed}
      />
      <input
        className="input input-score w-full sm:w-[60px]"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        placeholder="0"
        value={away}
        onChange={(event) => setAway(typedNumber(event.target.value))}
        disabled={isConfirmed}
      />
      <button
        type="button"
        className={`btn-primary col-span-1 sm:col-span-2 md:col-span-1 ${isConfirmed ? 'opacity-75' : ''}`}
        style={isConfirmed ? { backgroundColor: 'rgba(34, 197, 94, 0.2)', borderColor: 'rgba(34, 197, 94, 0.5)' } : undefined}
        disabled={!canConfirm}
        onClick={handleConfirm}
      >
        {getButtonText()}
      </button>
      <button
        type="button"
        className="btn-secondary col-span-1 sm:col-span-2 md:col-span-1"
        onClick={() => {
          setHome('')
          setAway('')
          unconfirmFixture(fixture.id)
          onClear()
        }}
      >
        Reset
      </button>
    </div>
  )
}

const BracketRearrangement = ({
  round,
  playerMap,
  onSwap,
}: {
  round: KnockoutRound
  playerMap: Record<string, { name: string }>
  onSwap: (playerId1: string, playerId2: string) => void
}) => {
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([])

  const allBracketPlayers = Array.from(
    new Set(
      round.ties
        .flatMap((tie) => [tie.playerAId, tie.playerBId])
        .filter((id): id is string => !!id)
    )
  )

  const handlePlayerSelect = (playerId: string) => {
    setSelectedPlayers((prev) => {
      if (prev.includes(playerId)) {
        return prev.filter((id) => id !== playerId)
      }
      if (prev.length < 2) {
        return [...prev, playerId]
      }
      return [playerId]
    })
  }

  const handleSwap = () => {
    if (selectedPlayers.length === 2) {
      onSwap(selectedPlayers[0], selectedPlayers[1])
      setSelectedPlayers([])
    }
  }

  const handleClear = () => {
    setSelectedPlayers([])
  }

  return (
    <div className="panel space-y-4">
      <div className="space-y-2">
        <h3 className="section-heading text-sm sm:text-base flex items-center gap-2">
          <span>🔄</span>
          <span>Rearrange Bracket</span>
        </h3>
        <p className="text-xs sm:text-sm text-zinc-400">
          Select two players to swap their positions in the bracket
        </p>
      </div>

      {/* Selection Display */}
      <div className="rounded-lg bg-zinc-900/50 border border-neonPurple/20 p-3 sm:p-4">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">Selected Players</p>
          <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 items-stretch sm:items-center">
            <div className="flex-1 rounded bg-zinc-800/50 border border-zinc-700 p-3 text-center">
              <p className="text-xs text-zinc-500 mb-1">Player 1</p>
              <p className="text-sm font-semibold text-zinc-100 truncate">
                {selectedPlayers[0] ? playerMap[selectedPlayers[0]]?.name : '—'}
              </p>
            </div>
            <div className="hidden sm:flex items-center justify-center text-neonPurple font-bold">⇄</div>
            <div className="sm:hidden flex items-center justify-center text-neonPurple font-bold py-1">↕</div>
            <div className="flex-1 rounded bg-zinc-800/50 border border-zinc-700 p-3 text-center">
              <p className="text-xs text-zinc-500 mb-1">Player 2</p>
              <p className="text-sm font-semibold text-zinc-100 truncate">
                {selectedPlayers[1] ? playerMap[selectedPlayers[1]]?.name : '—'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Player Grid */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Available Players</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {allBracketPlayers.map((playerId) => {
            const isSelected = selectedPlayers.includes(playerId)
            const selectionIndex = selectedPlayers.indexOf(playerId) + 1
            
            return (
              <button
                key={playerId}
                type="button"
                onClick={() => handlePlayerSelect(playerId)}
                className={`relative p-3 rounded-lg font-medium text-xs sm:text-sm transition-all duration-200 ${
                  isSelected
                    ? 'bg-gradient-to-br from-neonPurple to-purple-600 text-white shadow-lg shadow-neonPurple/50 scale-105'
                    : 'bg-zinc-800 text-zinc-200 hover:bg-zinc-700 border border-zinc-700 hover:border-neonPurple/50'
                }`}
              >
                {isSelected && (
                  <div className="absolute -top-2 -right-2 w-6 h-6 bg-neonPink rounded-full flex items-center justify-center text-white text-xs font-bold">
                    {selectionIndex}
                  </div>
                )}
                <span className="block truncate">{playerMap[playerId]?.name || 'Unknown'}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row gap-2 pt-2">
        <button
          type="button"
          onClick={handleSwap}
          disabled={selectedPlayers.length !== 2}
          className={`flex-1 py-3 px-4 rounded-lg font-semibold text-sm transition-all duration-200 ${
            selectedPlayers.length === 2
              ? 'bg-gradient-to-r from-neonPurple to-purple-600 text-white hover:shadow-lg hover:shadow-neonPurple/50 active:scale-95'
              : 'bg-zinc-700 text-zinc-400 cursor-not-allowed opacity-50'
          }`}
        >
          ✓ Swap Players
        </button>
        {selectedPlayers.length > 0 && (
          <button
            type="button"
            onClick={handleClear}
            className="flex-1 sm:flex-initial py-3 px-4 rounded-lg font-semibold text-sm bg-zinc-800 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Info Message */}
      {selectedPlayers.length === 2 && (
        <div className="rounded-lg bg-green-900/20 border border-green-500/30 p-3">
          <p className="text-xs sm:text-sm text-green-400">
            ✓ Ready to swap {playerMap[selectedPlayers[0]]?.name} and {playerMap[selectedPlayers[1]]?.name}
          </p>
        </div>
      )}
    </div>
  )
}

const KnockoutManagement = () => {
  const {
    state,
    generateKnockout,
    resetKnockout,
    setTieLegScore,
    clearTieLegScore,
    coinTossTie,
    setFinalGameResult,
    clearFinalGameResult,
    swapBracketPlayers,
  } = useTournament()
  const playerMap = usePlayerMap()
  const finalSeries = state.knockout.finalSeries

  return (
    <section className="space-y-4">
      <div className="panel space-y-2">
        <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
          <button
            className="btn-primary flex-1 sm:flex-initial"
            type="button"
            onClick={generateKnockout}
            disabled={!state.fixtures.length}
          >
            Generate Knockout Bracket
          </button>
          {state.knockout.enabled && (
            <button
              className="btn-danger flex-1 sm:flex-initial"
              type="button"
              onClick={() => {
                const proceed = window.confirm(
                  'Reset knockout bracket? This will clear all knockout progress.',
                )
                if (proceed) {
                  resetKnockout()
                }
              }}
            >
              Reset Knockouts
            </button>
          )}
        </div>
      </div>

      {state.knockout.enabled && state.knockout.rounds.length > 0 && state.knockout.rounds[0]?.ties.some(t => !t.playerAId || !t.playerBId) && (
        <div className="panel p-3" style={{ background: 'rgba(251, 146, 60, 0.1)', border: '1px solid rgba(251, 146, 60, 0.3)' }}>
          <p className="text-xs sm:text-sm" style={{ color: 'rgba(251, 146, 60, 0.8)' }}>
            ⚠ Bracket is incomplete · Some group stage matches are still pending · Regenerate bracket after more groups are completed
          </p>
        </div>
      )}

      {state.knockout.enabled && state.knockout.rounds.length > 0 && (
        <BracketRearrangement 
          round={state.knockout.rounds[0]} 
          playerMap={playerMap}
          onSwap={swapBracketPlayers}
        />
      )}

      {state.knockout.rounds.map((round, roundIndex) => (
        <div key={round.id} className="panel space-y-3">
          <h3 className="section-heading text-xs sm:text-sm">{round.name}</h3>
          {round.ties.map((tie) => {
            const playerAName = (tie.playerAId && playerMap[tie.playerAId]?.name) || 'TBD'
            const playerBName = (tie.playerBId && playerMap[tie.playerBId]?.name) || 'TBD'
            // Leg 1: Player A is home, Player B is away
            // Leg 2: Player B is home, Player A is away (away goals rule)
            // Decider: coin toss winner is home
            const deciderHomeName = (tie.coinTossWinnerId && playerMap[tie.coinTossWinnerId]?.name) || null
            const deciderAwayName = deciderHomeName
              ? deciderHomeName === playerAName ? playerBName : playerAName
              : null
            return (
              <div key={tie.id} className="rounded border border-neonPurple/30 bg-zinc-950/70 p-2 sm:p-3 text-xs space-y-2">
                <p className="font-semibold text-zinc-100 text-xs sm:text-sm">
                  {playerAName} <span className="text-zinc-400">vs</span> {playerBName}
                </p>
                <ScoreLegInput
                  key={`${tie.id}:leg1:${tie.leg1.homeGoals ?? ''}:${tie.leg1.awayGoals ?? ''}`}
                  label="Leg 1"
                  homePlayerName={playerAName}
                  awayPlayerName={playerBName}
                  defaultHome={tie.leg1.homeGoals}
                  defaultAway={tie.leg1.awayGoals}
                  onSave={(home, away) => setTieLegScore(roundIndex, tie.id, 'leg1', home, away)}
                  onClear={() => clearTieLegScore(roundIndex, tie.id, 'leg1')}
                />
                <ScoreLegInput
                  key={`${tie.id}:leg2:${tie.leg2.homeGoals ?? ''}:${tie.leg2.awayGoals ?? ''}`}
                  label="Leg 2"
                  homePlayerName={playerBName}
                  awayPlayerName={playerAName}
                  defaultHome={tie.leg2.homeGoals}
                  defaultAway={tie.leg2.awayGoals}
                  onSave={(home, away) => setTieLegScore(roundIndex, tie.id, 'leg2', home, away)}
                  onClear={() => clearTieLegScore(roundIndex, tie.id, 'leg2')}
                />
                <div className="rounded border border-neonPink/20 p-2 sm:p-3 space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <button type="button" className="btn-secondary text-xs flex-1 sm:flex-initial" onClick={() => coinTossTie(roundIndex, tie.id)}>
                      Coin Toss for Decider Home
                    </button>
                    <p className="text-zinc-400 text-xs">
                      Decider home: <span className="text-zinc-200 font-medium">{deciderHomeName || 'Not decided'}</span>
                    </p>
                  </div>
                  <ScoreLegInput
                    key={`${tie.id}:decider:${tie.decider.homeGoals ?? ''}:${tie.decider.awayGoals ?? ''}:${tie.coinTossWinnerId ?? ''}`}
                    label="Deciding Match"
                    homePlayerName={deciderHomeName || 'Home (TBD — run coin toss first)'}
                    awayPlayerName={deciderAwayName || 'Away (TBD)'}
                    defaultHome={tie.decider.homeGoals}
                    defaultAway={tie.decider.awayGoals}
                    onSave={(home, away) => setTieLegScore(roundIndex, tie.id, 'decider', home, away)}
                    onClear={() => clearTieLegScore(roundIndex, tie.id, 'decider')}
                  />
                </div>
                <p className="text-neonPink text-xs sm:text-sm">Winner: {(tie.winnerId && playerMap[tie.winnerId]?.name) || 'Pending'}</p>
              </div>
            )
          })}
        </div>
      ))}

      {finalSeries && (
        <div className="panel space-y-3">
          <h3 className="section-heading text-xs sm:text-sm">Final Match - Best of 3</h3>
          <p className="text-xs sm:text-sm text-zinc-300">
            {(finalSeries.player1Id && playerMap[finalSeries.player1Id]?.name) || 'TBD'} vs {(finalSeries.player2Id && playerMap[finalSeries.player2Id]?.name) || 'TBD'}
          </p>
          {finalSeries.games.map((game, index) => (
            <div key={game.id} className="rounded border border-neonPurple/25 bg-zinc-950/70 p-2 sm:p-3 text-xs space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <span className="text-xs sm:text-sm font-semibold">Match {index + 1}</span>
                <select
                  className="input flex-1 sm:flex-initial"
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
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button
                  className="btn-secondary text-xs flex-1 sm:flex-initial"
                  type="button"
                  onClick={() => setFinalGameResult(game.id, null, true)}
                >
                  Mark Void
                </button>
                <button
                  className="btn-secondary text-xs flex-1 sm:flex-initial"
                  type="button"
                  onClick={() => clearFinalGameResult(game.id)}
                >
                  Clear
                </button>
                <span className="text-zinc-400 text-xs self-center sm:ml-auto">{game.void ? 'Replay Required' : 'Recorded'}</span>
              </div>
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
  homePlayerName,
  awayPlayerName,
  defaultHome,
  defaultAway,
  onSave,
  onClear,
}: {
  label: string
  homePlayerName: string
  awayPlayerName: string
  defaultHome: number | null
  defaultAway: number | null
  onSave: (home: number, away: number) => void
  onClear: () => void
}) => {
  const [home, setHome] = useState<string>(defaultHome?.toString() ?? '')
  const [away, setAway] = useState<string>(defaultAway?.toString() ?? '')
  const [isSaved, setIsSaved] = useState(defaultHome !== null && defaultAway !== null)
  const [isUpdating, setIsUpdating] = useState(false)

  const typedNumber = (value: string) => value.replace(/[^0-9]/g, '')
  const parsedHome = home === '' ? NaN : Number(home)
  const parsedAway = away === '' ? NaN : Number(away)
  const canSave = Number.isInteger(parsedHome) && Number.isInteger(parsedAway) && !isSaved

  const handleSave = () => {
    setIsUpdating(true)
    onSave(parsedHome, parsedAway)
    setTimeout(() => {
      setIsSaved(true)
      setIsUpdating(false)
    }, 300)
  }

  const getSaveButtonText = () => {
    if (isSaved) return 'Saved ✓'
    if (isUpdating) return 'Saving...'
    return 'Save'
  }

  return (
    <div
      className="rounded border p-2 sm:p-3 text-xs space-y-2"
      style={{
        borderColor: isSaved ? 'rgba(34,197,94,0.45)' : 'rgba(168,85,247,0.2)',
        background: isSaved ? 'rgba(34,197,94,0.07)' : 'rgba(9,9,15,0.4)',
      }}
    >
      {/* Label row */}
      <p className="text-[10px] font-semibold tracking-widest uppercase" style={{ color: 'rgba(168,85,247,0.7)' }}>
        {label}
      </p>
      {/* Score entry row */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-2 sm:gap-3">
        {/* Home player */}
        <div className="flex flex-col items-center gap-1 flex-1 sm:flex-initial">
          <span
            className="text-[10px] text-center leading-tight truncate w-full"
            style={{ color: isSaved ? 'rgba(134,239,172,0.9)' : 'rgba(216,180,254,0.8)' }}
            title={homePlayerName}
          >
            {homePlayerName}
          </span>
          <input
            className="input input-score w-full sm:w-[52px] text-center"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="0"
            value={home}
            disabled={isSaved}
            onChange={(event) => setHome(typedNumber(event.target.value))}
            style={isSaved ? { opacity: 0.6 } : undefined}
          />
        </div>
        {/* Divider */}
        <span className="text-zinc-500 font-bold text-sm hidden sm:block">—</span>
        {/* Away player */}
        <div className="flex flex-col items-center gap-1 flex-1 sm:flex-initial">
          <span
            className="text-[10px] text-center leading-tight truncate w-full"
            style={{ color: isSaved ? 'rgba(134,239,172,0.9)' : 'rgba(216,180,254,0.8)' }}
            title={awayPlayerName}
          >
            {awayPlayerName}
          </span>
          <input
            className="input input-score w-full sm:w-[52px] text-center"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="0"
            value={away}
            disabled={isSaved}
            onChange={(event) => setAway(typedNumber(event.target.value))}
            style={isSaved ? { opacity: 0.6 } : undefined}
          />
        </div>
        {/* Action buttons */}
        <div className="flex gap-1.5 w-full sm:w-auto">
          <button
            className={`btn-primary text-xs flex-1 sm:flex-initial ${isSaved ? 'opacity-80' : ''}`}
            type="button"
            disabled={!canSave}
            onClick={handleSave}
            style={isSaved ? { backgroundColor: 'rgba(34,197,94,0.2)', borderColor: 'rgba(34,197,94,0.5)', color: '#86efac' } : undefined}
          >
            {getSaveButtonText()}
          </button>
          <button
            className="btn-secondary text-xs flex-1 sm:flex-initial"
            type="button"
            onClick={() => {
              setHome('')
              setAway('')
              setIsSaved(false)
              onClear()
            }}
          >
            Reset
          </button>
        </div>
      </div>
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
        <label className="text-xs text-zinc-300 w-full">
          Admin Password
          <div className="mt-1 flex flex-col sm:flex-row gap-2">
            <input
              className="input flex-1"
              type="text"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
            />
            <button
              type="button"
              className="btn-primary text-xs sm:text-sm whitespace-nowrap"
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
        <button type="button" className="btn-secondary text-xs sm:text-sm" onClick={exportData}>
          Export Data
        </button>
        <button type="button" className="btn-secondary text-xs sm:text-sm" onClick={() => fileRef.current?.click()}>
          Import Data
        </button>
        <button type="button" className="btn-danger text-xs sm:text-sm" onClick={warnAndReset}>
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
