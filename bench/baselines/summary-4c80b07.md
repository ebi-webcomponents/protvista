# Bench results

Captured: 2026-04-28T18:15:26.550Z
Commit: `4c80b07`

Numeric cells show `median (min–max)`.

## Lighthouse (5 runs)

| Scenario                       | Perf       | LCP                | TBT              | CLS              | Speed Index     |
| ------------------------------ | ---------- | ------------------ | ---------------- | ---------------- | --------------- |
| `accession=P05067&bench=1`     | 69 (68–70) | 5.5 s (5.4–5.6)    | 44 ms (35–53)    | 0.00 (0.00–0.00) | 2.2 s (2.0–2.4) |
| `accession=P38398&bench=1`     | 48 (46–52) | 46.7 s (46.1–47.0) | 341 ms (308–389) | 0.00 (0.00–0.00) | 4.0 s (2.5–4.5) |
| `accession=A0A2K5ULD0&bench=1` | 80 (76–82) | 2.3 s (2.2–2.7)    | 33 ms (23–116)   | 0.00 (0.00–0.00) | 2.1 s (2.0–2.4) |

### Custom milestones (5 runs)

| Scenario                       | fetch-and-parse | render           | total           |
| ------------------------------ | --------------- | ---------------- | --------------- |
| `accession=P05067&bench=1`     | 2.1 s (1.5–2.4) | 326 ms (317–335) | 2.5 s (1.9–2.7) |
| `accession=P38398&bench=1`     | 4.9 s (4.2–6.6) | 292 ms (291–305) | 5.2 s (4.4–6.9) |
| `accession=A0A2K5ULD0&bench=1` | 1.6 s (1.5–2.1) | 274 ms (273–278) | 1.9 s (1.8–2.4) |

## Bundle size (library, `dist/`)

| Total raw | Total gzip | Files |
| --------- | ---------- | ----- |
| 4545.8 KB | 1135.5 KB  | 1     |
