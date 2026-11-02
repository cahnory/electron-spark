# Publishing packages

The root workspace and demo are private. The ten packages in `libs/` are
public npm packages. `pnpm build` builds the libraries; it does not package or
sign the demo application.

## First push

Run these commands from the repository root and commit the resulting source,
configuration, and lockfile changes:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
```

On GitHub, use `main` as the default branch and enable Actions. In Settings →
Actions → General, enable **Allow GitHub Actions to create and approve pull
requests**. Create an environment named `release`; configure required reviewers
there if publishing should require approval. After CI runs successfully, protect
`main` and require the `validate` check. This check requires the full Linux checks
and package builds, plus the Electron process lifecycle tests on macOS and
Windows, to pass. A platform failure does not cancel the other platform tests.

GitHub supplies `GITHUB_TOKEN` automatically. No npm write token is needed for
the trusted publishing setup below. The first push runs validation; it does not
publish packages.

## First npm publication

1. Confirm that you control the `@electron-spark` npm organization and can publish
   the unscoped `electron-spark` name. Set up account 2FA.
2. Run `npm login` and verify your account with `npm whoami`.
3. Build and pack the libraries into a directory outside the repository:

   ```sh
   pnpm build
   pnpm --filter './libs/**' -r pack --pack-destination /private/tmp/electron-spark-pack-review
   ```

4. Inspect all eight tarballs, including their manifests, compiled exports,
   declarations, README, license, and resolved internal dependency versions.
   Publish the inspected tarballs with `npm publish /path/to/package.tgz
   --access public`. This publishes the manifest version, initially `0.1.0`.
   Publish dependency packages before their dependents.
5. For **each** package, open npm package Settings → Trusted publishing and add
   GitHub Actions with owner `cahnory`, repository `electron-spark`, workflow
   filename `release.yml`, and environment `release`. Allow direct publishing
   if npm offers an allowed-actions setting.

The initial publication must happen before package-level trusted publishers can
be configured. Publish the pnpm-generated tarballs: pnpm resolves `workspace:*`
dependencies and applies `publishConfig.exports` while packing.

## Subsequent releases

Run `pnpm changeset` alongside a package change and commit the generated file.
After that change reaches `main`, CI creates or updates `changeset-release/main`
with the version bumps and changelogs. Review and merge that PR. The release
workflow checks out its merge commit, reruns checks and library builds, publishes
unpublished versions to npm, and creates GitHub releases.

If a release job fails transiently, rerun that workflow run in GitHub Actions.
Versions already published to npm cannot be overwritten; Changesets skips
existing versions when publishing again.
