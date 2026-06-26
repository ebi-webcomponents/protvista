# Bench results

Captured: 2026-04-29T13:33:27.855Z
Commit: `14632a3`

Numeric cells show `median (min–max)`.

## Lighthouse (5 runs)

| Scenario               | Perf       | LCP                | TBT              | CLS              | Speed Index     |
| ---------------------- | ---------- | ------------------ | ---------------- | ---------------- | --------------- |
| `accession=P05067`     | 69 (38–70) | 5.5 s (5.5–5.8)    | 22 ms (18–910)   | 0.00 (0.00–0.00) | 2.1 s (2.0–2.9) |
| `accession=P38398`     | 52 (45–53) | 46.4 s (46.2–46.7) | 266 ms (260–403) | 0.00 (0.00–0.00) | 4.2 s (3.7–4.6) |
| `accession=A0A2K5ULD0` | 80 (78–82) | 2.4 s (2.2–2.6)    | 35 ms (16–42)    | 0.00 (0.00–0.00) | 2.2 s (2.0–2.2) |

### Custom milestones (5 runs)

| Scenario               | fetch-and-parse | render       | total           |
| ---------------------- | --------------- | ------------ | --------------- |
| `accession=P05067`     | 1.7 s (1.6–2.3) | 7 ms (7–8)   | 1.7 s (1.6–2.3) |
| `accession=P38398`     | 5.2 s (4.3–5.8) | 7 ms (6–9)   | 5.2 s (4.3–5.8) |
| `accession=A0A2K5ULD0` | 1.8 s (1.4–1.9) | 11 ms (9–12) | 1.8 s (1.5–1.9) |

## Bundle size (library, `dist/`)

| Total raw | Total gzip | Files |
| --------- | ---------- | ----- |
| 4546.3 KB | 1135.6 KB  | 1     |
