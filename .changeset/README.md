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

1. When PRs with changesets are merged into `main`, GitHub Actions will automatically open or update a PR titled `chore(release): version packages`.
2. When the team decides to publish a release, simply merge that `Version Packages` PR.
3. GitHub Actions will build the packages, publish them to npm (with provenance attestations), and generate GitHub releases and git tags.
