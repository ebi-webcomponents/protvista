# Isoform fixtures (hackathon project F8)

Offline copies of the data the F8 isoform mapper and its tests use, saved
verbatim (not reformatted) on 2026-10-08.

- **UniProt release:** 2026_03 (`x-uniprot-release` header on the
  rest.uniprot.org responses; release date 02-September-2026). VAR_SEQ
  coordinates belong to this version of each canonical sequence, so refresh
  the entry JSON and the FASTA together.
- **Licence:** CC BY 4.0, © UniProt Consortium
  (https://www.uniprot.org/help/license).

| File | Source |
| --- | --- |
| `<ACC>.json` | `https://rest.uniprot.org/uniprotkb/<ACC>.json?fields=accession,sequence,ft_var_seq,cc_alternative_products` |
| `<ACC>.fasta` | `https://rest.uniprot.org/uniprotkb/stream?query=accession:<ACC>&format=fasta&includeIsoform=true` |
| `P10636.features.json` | `https://www.ebi.ac.uk/proteins/api/features/P10636` with `Accept: application/json` (Proteins API; it reported `x-uniprot-release: 2022_02` in its header, but its sequence is identical to the 2026_03 entry) |

`<ACC>` is each of P05067 (APP), P04637 (p53, TP53), P10636 (tau, MAPT),
P42771 (CDKN2A) and A0A1B0GTW7 (CIROP; added 2026-10-08, same release, for
its insertion and its three-residue replacement). The FASTA files hold every
isoform, canonical first; they are the test oracle. CDKN2A's two External
isoforms (ARF, `Q8N726`) are listed in its JSON but are not in its FASTA.
