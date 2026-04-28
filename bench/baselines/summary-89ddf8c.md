# Bench results

Captured: 2026-04-28T16:35:44.483Z

## Bundle size (library, `dist/`)

Commit: `4bab442`

| Total raw | Total gzip | Files |
|---|---|---|
| 4545.8 KB | 1135.5 KB | 1 |

## Lighthouse (median of N runs)

| Scenario | Perf | LCP | TBT | CLS | Speed Index |
|---|---|---|---|---|---|
| `accession=P05067&bench=1` | 70 | 5.4 s | 50 ms | 0 | 1.9 s |
| `accession=P38398&bench=1` | 47 | 46.7 s | 350 ms | 0 | 4.0 s |
| `accession=A0A2K5ULD0&bench=1` | 82 | 2.2 s | 70 ms | 0 | 1.9 s |

### Custom milestones (median run)

| Scenario | fetch-and-parse | render | total |
|---|---|---|---|
| `accession=P05067&bench=1` | 1471 ms | 322 ms | 1794 ms |
| `accession=P38398&bench=1` | 4759 ms | 293 ms | 5052 ms |
| `accession=A0A2K5ULD0&bench=1` | 1390 ms | 276 ms | 1666 ms |
