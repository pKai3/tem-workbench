# Desktop setup and recovery

## Install

Use the versioned ZIP asset from [GitHub Releases](https://github.com/pKai3/tem-workbench/releases/latest) and extract the whole folder (Extract All on Windows). Open **0 - START HERE.txt**, then double-click **1 - Install TEM Workbench - Windows.bat** or **1 - Install TEM Workbench - macOS.command**. Keep the application folder in place. Git is optional.

Desktop setup requires standard 64-bit Python 3.14 (Mac ARM64/Intel or Windows x86-64). It searches installed Python first. If absent, it asks before downloading the official Python installer. The pinned URL and SHA-256 come from [Python 3.14.10 release metadata](https://www.python.org/downloads/release/python-31410/), rechecked 4 November 2026. Windows also checks Authenticode. macOS prompts for installer administrator approval. Keep Tcl/Tk selected on Windows. Managed computers may require IT help. No execution-policy bypass is applied.

Mac Dock builds require macOS 13+ and Apple Command Line Tools: `xcode-select --install`. Launch from `~/Applications/TEM Workbench.app`. Windows creates Desktop and Start menu shortcuts. Both launchers manage only their own server/worker processes. Logs and startup failures remain visible in the launcher.

## Environments and personal files

Each installation has its own environment, selected by a code-folder hash:

- Mac: `~/Library/Application Support/TEM Workbench/installations/<id>/py314/venv`
- Windows: `%LOCALAPPDATA%/TEMWorkbench/installations/<id>/py314/venv`

`.tem-environment.json` records the active environment. Updates that change requirements build a new environment in the local update directory and retain the previous one for recovery. `TEM_ENV_DIR` can explicitly choose another absolute non-cloud directory outside the source. Never copy virtual environments between computers. Existing source `.venv` directories are neither reused by desktop setup nor deleted.

Research remains in the selected data/output folders. `.tem-paths.json`, `tem_workbench.project.json`, `.tem-image-calibrations.json`, other untracked personal files and browser preferences are not replaced by release updates. Back up research normally; updater backups cover application replacement and its environment pointer, not a research backup scheme.

## Console operation

With Python 3.14 installed, run from the application folder:

```sh
python3.14 workbench_environment.py setup
python3.14 workbench_environment.py launch
```

On Windows use `py -3.14` instead of `python3.14`. For a dependency check without analysis, use `workbench_environment.py check`. Console launch opens the browser; Ctrl+C stops it. Developers may still run `python server.py` in an independently prepared compatible environment, but desktop updates use the managed 3.14 environment.

## Updates and recovery

Choose **Check for updates** in the desktop launcher. Download and validation occur before changing the installation. Applying stops the owned server, backs up managed code, replaces only verified release paths, updates the launcher, then restarts. Local tracked code modifications block Git updates. Unknown files occupying new release paths also block replacement rather than being overwritten.

An interrupted transaction leaves `.tem-update.lock` to block normal startup. Open Check for updates and use recovery to restore the previous code/environment. Transaction files and logs live under `~/Library/Application Support/TEM Workbench/updates` (Mac) or `%LOCALAPPDATA%/TEMWorkbench/updates` (Windows). Do not delete an active update lock or its backup as a workaround.

If dependencies are missing, stop the app and rerun its installer. An incomplete environment is reported without overwriting it; move that environment aside, then rerun setup. Old environments and transaction backups are retained; remove them only once their version is no longer needed for recovery.

Moving the application changes its installation identity. Rerun the installer; it preserves old environments. The first migration from the previous launcher also requires running the installer once.

## Demo download certificates

On Windows, demo downloads use the native Windows certificate store and chain validation through Truststore. Certificate and hostname verification stay enabled. If certificate verification still fails on a managed network or with antivirus HTTPS inspection, ask IT to check the trusted certificate chain or try another trusted network. The app never bypasses certificate checks.

## Release maintenance

Pushes run checks without publishing a release. Approved releases use the manual Publish Workbench release workflow. Desktop tests run on Windows and macOS; the full synthetic suite gates publishing. The workflow increments the patch version unless VERSION already requests a higher version, commits version/notes, pushes the tag and commit atomically, and publishes only after verifying uploaded asset sizes and hashes. Release packages include committed application files only. Fetch and fast-forward the workflow's version commit before subsequent work.
