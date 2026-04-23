# ProtVista: 3-Year Roadmap & Sustainability Plan (DRAFT)

Project Title: Improving ProtVista: Sustainability, Usability, and Community for Protein Research Tools  
Funder / Scheme: Software Sustainability Institute — Research Software Maintenance Fund (RSMF)  
Project Start Date: 1 February 2026  
Project End Date: 31 January 2027  
Project Lead: Maria J. Martin  
Lead Developer: Daniel Rice, supported by Aurélien Luciani  
Code Repository: [https://github.com/ebi-webcomponents/protvista-uniprot](https://github.com/ebi-webcomponents/protvista-uniprot)  
Document version: Draft v1 \- March 2026  
Licence: CC BY 4.0

# Executive Summary

ProtVista is an open-source sequence-feature visualisation tool developed at EMBL-EBI. Since 2014 it has provided researchers, bioinformaticians, and developers with a streamlined interface for exploring protein annotations from sequence to structure. ProtVista is embedded within UniProt, and its underlying component library, Nightingale, is used across a range of UK-based projects including PDBe, InterMine, and InterPro.

This document presents a three-year roadmap for ProtVista's continued development and long-term sustainability. Year 1 (the funded SSI RSMF period) is dedicated entirely to executing the grant deliverables: reducing technical debt, decoupling ProtVista from hardcoded EBI infrastructure, making it more accessible to non-coding researchers, building community, and establishing governance. A key architectural outcome of Year 1 is the publication of a stable viewer configuration schema and loading model for ProtVista instances. More specific payload/data schemas for built-in track types and adapters will be developed progressively. Years 2 and 3 describe the post-grant trajectory, including a pathway toward deeper interoperability with the emerging MolViewSpec (MVS) / MolSequenceSpec (MSS) ecosystem for more unified 1D to 3D visualisation workflows.

The plan is structured in three parts: a product and technical roadmap, a sustainability plan, and a section on project controls covering FAIR alignment, success metrics, risk management, and post-grant funding.

# Part 1: Product & Technical Roadmap (2026–2028)

## Year 1: Grant Execution (Feb 2026 – Jan 2027\)

Year 1 is fully funded by the SSI RSMF grant. Every milestone below maps directly to the approved workplan and the Outputs Management Plan (OMP). The overarching goals are to modernise the codebase, lower barriers to adoption, and build the community and governance structures that will sustain ProtVista beyond the grant.

### Q1 (Months 1–3): Initiation and Groundwork

**Governance and community**

- Establish the Advisory Board and hold the kick-off meeting, using the Terms of Reference.
- Submit the Outputs Management Plan (OMP) to SSI by 1 March 2026, as required by the grant terms. The OMP will be reviewed quarterly throughout the project period.
- Launch monthly virtual "office hours" open to all users and developers. Rotate scheduling across time zones to maximise reach.
- Publish a Code of Conduct, CONTRIBUTING.md, standardised issue and pull-request templates, and "good first issue" labels to the repository.
- Conduct a comprehensive audit of known ProtVista integrations to identify current consumers, establishing a baseline to measure community adoption and project impact over the course of the grant.
- Present a poster on the ProtVista roadmap and sustainability plan at VIZBI 2026\.

**Technical foundations**

- Conduct a thorough code audit to identify hardcoded assumptions, obsolete code, and legacy browser workarounds that can be removed.
- Conduct a security audit to determine if any NPM package dependencies have known security vulnerabilities.
- Begin refactoring ProtVista's data-loading layer to accept user-supplied data via a documented configuration model, decoupling the tool from EBI-specific API endpoints. As part of this work, define the first version of the viewer configuration schema covering groups, tracks, data sources, and rendering options.
- Explicitly separate the architectural contracts for (a) viewer configuration and (b) track payloads/data.
- Implement Canvas and/or WebGL-based rendering for improved performance, targeting smooth interaction with dense annotation sets on resource-limited hardware. _Note: rendering is handled by the upstream @nightingale-elements packages and will require coordinated changes in addition to this project._
- Establish a testing baseline for the main component, which currently has minimal coverage (one adapter test file and a filter-config test file). Record a baseline snapshot: number of unit tests, statement coverage percentage for key modules, and CI pass/fail status. Set up the testing infrastructure so that tests are written alongside each refactoring task from Q1 onwards, rather than retrofitted later. This directly supports our CI/CD goals: external contributors need a passing test suite to verify their changes against.

**MolViewSpec MolSequenceSpec engagement (ongoing from Q1)**

- Begin participating in MolSequenceSpec specification discussions with the Mol\* developers and PDBe. The goal during Year 1 is to ensure ProtVista's requirements for 1D annotation representation are captured in the emerging spec, and that key architectural decisions made during the refactoring (particularly around the data-loading schema, viewer state model, and coordinate abstractions) are compatible with future MSS integration, without creating a dependency on the specification timeline.

**Outputs:** Operational Advisory Board; community engagement channels live; initial refactoring PRs merged; performance benchmark report; testing infrastructure established with baseline coverage.

### Q2 (Months 4–6): Core Development and User Outreach

**Architecture and usability**

- Complete the configurable data-loading framework: ProtVista should mount tracks dynamically based on a user-provided configuration file rather than hardcoded group lists. Publish a formal viewer configuration schema (JSON Schema) defining the supported structure of groups, tracks, data sources, and rendering options, so that users and integrators can validate configuration files before use. In parallel, document the expected payload shapes for the initial built-in track types and adapters. The objective is to support the track and feature elements currently supported by ProtVista (i.e. not additional elements).
- The configuration JSON schema should handle the majority of standard visualisation needs, while exposing a modular API (escape hatches) that allows advanced users to inject custom logic for their specific edge cases.
- Modernise the styling architecture, using native web standards like CSS ::part and custom properties, to reduce technical debt and allow library users to customise the interface.
- Implement track-configuration UI features (reordering, selective toggling) so that non-technical users can customise the display without editing code.
- Release a "Starter Kit" – a standalone repository containing an HTML page, a sample configuration file, and a local data folder – enabling researchers to visualise their own data alongside public tracks without writing code, provided their data conforms to ProtVista's published schema. The Starter Kit lowers the barrier from "write JavaScript" to "provide data in a supported format and configure via JSON." _Note: The Starter Kit and playground both depend on the configurable data-loading framework being complete. This dependency chain is the primary schedule risk for Q2. If the config framework takes longer than expected, a minimal Starter Kit using a simplified config subset will be released on schedule, with the full version following in Q3._

**Documentation and training**

- Deploy the interactive configuration playground on GitHub Pages: a live demo where users can experiment with ProtVista settings and see results in real time.
- Host the recorded ProtVista webinar covering use cases from basic exploration to custom dataset integration, promoted through EMBL-EBI training channels and the SSI network.
- Publish updated user guide, tutorial ("How to embed ProtVista on your site and load your own data"), and contributor guide.
- Document the distinction between viewer configuration and track payloads, so that adopters understand what is controlled by ProtVista configuration and what must be supplied by data providers or adapters.

**Community**

- Continue monthly office hours. Begin collecting structured feedback via lightweight post-event surveys.
- Publish the first blog post announcing the Starter Kit and playground, targeting clinical researchers and bench scientists who may not be aware of ProtVista.

**Outputs:** Functional beta of refactored features (internal testing); Starter Kit repository; interactive playground; webinar delivered and archived; updated documentation under CC BY 4.0.

### Q3 (Months 7–9): Testing, Community Contribution, and Refinement

**Technical refinement**

- Verify that legacy browser workarounds and obsolete code identified in the Q1 audit have been fully removed (removal will have been ongoing during Q1–Q2 refactoring). Measure and report the reduction in codebase complexity using standard auditing tools, comparing against the Q1 baseline.
- Audit and improve WCAG accessibility: keyboard navigation, colour-blind-friendly palettes, ARIA labelling, and screen-reader hooks. Document any known limitations.
- Report test coverage progress against the Q1 baseline. The target is for all adapters to have unit tests, config validation and loading have tests, and CI is configured so that no integration-breaking change can be merged without a test failure. Include coverage metrics in the Q3 Advisory Board progress report.
- Publish a pre-release version of ProtVista incorporating the refactored architecture and UI enhancements.

**Hackathon**

- Host the online ProtVista hackathon, promoted through EMBL channels, partner networks, and domain-specific mailing lists to reach users outside the existing base.
- Prepare a curated project portfolio (visualisation plugins, database integrations) and provide real-time mentorship during the event.
- Systematically integrate community contributions post-hackathon.

**Governance**

- Convene the Advisory Board for a mid-project assessment. Present progress against deliverables and gather input on the strategic roadmap and sustainability plan.

**Outputs:** Pre-release version; hackathon with documented contributions; accessibility audit report; preliminary roadmap and sustainability plan drafted.

### Q4 (Months 10–12): Finalisation and Handover

**Release and preservation**

- Publish the production-ready major release incorporating all architectural and interface improvements. Ensure all code is MIT-licensed.
- Tag the release in GitHub, publish to npm, and deposit in Zenodo with a DOI and the required UKRI funding acknowledgement.
- Ensure the repository is archived in Software Heritage.

**Documentation and outreach**

- Finalise all documentation: user guide, tutorial, playground, contributor guide, API reference. Ensure everything is published on GitHub Pages under CC BY 4.0. Ensure the documentation clearly distinguishes between the viewer configuration schema and supported payload/data patterns for built-in track types.
- Publish a blog post and, where possible, present at a relevant conference or community event highlighting project outcomes and the public roadmap.

**Governance and sustainability**

- Finalise this Sustainability Plan based on Year 1 KPIs and Advisory Board input.
- Publish the public roadmap to the repository.
- Secure endorsement from key stakeholders (UniProt Consortium, Advisory Board members) for the post-grant maintenance pathway.

**Outputs:** Production major release (GitHub, npm, Zenodo); comprehensive documentation published; strategic roadmap and sustainability plan publicly available.

## Year 2: Consolidation and MSS Alignment (2027)

Post-grant maintenance is expected to be supported primarily through UniProt Consortium core operations, supplemented by community contributions cultivated during Year 1\. The primary technical ambition is to begin integrating ProtVista with the MolSequenceSpec (MSS) ecosystem, building directly on the specification discussions and MSS-informed architectural decisions from Year 1\.

**MolSequenceSpec groundwork**

- Participate in the MSS 1D specification process alongside collaborators (Mol\* developers and PDBe). Contribute ProtVista's requirements for sequence-level annotation representation.
- Begin refactoring nightingale-structure to consume pre-mapped 1D coordinate selections broadcast by Mol\*, rather than maintaining its own SIFTS API fetching and position-mapping logic. The principle is that coordinate mapping between sequence and structure positions is the 3D viewer's responsibility; ProtVista should receive resolved coordinates rather than duplicating that work internally. _Note: this refactoring will happen within Nightingale (@nightingale-elements/ nightingale-structure), not in protvista-uniprot itself, and will require coordination with the broader Nightingale maintainers._
- Evaluate and prototype handling of non-canonical addressing, alignment gaps, and complex PTM substructures to ensure parity with 3D structural mapping.

**Community and ecosystem**

- Grow the contributor base by continuing office hours, maintaining the Starter Kit, and responding to community issues.
- Work with PDBe, and InterPro teams to explore shared adoption of ProtVista's JSON configuration schema as a lightweight standard for 1D feature data exchange.
- Target at least one external group (outside EBI) actively maintaining a fork or integration of ProtVista for their own data.
- Investigate the potential of generalizing ProtVista's new configuration-based architecture beyond proteins. Initiate exploratory discussions with Open Targets and Rfam with the aim to understand what data types and visualization features (e.g., RNA sequence logos, genomic mappings) might make ProtVista a viable tool for DNA and RNA research in the future.

**Indicative milestones:** MSS 1D specification draft contributed to; nightingale-structure refactored to relay pattern; at least two external groups using the Starter Kit in production or pilot.

## Year 3: Deeper Interoperability and Ecosystem Maturation (2028)

Year 3 is intended to deepen ProtVista’s interoperability with the MSS ecosystem, subject to specification maturity, available resourcing, and ecosystem adoption.

**MVS/MSS integration**

- Pursue support for shared state exchange between sequence (1D) and structure (3D) views, with exploratory work toward broader 1D/2D/3D interoperability where specification maturity permits.
- Evaluate and, where justified by user need and ecosystem readiness, prototype support for more advanced MSS features such as richer selection/state expressions.

**AI Interoperability**

- Explore integration with Model Context Protocol (MCP) to allow LLM-based chatbots to dynamically render specific interactive tracks (e.g., a single PTM view).

**Community scaling**

- Transition toward a community-driven open-source maintenance model, with external contributors able to review and merge PRs.
- Evaluate whether ProtVista's governance should evolve (e.g. a lightweight steering committee replacing the Advisory Board) based on the size and maturity of the contributor community.

**Indicative milestones:** ProtVista integration into an MVS/MSS reference implementation, subject to specification maturity; prototype of an MCP-enabled ProtVista widget embedded in an LLM chatbot environment; external contributor with merge access onboarded; documentation and Starter Kit maintained by the community.

# Part 2: Sustainability Plan

## 1\. Architectural Sustainability (Reducing Technical Debt)

The core Year 1 deliverable is transforming ProtVista from a tightly coupled, EBI-specific tool into a data-agnostic, configuration-driven component. By replacing hardcoded API endpoints and group lists with a documented JSON schema, we drastically lower the barrier for external labs and industry partners to adapt ProtVista for their own data. Every new adopter becomes a potential contributor and stakeholder, naturally scaling the pool of people invested in the tool's maintenance.

Furthermore, the configuration-first, modular architecture will be highly compatible with emerging AI coding tools. By defining clear boundaries and machine-readable JSON schemas, we ensure that post-grant maintenance, bug fixes, and the development of custom tracks can be achieved with significantly reduced developer overhead.

## 2\. Strategic Interoperability (The MSS Opportunity)

MolSequenceSpec is an emerging community standard for describing molecular visualisation state. By aligning ProtVista with MSS – initially through architectural preparation in Year 1 and active integration in Years 2–3 – we position ProtVista as the primary 1D viewer within a broader structural bioinformatics ecosystem. This unifies development efforts across EBI teams (PDBe, UniProt, InterPro) and strengthens the case for future maintenance to be supported by pooled institutional resources rather than isolated grants.

Importantly, the Year 1 architectural work (decoupling, documented schema, relay pattern) is valuable regardless of MSS timelines. If the MSS specification process takes longer than expected, ProtVista still emerges from the grant as a more maintainable, more adoptable tool.

## 3\. Community and Governance

- **Lowering barriers:** Clear CONTRIBUTING.md, PR templates, "good first issue" labels, and the contributor guide make it straightforward for newcomers to contribute.
- **Direct engagement:** Monthly office hours provide a regular touchpoint with users outside our existing EBI network. The hackathon is designed to recruit new contributors.
- **Reaching new users:** SSI reviewers noted that reaching people outside the existing user base is a key challenge. Our strategy includes: (a) the Starter Kit and playground make ProtVista usable without programming, opening it to bench scientists and clinical researchers; (b) targeted promotion at domain-specific conferences (VIZBI \- paid for by UniProt) and via partner networks (Open Targets); (c) the webinar is promoted through SSI and EMBL-EBI training channels to audiences that may not follow our GitHub repository.
- **Advisory Board:** Governed by the published Terms of Reference, the Board provides strategic oversight and connects the project to diverse stakeholder communities. Board composition deliberately includes representatives from outside EBI to ensure the roadmap reflects broader community needs.
- **Succession planning:** Cross-training between Daniel and Aurélien ensures overlapping knowledge of the codebase. The contributor guide, documented architecture, and open governance are designed to reduce bus-factor risk and enable future maintainers to onboard effectively.

## 4\. Transparent Output Management

All outputs are governed by the Outputs Management Plan (OMP), reviewed quarterly:

- All code is open-source under the **MIT License**.
- All documentation, schemas, training materials, and governance documents are freely reusable under **CC BY 4.0**.
- Major releases are deposited in **Zenodo** with DOIs and archived via **Software Heritage**.
- npm packages correspond exactly to tagged GitHub releases for reproducibility.

# Part 3: Project Controls

## Commitment to FAIR Software

- **Findable:** Major releases archived in Zenodo with citable DOIs. The Zenodo concept DOI links all versioned releases. Citation instructions provided in the repository README.
- **Accessible:** All outputs openly licensed and publicly hosted on GitHub and GitHub Pages. The Starter Kit and playground lower barriers for non-programmers. WCAG accessibility improvements ensure the tool is usable across hardware and ability contexts.
- **Interoperable:** The software uses standard web technologies and uses documented JSON configuration schema and API enable integration with external data sources. Future MSS alignment will ensure ProtVista speaks the same language as structural tools like Mol\*.
- **Reusable:** Clear MIT licensing on code, CC BY 4.0 on non-code materials, comprehensive documentation, and archived releases ensure long-term reusability.

## Measuring Success (Key Performance Indicators)

We will track the following metrics throughout Year 1 and report them to the Advisory Board and SSI:

**Community growth**

- Number of new contributors submitting issues, making commits, or submitting pull requests (objective: monitor and report growth during the grant period).
- Hackathon participation and post-hackathon contribution retention.

**Adoption**

- Number of confirmed external deployments or pilot integrations of the configurable ProtVista (objective: monitor and report growth by end of Year 1).
- npm download trends for the major release.

**Technical health**

- Successful deployment of the decoupled configuration-driven architecture, with a published viewer configuration schema, passing CI, and working examples for supported external data-loading patterns.
- Performance benchmark results: Canvas/WebGL rendering versus SVG baseline.

**Documentation and training**

- Playground and documentation site page views.
- Webinar views and feedback survey results.

## Risk Management

| Risk                                                                                                                                             | Likelihood | Impact        | Mitigation                                                                                                                                                                                                                                      |
| :----------------------------------------------------------------------------------------------------------------------------------------------- | :--------- | :------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Technical complexity:** Certain refactoring tasks or Canvas/WebGL integration prove harder than expected.                                      | Medium     | Medium        | Prioritise core functionality; deploy fallback solutions (e.g. retain SVG as default if WebGL is not production-ready). Leverage EMBL-EBI's pool of technical expertise.                                                                        |
| **Low community engagement:** Limited participation in office hours, hackathon, or contributions – a specific concern raised by grant reviewers. | Medium     | Medium        | Leverage established networks and partner connections (Open Targets, InterMine). Target promotion at domain-specific venues. The project's delivery is independent of external contributions; community input is valuable but not a dependency. |
| **Reaching new users beyond existing base:** Difficulty publicising ProtVista to researchers who don't already use it.                           | Medium     | Medium        | The Starter Kit and playground are designed for non-programmers. Webinar promoted through SSI and EMBL-EBI training channels. Advisory Board members actively champion the tool in their own networks.                                          |
| **Team capacity:** Personnel changes on a small team could impact delivery.                                                                      | Low        | High          | Cross-training between Daniel, Aurélien and the team ensures overlapping codebase knowledge. EMBL-EBI management can reassign or hire support if needed. The one-year duration limits exposure.                                                 |
| **MSS consensus delayed:** The 1D specification process stalls or takes longer than expected.                                                    | Medium     | Low (Year 1\) | The Year 1 architecture is valuable standalone. MSS integration is explicitly a Year 2–3 goal. The decoupled architecture built in Year 1 ensures ProtVista is useful and maintainable regardless of MSS timelines.                             |
| **Scheduling overrun:** Features cannot be completed in the funded period.                                                                       | Low        | High          | Well-scoped plan with clear prioritisation. Non-grant essential features that cannot be finished will be deferred to the post-grant roadmap. Regular Advisory Board check-ins ensure realistic scope.                                           |

## Post-Grant Funding Strategy

The Year 1 work establishes ProtVista as a maintainable, well-documented, community-supported tool that requires significantly fewer resources to sustain than it does today. The post-grant funding pathway has three components:

1. **Institutional embedding:** As ProtVista's architecture is modernised and its user base grows, maintenance will be integrated into the UniProt Consortium's core operations. ProtVista is already embedded within UniProt's web interface; the grant work makes it cheaper and easier to maintain as part of routine operations.

2. **Pooled cross-team support:** MSS alignment in Years 2–3 unifies ProtVista with EBI's broader structural bioinformatics infrastructure (PDBe, InterPro). Shared tooling attracts shared maintenance effort, reducing reliance on any single team's budget.

3. **Future grant applications:** The demonstrated sustainability improvements, community growth, and interoperability track record from this grant provide a strong foundation for future collaborative funding bids (e.g. Wellcome Trust, BBSRC) focused on interoperable structural biology platforms.

4. **AI-driven maintenance efficiency:** As established in our sustainability plan, the modernized, modular, configuration-first architecture delivered by this grant will increase the efficacy of AI coding tools. This ensures that routine maintenance and feature development will require significantly fewer dedicated developer hours, mitigating the risk of post-grant resource constraints.

## Funding Acknowledgement

All outputs will include the required acknowledgement:

"This work was supported by the Research Software Maintenance Fund, managed by the Software Sustainability Institute and funded by UKRI grant reference AH/Z000114/1."
