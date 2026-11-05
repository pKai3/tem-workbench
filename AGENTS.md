# Repository work

`docs/implementation-plan.md` is the maintained implementation plan and the single source of truth for upcoming work.

- Read its relevant sections before beginning a planned feature.
- Update it in the same change when scope, priorities, agreed decisions or implementation status changes. Distinguish proposals from approved decisions and completed behaviour.
- Preserve the agreed task order unless the user changes it. Do not implement a roadmap item merely because it is listed.
- Record completion dates and commit references when available. Keep the README linked to the plan rather than duplicating its contents.
- Update architecture diagrams only when the user explicitly requests a refresh. Routine feature changes do not require diagram/PDF regeneration; when requested, follow `docs/architecture/README.md`.

## UI conventions

- Keep settings labels and controls concise and visible. Put longer explanations in hover-to-reveal help, also available through keyboard focus or tapping an info button. Keep errors and active progress visible.

## Releases

- Push changes normally; GitHub checks run on every push. Do not automatically bump versions, tag or publish a release for each push.
- Suggest a release when useful changes have accumulated, an important fix warrants distribution, or it has been a while. Wait for the user’s approval before publishing a release.
- Publish approved releases through the manual Publish Workbench release workflow, retaining its full verification gates.
