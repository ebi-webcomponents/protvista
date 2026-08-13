# ProtVista Starter Kit

Visualise **your own protein annotations** alongside public UniProt tracks —
without writing any JavaScript. You provide data in a supported format and
configure the viewer via JSON.

## Quick start

1. Copy this folder anywhere.
2. Serve it with any static file server (browsers block `fetch` from
   `file://` pages):

   ```bash
   cd starter-kit
   npx serve .        # or: python3 -m http.server 8000
   ```

3. Open the printed URL. You should see the viewer for `P05067` with:
   - **My annotations** — two tracks loaded from `data/my-features.json`
   - **Public: domains & sites** — a track fetched live from the UniProt
     Proteins API

## The three files

| File                    | Role                                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `index.html`            | Loads ProtVista from a CDN and points it at the config via the `config-src` attribute.        |
| `config.json`           | The **viewer configuration**: which categories/tracks exist and where each one gets its data. |
| `data/my-features.json` | A **track payload**: your annotations, in the format the chosen adapter expects.              |

Configuration and payloads are two separate contracts:

- The **configuration** is validated against
  [`schema/protvista-config.schema.json`](../schema/protvista-config.schema.json).
  Most editors (VS Code included) will autocomplete and validate
  `config.json` automatically thanks to its `$schema` field.
- Each **payload** must match what its `adapter` expects. The
  `feature-adapter` used here consumes the
  [UniProt Proteins API features format](https://www.ebi.ac.uk/proteins/api/doc/):
  an object with a `features` array, where every feature has `type`, `begin`,
  `end`, and optionally `description` and `evidences`.

## Adapting it to your protein

1. Change `accession="P05067"` in `index.html` to your protein.
2. Replace the features in `data/my-features.json` with your own (keep
   `begin`/`end` as strings of 1-based sequence coordinates).
3. Adjust track names, labels, and `filter` values in `config.json`. The
   `filter` value must match your features' `type` field.
4. Add or remove categories/tracks freely — the viewer mounts whatever the
   configuration describes.

If the configuration is invalid, the viewer logs every problem (with a JSON
pointer to the offending value) in the browser console and falls back to the
default UniProt view, so a typo never leaves you with a blank page.

## Going further

- All supported `trackType` and `adapter` values are enumerated in the
  [configuration schema](../schema/protvista-config.schema.json) and
  documented in [docs/configuration.md](../docs/configuration.md).
- To mix in more public tracks, copy entries from the default configuration
  in [`src/config.ts`](../src/config.ts).
