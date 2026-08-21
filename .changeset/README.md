# Changesets in FastCat

This repository uses [Changesets](https://github.com/changesets/changesets) to manage versioning, changelog generation, and npm package publishing.

## Adding a changeset

When creating a Pull Request that introduces changes to publishable packages (such as `@fastcat/embed`), add a changeset describing what was changed:

```bash
pnpm changeset
```

Follow the interactive prompts:

1. Select which package(s) were changed.
2. Select whether the change is `patch`, `minor`, or `major`.
3. Provide a summary message describing the changes for users of the package.
4. Commit the generated `.changeset/*.md` file with your PR.

## Release Process

1. After a merged commit passes the blocking `CI` workflow, GitHub Actions automatically opens or updates a PR titled `chore(release): version packages`.
2. When the team decides to publish a release, simply merge that `Version Packages` PR.
3. After the merge commit passes `CI`, GitHub Actions publishes the changed packages to npm (with provenance attestations) and generates GitHub releases and git tags. Each package builds through its own `prepack` script.

## npm setup

The public SDK is published as `@bozonx/embed`, which belongs to the npm account
`bozonx`. Before the first release, create an npm granular access token with
publish access for this package and add it to the GitHub repository as the
`NPM_TOKEN` Actions secret. No manual `npm publish` is needed: merge the
Changesets version PR and the release workflow publishes the initial version.
