import { css } from 'lit';

export default css`
  .track-content {
    width: 80vw;
  }

  .track-content__coloured-sequence {
    display: flex;
    align-items: center;
  }

  .nav-container,
  .category__track {
    display: flex;
    margin-bottom: 0.1rem;
  }

  .category {
    display: none;
    margin-bottom: 0.1rem;
  }

  .category-label,
  .track-label,
  .nav-track-label,
  .credits {
    min-width: 20vw;
    max-width: 20vw;
    padding: 0.5em;
    line-height: normal;
  }

  .category-label {
    background-color: #b2f5ff;
    cursor: pointer;
  }

  .category-label::before {
    content: ' ';
    display: inline-block;
    width: 0;
    height: 0;
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
    border-left: 5px solid #333;
    margin-right: 5px;
    -webkit-transition: all 0.1s;
    /* Safari */
    -o-transition: all 0.1s;
    transition: all 0.1s;
  }

  .category-label.open::before {
    content: ' ';
    display: inline-block;
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-top: 5px solid #333;
    margin-right: 5px;
  }

  .track-label {
    background-color: #d9faff;
  }

  nightingale-track-canvas {
    border-top: 1px solid #d9faff;
  }

  nightingale-navigation {
    .handle {
      fill: darkgrey;
      stroke: black;
      stroke-width: 0.5px;
      height: 19px;
    }
  }

  nightingale-filter {
    font-size: 0.8rem;
  }

  .feature {
    cursor: pointer;
  }

  .proforma {
    padding-left: 4em;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
  }

  .mod-link {
    white-space: nowrap;
  }
`;
