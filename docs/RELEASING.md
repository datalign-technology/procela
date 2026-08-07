# Releasing

## Connector container image

The on-prem connector is shipped as a multi-arch container image
(`linux/amd64` + `linux/arm64`) published to GitHub Container Registry
by [`.github/workflows/release-connector.yml`](../.github/workflows/release-connector.yml).

Image path:

```
ghcr.io/<owner>/procela-connector:<tag>
```

### Cutting a versioned release

Push an annotated tag matching `connector-v*`:

```bash
git tag -a connector-v0.2.0 -m "connector v0.2.0"
git push origin connector-v0.2.0
```

A `connector-v*` tag fires the workflow **unconditionally** — regardless
of which files the tagged commit touched — and publishes the production
image with the full set of semver tags plus `latest`:

| Tag pushed        | Image tags published                     |
| ----------------- | ---------------------------------------- |
| `connector-v0.2.0` | `:0.2.0`, `:0.2`, `:0`, `:latest`       |

The `connector-` prefix is stripped, so the published tag is the bare
version (`:0.2.0`, not `:connector-v0.2.0`).

### Trunk-following builds

Every push to `create-procela-main` also runs the workflow and publishes
`:edge` and `:sha-<short>` for customers who track trunk. These never get
`:latest` — that tag is reserved for `connector-v*` releases.

### Manual rebuilds

`workflow_dispatch` builds any ref on demand — useful when the base image
gets a security patch but the source hasn't moved. The image is tagged
with the commit SHA, plus an optional extra tag via the `tag_suffix`
input.

### Provenance

Images are published with build provenance and an SBOM attached
(`provenance: true`, `sbom: true`), and carry OCI labels (title,
description, vendor, `PROPRIETARY` license).

## Prerequisite: GHCR package visibility — DONE

Public images on GHCR require the **package's** visibility to be set to
`Public` once, after the first push, under **repo Settings → Packages**.
This is a one-time action separate from the repository's own visibility.

**Status: complete.** The `procela-connector` package visibility has been
flipped to `Public` and confirmed anonymously pullable — a customer (or a
dependent image build) can pull without a GHCR PAT:

```bash
docker pull ghcr.io/<owner>/procela-connector:latest
```

The workflow itself only needs `packages: write` from `GITHUB_TOKEN`; no
PAT is required to publish.
