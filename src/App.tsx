import { useCallback, useState } from 'react'
import type { BossDef, Role, RunResult, Side } from './engine/types'
import { abilitiesFor } from './engine/sim'
import { BOSSES } from './bosses/registry'
import Arena from './ui/Arena'
import Debrief from './ui/Debrief'
import RoleIcon from './ui/RoleIcon'
import { clearLocalTrack, localTrackName, useLocalTrack } from './engine/audio'
import BossSigil from './ui/BossSigil'

type Screen =
  | { s: 'pick' }
  | { s: 'play'; boss: BossDef; role: Role; side: Side; nonce: number; drillId?: string }
  | { s: 'done'; boss: BossDef; role: Role; side: Side; result: RunResult }

const ROLE_BLURB: Record<Role, string> = {
  tank: 'Hold the boss, keep its cones off the raid, swap before stacks turn lethal.',
  healer: 'Keep the raid bar up through unavoidable damage and clear what can be dispelled.',
  dps: 'Stay alive, stay on target, and cover the interrupts.',
}

/**
 * The two halves of a split raid.
 *
 * Not mirror images, which is the whole reason this is a choice rather than a
 * coin flip: one side spends the pull clearing the floor and burning an add,
 * the other spends it stacking a soak and paying for it in permanent pools. A
 * raider who has only ever played green has not practised the fight.
 */
const SIDES: { side: Side; label: string; golem: string; blurb: string }[] = [
  {
    side: 'green',
    label: 'Green',
    golem: "Breath of Ula'tek",
    blurb: 'Soak the Toxic Droplets before they erupt, then dodge the Living Venom each soak sends back at the golem. Nothing here can be interrupted, so the Venom Coagulation add is a kill-speed race and nothing else.',
  },
  {
    side: 'red',
    label: 'Red',
    golem: "Blood of Ula'tek",
    blurb: 'Stack on whoever Unstable Miasma marks so the hit splits between you. Every soaker then drops a Blood Venom pool, and those stay for the rest of the pull — the floor you are standing on is the one your side spent.',
  },
]

export default function App() {
  const [screen, setScreen] = useState<Screen>({ s: 'pick' })
  const [track, setTrack] = useState<string | null>(localTrackName())
  const [boss, setBoss] = useState<BossDef>(BOSSES[0])
  const [role, setRole] = useState<Role>('dps')
  // Only means anything on a `sided` fight. Kept here rather than per-boss so
  // the picker remembers which half you were practising.
  const [side, setSide] = useState<Side>('green')

  const onEnd = useCallback((result: RunResult) => {
    setScreen(sc => sc.s === 'play' ? { s: 'done', boss: sc.boss, role: sc.role, side: sc.side, result } : sc)
  }, [])

  /** Abandon the pull and go back to the picker. No debrief — you did not finish. */
  const onQuit = useCallback(() => setScreen({ s: 'pick' }), [])

  if (screen.s === 'play') {
    return (
      <Arena
        key={screen.nonce}
        boss={screen.boss}
        role={screen.role}
        side={screen.side}
        drillId={screen.drillId}
        onEnd={onEnd}
        onQuit={onQuit}
      />
    )
  }

  if (screen.s === 'done') {
    return (
      <div className="shell">
        <Debrief
          result={screen.result}
          onRetry={() => setScreen({ s: 'play', boss: screen.boss, role: screen.role, side: screen.side, nonce: Date.now() })}
          onQuit={() => setScreen({ s: 'pick' })}
        />
      </div>
    )
  }

  return (
    <div className="shell">
      <header className="title">
        <h1>World of Claudcraft</h1>
        <p className="tag">
          <strong>Curse of Claude'Tek</strong> — learn the Heroic mechanics of The Venomous
          Abyss before the raid opens. The bosses have silly names. The mechanics do not.
        </p>
      </header>

      <section className="pick">
        <h2>Boss</h2>
        <div className="cards">
          {BOSSES.map(b => (
            <button
              key={b.key}
              className={`card${b.key === boss.key ? ' on' : ''}`}
              onClick={() => setBoss(b)}
            >
              <span className="card-title with-icon">
                <BossSigil bossKey={b.key} size={30} /> {b.name}
              </span>
              <span className="card-real">teaches {b.realName}</span>
              <span className="card-sub">{b.blurb}</span>
            </button>
          ))}
        </div>

        <h2>Role</h2>
        <div className="cards">
          {(['tank', 'healer', 'dps'] as Role[]).map(r => (
            <button
              key={r}
              className={`card${r === role ? ' on' : ''}`}
              onClick={() => setRole(r)}
            >
              <span className="card-title with-icon">
                <RoleIcon role={r} size={26} /> {r}
              </span>
              <span className="card-sub">{ROLE_BLURB[r]}</span>
              <span className="card-keys">
                {abilitiesFor(r).map((a, i) => <em key={a}>{i + 1} {a}</em>)}
              </span>
            </button>
          ))}
        </div>

        {/* Which half of the raid you are running with. Sits next to the role
            picker because it is the same kind of decision: it changes which
            mechanics are aimed at you, not just where you stand. */}
        {boss.sided && (
          <>
            <h2>Side</h2>
            <div className="cards">
              {SIDES.map(s => (
                <button
                  key={s.side}
                  className={`card side-${s.side}${s.side === side ? ' on' : ''}`}
                  onClick={() => setSide(s.side)}
                >
                  <span className="card-title with-icon">
                    <span className={`side-dot side-${s.side}`} /> {s.label}
                  </span>
                  <span className="card-real">{s.golem}</span>
                  <span className="card-sub">{s.blurb}</span>
                </button>
              ))}
            </div>
            <p className="controls-note">
              The raid splits in half, one group per golem, and each half stays inside 40
              yards of its own and more than 40 from the other. Standing in range of both
              stacks both Marks — that is the mistake this fight is built to punish, and
              the one your healers pay for.
            </p>
          </>
        )}

        <h2>Controls</h2>
        <div className="controls">
          <div className="ctrl"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Move</span></div>
          <div className="ctrl"><kbd>Mouse</kbd><span>Aim</span></div>
          <div className="ctrl"><kbd>Hold LMB</kbd><span>Shoot</span></div>
          <div className="ctrl"><kbd>Space</kbd><span>Shoot nearest</span></div>
          <div className="ctrl"><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><span>Abilities</span></div>
          <div className="ctrl"><kbd>Esc</kbd><span>Leave pull</span></div>
        </div>
        <p className="controls-note">
          The boss only dies from shots you land, so every second spent dodging is a
          second off the kill. The arena edge is lethal, and everything on screen is
          your job.
        </p>

        <h2>Drill one mechanic</h2>
        <p className="controls-note">
          A full pull gives you two reps of a mechanic. A drill gives you twenty:
          one mechanic on loop, no enrage, and dying just puts you back on your feet.
        </p>
        <div className="drills">
          {boss.mechanics
            .filter(m => m.rule.type !== 'raidDamage' && m.shape)
            .map(m => (
              <button
                key={m.id}
                className="drill"
                onClick={() => setScreen({ s: 'play', boss, role, side, nonce: Date.now(), drillId: m.id })}
              >
                {m.name}
              </button>
            ))}
        </div>

        <h2>Music</h2>
        <div className="musicpick">
          <label className="btn musicbtn">
            {track ? 'Change track' : 'Load a track from your PC'}
            <input
              type="file"
              accept="audio/*"
              onChange={e => {
                const f = e.target.files?.[0]
                if (f) { useLocalTrack(f); setTrack(f.name) }
              }}
            />
          </label>
          {track && (
            <>
              <span className="musicname">♪ {track}</span>
              <button className="btn" onClick={() => { clearLocalTrack(); setTrack(null) }}>Clear</button>
            </>
          )}
        </div>
        <p className="musicnote">
          Plays on pull and ducks under the callouts. The file is read in your browser
          and never uploaded — nothing is shared with anyone else, so your own copy of a
          soundtrack works here. Each raider loads their own.
        </p>

        <p className="credits">
          Boss and role art from <a href="https://game-icons.net" target="_blank" rel="noreferrer">game-icons.net</a>,
          CC BY 3.0. Music is not bundled — see ATTRIBUTION.md to add your own.
        </p>

        <button
          className="btn primary big"
          onClick={() => setScreen({ s: 'play', boss, role, side, nonce: Date.now() })}
        >
          Pull {boss.name}
        </button>
      </section>
    </div>
  )
}
