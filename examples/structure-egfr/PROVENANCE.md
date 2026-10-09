# EGFR drug binding contacts: provenance

This directory contains the community preset for **Structural biology and drug discovery**, focused on Epidermal Growth Factor Receptor (EGFR, UniProt **P00533**, 1,210 aa).

It visualizes co-crystal drug binding contacts for 7 clinically approved tyrosine kinase inhibitors (TKIs) and 1 reference ATP analogue across solved PDB structures, contextualized with PDB structure coverage, AlphaFold2 model confidence, domain topology, and catalytic sites.

| File | What it holds |
| --- | --- |
| `drug-contacts.csv` | Co-crystal ligand binding contacts across solved PDB entries mapped to canonical UniProt coordinates. |
| `config.yaml` | Standalone ProtVista community viewer configuration with 5 curated groups. |
| `preset.json` | Community view registration metadata (`label`, `description`, `length: 1210`). |
| `PROVENANCE.md` | Attribution, mapping methodology, and source citations. |

## Sources & Attribution

| Resource | Description | Source / Release | Licence |
| --- | --- | --- | --- |
| **PDBe Knowledge Base (PDBe-KB)** | Residue-level ligand binding site interactions for human EGFR | PDBe SIFTS residue mapping API | CC0 1.0 Universal |
| **UniProtKB** | Canonical human EGFR sequence (`P00533`), domain boundaries, catalytic sites | UniProtKB release 2026_03 | CC BY 4.0 |
| **AlphaFold DB** | Per-residue pLDDT confidence scores for AF-P00533-F1 | AlphaFold DB v2.0 | CC BY 4.0 |

### Citation
- Varadi M, et al. *PDBe-KB: a community-driven resource for structural and functional annotations.* **Protein Science** 2022; 31(10): e4439. DOI: [10.1002/pro.4439](https://doi.org/10.1002/pro.4439)
- UniProt Consortium. *UniProt: the Universal Protein Knowledgebase in 2023.* **Nucleic Acids Res.** 2023; 51(D1): D523–D531.

## Ligands Included

| Drug Name | Generation / Class | PDB Chem ID (CCD) | Mode of Action |
| --- | --- | --- | --- |
| **Osimertinib** | 3rd-generation TKI | `YY3` | Irreversible, covalent to Cys797; mutant-selective (T790M) |
| **Gefitinib** | 1st-generation TKI | `IRE` | Reversible, ATP-competitive |
| **Erlotinib** | 1st-generation TKI | `AQ4` | Reversible, ATP-competitive |
| **Afatinib** | 2nd-generation TKI | `0WN` | Irreversible ErbB family blocker (covalent to Cys797) |
| **Dacomitinib** | 2nd-generation TKI | `1C9` | Irreversible pan-HER TKI (covalent to Cys797) |
| **Lapatinib** | Dual EGFR/HER2 TKI | `FMM` | Reversible; binds inactive (DFG-out) kinase conformation |
| **Neratinib** | Pan-HER TKI | `HKI` | Irreversible pan-HER TKI (covalent to Cys797) |
| **AMP-PNP** | ATP analogue | `ANP` | Non-hydrolyzable ATP pocket reference |

## Coordinate Mapping
All coordinates are mapped to canonical human EGFR (P00533-1, 1,210 amino acids) using SIFTS (Structure Integration with Function, Taxonomy and Sequence). PDB author residue numbers (which often count from the mature peptide after signal peptide cleavage, e.g. L858R as L834R) are mapped strictly to canonical UniProt sequence indices.
