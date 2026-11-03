# External code reviews

These are review responses supplied by the project owner, preserved unchanged. Their experiments and timing claims are reported by the reviewer, not independently reproduced merely by adding these documents to the repository.

- [Review request](claude-code-review-request.md) ([PDF](claude-code-review-request.pdf)).
- [Initial response: synthetic tests](2026-11-03-claude-review-synthetic.pdf), 3 November 2026. Reviews `166cab9`; no real images were available.
- [Updated response: real images and synthetic tests](2026-11-03-claude-review-real-images.pdf), 3 November 2026. Also reviews `166cab9`; includes ST1203, ST1221, Ti_0274 and ST1144. ST1156 was unavailable. This is the latest review and qualifies several findings in the initial response.

The updated review reports that a simple seed-deduplication change recovered synthetic second orientations but slightly reduced some real-image scores; it recommends preserving useful scale variants while adding orientation diversity. It also cautions against lowering the detector cutoff alone. Both reviews identify rank-auto's changing peak-set denominator as a concern for weaker patterns.

Review scripts and experimental patches were not supplied with these PDFs. The [implementation response and local checks](2026-11-03-follow-up.md) distinguish the fixes now implemented from recommendations still deferred. See the [maintained implementation plan](../implementation-plan.md) for current status.
