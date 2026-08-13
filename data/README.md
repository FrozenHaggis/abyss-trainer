# Source of truth

The verified ability data each boss is authored from — spell IDs, categories,
`dispellable` / `interruptible` flags and Heroic/Mythic tags, all derived from
real WarcraftLogs data by the RaidLens analyser.

These files are **vendored deliberately**. The honesty tests in `test/` check
every mechanic in `src/bosses/` against them, so the checks have to run anywhere
the repo is cloned — including CI. Pointing them at a sibling checkout made the
tests pass locally and fail on the runner, which is the worst of both worlds.

Regenerate with `raidlens abilities --boss <key> --merge` and copy the result
here.
