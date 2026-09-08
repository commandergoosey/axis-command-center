# Post-Ship Sync

After every PR merge to main — whether via `/zv10-ship`, `/gs06-ship`, `/pipeline-mini`, `/pipeline`, `/pipeline-heavy`, or any manual `gh pr merge` — always run:

```bash
git fetch origin main
```

This keeps the local `origin/main` ref current so the next branch cut (`git checkout -b ship/XX origin/main`) forks from the latest code. Without this, the next feature branch starts from a stale base, causing avoidable merge conflicts.

This is best-effort — if the fetch fails (offline, transient network), log a warning and continue.
