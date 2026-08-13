import { useCallback, useState } from 'react'
import type { BossDef, Role, RunResult } from './engine/types'
import { abilitiesFor } from './engine/sim'
import { BOSSES } from './bosses/registry'
import Arena from './ui/Arena'
import Debrief from './ui/Debrief'
import RoleIcon from './ui/RoleIcon'
import BossSigil from './ui/BossSigil'

type Screen =
  | { s: 'pick' }
  | { s: 'play'; boss: BossDef; role: Role; nonce: number }
  | { s: 'done'; boss: BossDef; role: Role; result: RunResult }

const ROLE_BLURB: Record<Role, string> = {
  tank: 'Hold the boss, keep its cones off the raid, swap before stacks turn lethal.',
  healer: 'Keep the raid bar up through unavoidable damage and clear what can be dispelled.',
  dps: 'Stay alive, stay on target, and cover the interrupts.',
}

export default function App() {
  const [screen, setScreen] = useState<Screen>({ s: 'pick' })
  const [boss, setBoss] = useState<BossDef>(BOSSES[0])
  const [role, setRole] = useState<Role>('dps')

  const onEnd = useCallback((result: RunResult) => {
    setScreen(sc => sc.s === 'play' ? { s: 'done', boss: sc.boss, role: sc.role, result } : sc)
  }, [])

  if (screen.s === 'play') {
    return (
      <Arena
        key={screen.nonce}
        boss={screen.boss}
        role={screen.role}
        onEnd={onEnd}
      />
    )
  }

  if (screen.s === 'done') {
    return (
      <div className="shell">
        <Debrief
          result={screen.result}
          onRetry={() => setScreen({ s: 'play', boss: screen.boss, role: screen.role, nonce: Date.now() })}
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

        <div className="controls-help">
          <strong>WASD</strong> to move · <strong>1–4</strong> for abilities ·
          the arena edge is lethal, and everything on screen is your job
        </div>

        <p className="credits">
          Boss and role art from <a href="https://game-icons.net" target="_blank" rel="noreferrer">game-icons.net</a>,
          CC BY 3.0. Music is not bundled — see ATTRIBUTION.md to add your own.
        </p>

        <button
          className="btn primary big"
          onClick={() => setScreen({ s: 'play', boss, role, nonce: Date.now() })}
        >
          Pull {boss.name}
        </button>
      </section>
    </div>
  )
}
