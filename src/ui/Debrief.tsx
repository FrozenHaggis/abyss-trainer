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
        {/* Uptime, in the only currency the fight cares about. Dodging costs
            damage, and this is where you find out how much. */}
        <div className="stat">
          <span className="stat-num">
            {result.shotsFired ? Math.round((result.shotsHit / result.shotsFired) * 100) : 0}%
          </span>
          <span className="stat-lab">shots on target</span>
        </div>
        {(result.addsKilled > 0 || result.addsLeaked > 0) && (
          <div className="stat">
            <span className="stat-num">{result.addsLeaked}</span>
            <span className="stat-lab">adds leaked</span>
          </div>
        )}
        {/* The stack economy, on the one fight that has one. Three numbers, not
            one, because they are answered differently: your own peak is where
            you stood, the raid's is whether the soak rota held, and the shed
            count is whether you ever played the other direction at all. A pull
            lost to globules nobody swept looks identical to a pull lost to bad
            footwork if you only report the first of them. */}
        {result.venomPeak !== undefined && (
          <div className="stat">
            <span className="stat-num">{result.venomPeak}</span>
            <span className="stat-lab">peak venom on you</span>
          </div>
        )}
        {result.venomRaidPeak !== undefined && (
          <div className="stat">
            <span className="stat-num">{result.venomRaidPeak}</span>
            <span className="stat-lab">worst on a raider</span>
          </div>
        )}
        {/* The only one of the three that measures something the player DID
            rather than something that happened to them. A peak of six with
            nothing shed and a peak of six with four shed are two completely
            different pulls: the first never found a Ravenous Feast bite, the
            second took ten stacks and worked. Zero is printed rather than
            hidden, because a pull that shed nothing is exactly the pull that
            needs to be told so. */}
        {result.venomShed !== undefined && (
          <div className="stat">
            <span className="stat-num">{result.venomShed}</span>
            <span className="stat-lab">stacks shed</span>
          </div>
        )}
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
