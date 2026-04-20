import { Metadata } from '../adapters/types/interpro';
import { escapeHtml } from '../utils/security';

const formatTooltip = (
  start: number | '',
  end: number | '',
  metadata: Metadata
) => `
      ${
        start && end
          ? `<h4>InterPro Representative Domain ${escapeHtml(start)}-${escapeHtml(end)}</h4><hr />`
          : ''
      }
        <h5>Accession</h5>
        <p>
        <a
          target="_blank"
          rel="noopener"
          href="https://www.ebi.ac.uk/interpro/entry/${
            encodeURIComponent(metadata.source_database)
          }/${encodeURIComponent(metadata.accession)}/"
        >
        ${escapeHtml(metadata.accession)}
        </a>
        </p>
        <h5>Name</h5>
        <p>${escapeHtml(metadata.name)}</p>
        ${
          metadata.integrated
            ? `<h5>Integrated into </h5>
        <p>
        <a
          target="_blank"
          rel="noopener"
          href="https://www.ebi.ac.uk/interpro/entry/InterPro/${encodeURIComponent(metadata.integrated)}/"
        >
          ${escapeHtml(metadata.integrated)}
        </a>
        </p>`
            : ''
        }
      `;

export default formatTooltip;
