import type { RunResult } from '../engine/types'

// The debrief is deliberately a small RaidLens wipe report: mechanics ranked by
// failure count, in the same voice. If you practise here and then read the real
// debrief on raid night, they should read the same way.

export default function Debrief({ result, onRetry, onQuit }: {
  result: RunResult; onRetry: () => void; onQuit: () => void
}) {
  const { cleared, failures } = result
  const clean = failures.length === 0

  return (
    <div className="debrief">
      <div className="debrief-head">
        <div className={`debrief-verdict ${cleared ? 'ok' : 'bad'}`}>
          {cleared ? 'Boss down' : result.deathCause ? 'You died' : 'Enrage — out of time'}
        </div>
        <div className="debrief-sub">
          {result.survivedSec}s
          {!cleared && <> · boss left at <strong>{Math.round(result.bossHpLeft * 100)}%</strong></>}
          {result.deathCause && <> · killed by <strong>{result.deathCause}</strong></>}
        </div>
      </div>

      <div className="debrief-stats">
        <div className="stat"><span className="stat-num">{result.mechanicsResolved}</span><span className="stat-lab">mechanics faced</span></div>
        <div className="stat"><span className="stat-num">{failures.reduce((n, f) => n + f.count, 0)}</span><span className="stat-lab">failures</span></div>
        <div className="stat"><span className="stat-num">{Math.round(result.raidHealthLow * 100)}%</span><span className="stat-lab">lowest raid HP</span></div>
        <div className="stat"><span className="stat-num">{result.alliesLost}</span><span className="stat-lab">raiders lost</span></div>
      </div>

      {clean ? (
        <p className="debrief-clean">Nothing leaked. Clean pull — that is exactly how it should look.</p>
      ) : (
        <table className="debrief-table">
          <thead><tr><th>Mechanic</th><th>Failures</th><th>What went wrong</th></tr></thead>
          <tbody>
            {failures.map(f => (
              <tr key={f.mechanicId}>
                <td className="mech">{f.name}</td>
                <td className="count">{f.count}</td>
                <td className="why">{f.failText}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="debrief-actions">
        <button className="btn primary" onClick={onRetry}>Pull again</button>
        <button className="btn" onClick={onQuit}>Change boss or role</button>
      </div>
    </div>
  )
}
