# ArchiveTune Modules

Module catalog for [ArchiveTune](https://github.com/rukamori/ArchiveTune).
Browse, submit, and install community-built audio provider modules.

## Add the catalog

In ArchiveTune, open **Settings → Modules → Add → Add catalog URL** and enter:

```text
https://raw.githubusercontent.com/rukamori/ArchiveTuneModules/main/registry.json
```

Refreshing the catalog only updates its entries. Each module is installed or
updated explicitly, and its package must match the `sha256` listed in
`registry.json` before installation review.

To install a single module without the catalog, use **Add module URL** with
the module's raw `.arch` URL, or download the package and use **Import file**.

## Available modules

| Module | Quality | Account |
| --- | --- | --- |
| TIDAL | FLAC, Hi-Res FLAC (DASH), AAC | TIDAL subscription |
| Qobuz | FLAC up to 24-bit/192 kHz, MP3 320 kbps | Qobuz subscription |
| JioSaavn | AAC up to 320 kbps | None |

Modules resolve audio for ArchiveTune's existing playback. They do not add
search pages, home feeds, or new browsing destinations to the app.

## Submit your module

1. Fork this repository
2. Add your provider source to `extension/<name>/` (`manifest.json` and `provider.js`)
3. Package it into `dist/<name>.arch` with the packager (see below)
4. Add your icon image (PNG, 512x512 recommended, at most 1024x1024 and 256 KiB) to `icon/`
5. Add an entry to `registry.json`
   - Ensure `download_url` and `icon_url` point to the raw files in this
     repository (e.g. `https://raw.githubusercontent.com/rukamori/ArchiveTuneModules/main/dist/your-module.arch`)
   - Set `sha256` to the SHA-256 of the `.arch` package, in lowercase hex
6. Create a Pull Request

### Registry entry

`registry.json` follows the Mornye extension registry layout, with the extra
fields ArchiveTune reads:

```json
{
  "id": "org.example.provider.my-service",
  "name": "my-service",
  "display_name": "My Service",
  "version": "1.0.0",
  "author": "Your name",
  "description": "What the module plays, which qualities it supports, and what account it needs.",
  "download_url": "https://raw.githubusercontent.com/rukamori/ArchiveTuneModules/main/dist/my-service.arch",
  "sha256": "<sha256 of dist/my-service.arch>",
  "icon_url": "https://raw.githubusercontent.com/rukamori/ArchiveTuneModules/main/icon/my-service.png",
  "category": "download",
  "tags": ["my-service", "lossless"],
  "labels": ["FLAC", "Lossless"],
  "capabilities": ["searchTracks", "getTrackStreamUrl"],
  "downloads": 0,
  "updated_at": "2026-11-03T00:00:00Z"
}
```

- `id`, `version`, `author`, `description`, `labels`, and `capabilities` must
  match the packaged manifest.
- `display_name` is the name shown in the catalog. `labels` and `tags` are
  shown as quality hints, such as Hi-Res.
- Do not add a `type` field. ArchiveTune only marks an entry as installable
  when `type` is missing or `MODULE`.
- `icon_url` is kept for registry compatibility. ArchiveTune shows the icon
  embedded in the installed package (`module.icon: "icon.png"`), not remote
  icon URLs.

## Requirements

- Module must follow the [ArchiveTune Module Authoring guide](https://github.com/rukamori/ArchiveTune/blob/main/MODULES.md)
- No malicious code, and no credentials, tokens, or secrets in manifests,
  scripts, or registry entries
- Clear description of what the module plays and what account it needs
- Working download URL, and a `sha256` that matches the published package
- A stable module ID: bump `version` for releases instead of changing the ID

## Developing the bundled modules

TIDAL, Qobuz, and JioSaavn have reviewable source in `extension/<name>/`. Edit
the source, bump its manifest version, and run:

```sh
python3 scripts/package_module.py extension/tidal --check
python3 scripts/package_module.py extension/tidal dist/tidal.arch
python3 scripts/package_module.py --inspect dist/tidal.arch
```

The packager needs Python 3.9 or newer and only its standard library. It
validates the manifest, writes the `provider.js` and icon checksums, and
reports the package SHA-256. Copy that package SHA-256 into the module's
`registry.json` entry. Run it with no arguments to open the interactive
terminal studio, or pass `--app-version <version>` to check a minimum
ArchiveTune version.

Packaging checks do not run JavaScript or contact the service. Before
submitting, install the package in ArchiveTune and check playback at every
quality the module declares, plus missing-credential, empty-search, and
service-failure cases.

Commit source, packages, icons, and registry changes together, and package
after the final source edit so the checksums match.

Subscription modules use the user's own account. Credentials are entered in
the module's settings in the app, stored on the device, and never belong in
this repository. Protected (DRM) streams and previews are not returned as
full tracks.

## Review process

All submissions are reviewed before being added to the catalog.

## License

Copyright 2026 rukamori/morieattonkatsu

This project is licensed under the [GNU Lesser General Public License v3.0 only (LGPL-3.0-only)](LICENSE.md), together with the incorporated [GNU GPL v3.0 terms](COPYING.md). See [NOTICE](NOTICE.md).

Third-party components retain their own license notices.
