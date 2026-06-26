# ProtVista adoption & ecosystem

_A curated record of who uses, re-implements, deploys, or cites ProtVista. This single
hand/LLM-maintained table is the source of truth; its **git history** is the point-in-time record._

- **Type:** `package consumer` | `ProtVista-type viewer` | `fork` | `commercial/private` | `unclear`.
- **Evidence:** the strongest public pointer (repo / paper / live site), or
  `private — under agreement` where there is no public artifact.
- **Since / Until:** when the project's ProtVista relationship began and, if it has, ended. The
  *kind* of date is written in each cell because it means different things per type:
  - **package consumer:** `(dep added)` the dependency entered package.json, or `(repo created)`;
    Until `(dep removed)` / `(archived)`.
  - **fork / ProtVista-type viewer:** `(repo created)` or `(paper)` when their viewer first appeared;
    Until is usually `—` (no dependency to remove).
  - **commercial/private:** `(interest)` when engagement began; Until when it ended.
  - **unclear:** `(paper)` / `(UI mention)`.
  - `—` in *Since* means the date is not yet filled (run `protvista_ecosystem.py --backfill-dates` to
    fill repo-created dates); `—` in *Until* means the relationship is ongoing / not applicable.
- **Status:** current liveness (active / dormant / archived); **Last activity:** last repo push.
- Package consumers are refreshed by `scripts/protvista_ecosystem.py`; everything else is human-curated.
- **Out of scope:** generic use of individual `@nightingale-elements/*` track components for unrelated
  purposes (but a ProtVista-style feature viewer built on nightingale counts as a `ProtVista-type viewer`).
- **Consent / PII:** name a commercial/private partner only with recorded consent — otherwise
  `Commercial adopter (<sector>)`. Never add an unconsented name to this file.

## Ecosystem entities

| Project / repo | Type | Evidence | Since | Until | Status | Last activity | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UniProt website (`ebi-uniprot/uniprot-website`) | package consumer | https://github.com/ebi-uniprot/uniprot-website | 2020-04-29 (dep added) | — | active | 2026-04-30 | ProtVista's largest embedder (UniProtKB) |
| GIFTS curation tool (`ebi-uniprot/gifts-curation-tool`) | package consumer | https://github.com/ebi-uniprot/gifts-curation-tool | 2021-10-11 (dep added) | — | active | 2025-12-09 | EBI |
| JCVI Human Salivary Proteome Wiki (`JCVenterInstitute/HSPW-V3`) | package consumer | https://github.com/JCVenterInstitute/HSPW-V3 | 2023-05-10 (dep added) | — | active | 2026-02-04 | — |
| `KSerditov/ProteinSearch` | package consumer | https://github.com/KSerditov/ProteinSearch | 2023-07-22 (dep added) | — | dormant | 2024-02-10 | independent developer |
| `ekondrashkov/proteins` | package consumer | https://github.com/ekondrashkov/proteins | 2024-12-09 (dep added) | — | dormant | 2024-12-10 | independent developer |
| OTPSS (`maniexcelra/OTPSS`) | package consumer | https://github.com/maniexcelra/OTPSS | 2022-06-10 (dep added) | — | dormant | 2024-09-16 | personal Open Targets-derived repo (not official OT); two package.json manifests |
| Open Targets Platform (`opentargets-archive/platform-app`) | package consumer | https://github.com/opentargets-archive/platform-app | 2019-10-08 (dep added) | — (archived) | dormant | 2022-06-22 | historical — Open Targets no longer uses the package |
| Open Targets Genetics (`opentargets-archive/genetics-app`) | package consumer | https://github.com/opentargets-archive/genetics-app | 2025-01-31 (when repo was archived) | — (archived) | dormant | 2025-01-31 | historical — Open Targets no longer uses the package; adoption/archive dates uncertain (archived repo — likely a late commit, verify) |
| GlyGen (`glygener/glygen-frontend`) | unclear | https://www.glygen.org | 2021 (paper) | — | — | — | live `<protvista-uniprot>` deployment via CDN per bioRxiv 10.1101/2021.06.17.448729 (not declared in package.json); current use unverified |
| Pharos / TCRD (`ncats/protvista-viewer`) | fork | https://github.com/ncats/protvista-viewer | 2021-02-09 (repo created) | — | dormant | 2024-08-01 | verified: shares git history with upstream; publishes `ncats-protvista-uniprot` on npm |
| PDBe (`PDBeurope/protvista-pdb`) | ProtVista-type viewer | https://doi.org/10.1101/2022.07.22.500790 | 2022 (paper) | — | active | 2025-07-08 | independent re-implementation (no shared git history) |
| RCSB Saguaro 1D Feature Viewer (`rcsb/rcsb-saguaro`) | ProtVista-type viewer | https://github.com/rcsb/rcsb-saguaro | — (repo created) | — | active | — | RCSB PDB's own 1D sequence-feature viewer (TypeScript); independent — does NOT use protvista or nightingale; the RCSB 1D tools paper (2020) cites the ProtVista paper |
| InterMine BlueGenes (`intermine/bluegenesProtVista`) | ProtVista-type viewer | https://github.com/intermine/bluegenesProtVista | 2018-08-17 (repo created) | — | dormant | 2020-07-10 | independent re-implementation |
| ProteomicsDB (`wilhelm-lab/protvista-proteomicsdb`) | ProtVista-type viewer | https://github.com/wilhelm-lab/protvista-proteomicsdb | 2021-09-18 (repo created) | — | dormant | 2023-08-30 | independent re-implementation |
| 3DBIONOTES (`3dbionotes-community/myProtVista`) | ProtVista-type viewer | https://github.com/3dbionotes-community/myProtVista | 2019-02-14 (repo created) | — | dormant | 2020-07-06 | appears ProtVista-derived; unverified |
| MolArt (`davidhoksza/protvista`) | fork | https://github.com/davidhoksza/protvista | 2017-08-30 (repo created) | — | — | — | fork of the original ProtVista (pre-`protvista-uniprot` rename); basis of the MolArt molecular-annotation tool. Run --backfill-dates for Since |
| ProKinO | ProtVista-type viewer | https://pubmed.ncbi.nlm.nih.gov/38077442/ | 2021 (paper) | — | — | — | no public repo; derivative of PDBe's protvista-pdb; npm `protvista-prokino` (last publish 2021) |
| InterPro (EBI) | ProtVista-type viewer | https://www.ebi.ac.uk/interpro/ | — (date unknown) | — | active | — | builds its own ProtVista-style protein feature viewer (nightingale-based) |
| ENACTdb | ProtVista-type viewer | https://www.iscbglab.in/enactdb/ | 2024 (paper) | — | active | — | ProtVista-style viewer (nightingale-based), live at iscbglab.in/enactdb; described in Bioinformatics Advances (vbae157) |
| ProteInfer (Google Research) | unclear | https://google-research.github.io/proteinfer/ | — (UI mention) | — | — | — | UI label mentions ProtVista; does not unambiguously demonstrate use of the library |
