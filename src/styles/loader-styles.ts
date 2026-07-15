import { css } from 'lit';

export default css`
  .protvista-loader {
    display: flex;
    justify-content: center;
    padding: 4rem 0;
  }
  .protvista-loader svg {
    height: 100px;
  }

  .protvista-no-results {
    background-color: var(--protvista-no-results-bg);
    display: flex;
    justify-content: center;
    padding: 1rem;
    font-size: var(--protvista-font-size);
  }
`;
