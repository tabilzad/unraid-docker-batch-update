# Docker Batch Update for Unraid

Pick which Docker containers to update and update them all in one go, instead of clicking **apply update** on each one.

Unraid's Docker page has **Update All**, or you can update containers one at a time. This plugin adds a **Batch Update** tab to the Docker page for the in-between case. Tick the containers you want and click **Update Selected**. They are updated **one after another, in order**, with the normal Unraid progress window.

## Features

- Lists every container that has an update pending, in the same order as the Docker Containers page
- Checkboxes, plus select all / none
- Shows the current and new image digests
- **Check for Updates** button, which runs the stock Unraid update check
- **Show all containers** lets you force-update containers that are already up to date
- Greys out containers Unraid can't update itself (Docker Compose, containers without an Unraid template), and says why
- Won't start if another container update is already running

## How it works

The plugin doesn't have its own update logic. It passes your selection to Unraid's own `update_container` script, the same one behind **apply update** and **Update All**. For each container in turn, that script:

1. pulls the new image
2. stops the container if it is running
3. recreates it from its Unraid template
4. starts it again only if it was running before
5. removes the old image once nothing uses it

So containers update exactly as they would from the Docker page, with Tailscale integration, WireGuard routes and so on all handled.

## Installation

In the Unraid web UI, go to **Plugins → Install Plugin** and paste:

```
https://raw.githubusercontent.com/tabilzad/unraid-docker-batch-update/main/plugin/docker.batch.update.plg
```

Then open **Docker → Batch Update**.

Requires Unraid 7.0 or newer. Tested on 7.3.2.

<img width="1004" height="900" alt="sample" src="https://github.com/user-attachments/assets/aa19fddd-f716-4bfb-8d75-4893f483bc48" />


## Tips

- Updates run in the order shown. To update databases before the apps that use them, drag them higher on the Docker Containers page.
- You can close the progress window. The update keeps going in the background, just like **Update All**.

## Development

```
plugin/docker.batch.update.plg        plugin installer (pluginURL points here)
src/usr/local/emhttp/plugins/docker.batch.update/
  DockerBatchUpdate.page              the "Batch Update" tab (Menu="Docker:2")
  include/ContainerList.php           read-only JSON list of containers + update state
  javascript/batch.js                 UI logic
  sheets/batch.css                    styles
  images/docker.batch.update.png      plugin icon
  README.md                           text shown on the Plugins page
archive/                              built packages, downloaded by the .plg
plugins/docker.batch.update.xml       Community Applications plugin wrapper
ca_profile.xml                        Community Applications maintainer profile
build.sh                              builds archive/<name>-<version>-noarch-1.txz and stamps version + MD5 into the .plg
dev-deploy.sh                         copies src/ into the running web UI for quick testing (RAM only)
```

Quick test on an Unraid box: `./dev-deploy.sh`, then reload the Docker page. Undo with `./dev-deploy.sh --remove`. This is only for a copy deployed by the script: if the plugin was installed from the Plugins page, remove it there (or with `plugin remove docker.batch.update.plg`). The script refuses to run while a real install is present.

### Releasing

Unraid servers install and update from `plugin/docker.batch.update.plg` on the `main` branch. **Any change to the `.plg` pushed to `main` is a release.**

How an update reaches users: Unraid downloads the `.plg` from its `pluginURL`. If the `version` there is newer than the installed one, Unraid offers the update. Installing it downloads the `.txz` from `archive/` named in the `.plg`, checks its MD5 and swaps the package. Community Applications reads the same `.plg`, so there is nothing to resubmit.

Steps:

1. Make changes under `src/` and test them with `./dev-deploy.sh` (or install a branch's raw `.plg` URL on a test server)
2. Add an entry to `<CHANGES>` in `plugin/docker.batch.update.plg`:
   ```
   ###2026.10.20
   - What changed, in user terms
   ```
3. Run `./build.sh`. It builds `archive/docker.batch.update-<version>-noarch-1.txz` and writes the version and MD5 into the `.plg`. The version defaults to today's date.
4. Commit the `.plg` **and** the new `.txz` in the same commit, then push to `main`

Rules:

- **Versions are compared as plain text** (`strcmp`), not numerically. Always use zero-padded `YYYY.MM.DD`. For a second release on the same day add a suffix, for example `./build.sh 2026.10.20a` or `2026.10.20.1`, both of which sort after `2026.10.20`. Never use schemes like `1.9` → `1.10`.
- **Never push a `.plg` without its `.txz`.** Every user who updates would get a failed download. CI catches this, but only after the push.
- **Develop on a branch and merge to `main` only to release.** Whatever is on `main` goes live.
- **Keep old packages in `archive/`.** To roll back, release the previous code under a new, higher version. A lower version is never offered as an update.
- **Raise `min=` in the `.plg`** when relying on features of a newer Unraid release, so older servers refuse the update instead of breaking.
- **Never move or rename `plugin/docker.batch.update.plg`.** Every installed copy and the Community Applications listing point at that exact URL.
- Only when changing the Community Applications listing text (`plugins/docker.batch.update.xml` or `ca_profile.xml`): push, then run **Validate** and **Scan** again at https://ca.unraid.net/submit. Routine releases don't touch these files.
- Optional: tag releases (`git tag 2026.10.20 && git push --tags`) for a browsable history.

CI (`.github/workflows/validate.yml`) checks that the PHP/JS/XML are valid, and that the package the `.plg` points at exists, has a matching MD5, contains exactly what is in `src/`, and has a `<CHANGES>` entry.

## License

[MIT](LICENSE)
