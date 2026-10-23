# FreelancerSync

Adds a Freelancer sync button to the OpenCode desktop app. One click on the
small Freelancer icon in the prompt bar keeps the local project folders
in sync with your Freelancer bids: pending bids under `pending/`, awarded bids
under `awarded/`, and folders whose project is gone get deleted.

It works by patching the packaged `app.asar` (append-only and reversible) and
shares a single main entry with the DeepSeek panel, so the two addons can be
installed, removed and updated independently.

Recommended release: **v1.1.1**.

## Features

- A Freelancer icon in the prompt bar (composer), right after the DeepSeek
  button when present, styled with the OpenCode theme. On older layouts it falls
  back to the bottom-left rail, then to a floating button.
- Click to sync: the icon turns into spinning arrows while it works, then a
  toast reports what was done (`pending`, `awarded`, moved, created, deleted).
- One-time login: paste a Freelancer Personal Access Token once; it is stored
  locally and reused, so you never log in again.
- Folder layout under the target directory:

      Freelancer/
        pending/    bids still waiting for an answer
        awarded/    bids you won
        <id>-<slug> legacy folders at the root are migrated automatically

  A folder is matched by its numeric id, so a folder keeps its hand-written
  name when it only moves between `pending/` and `awarded/`.
- Safety: if the API call fails or returns no bids, nothing is deleted.

## Requirements

- OpenCode desktop (Electron) installed.
- Node.js 18 or newer (to run the installer).
- A Freelancer account and a Personal Access Token
  (<https://accounts.freelancer.com/settings/develop>).

## Apply the patch

Close OpenCode first.

    cd "Freelancer sync plugin"
    node apply.js install

Start OpenCode. The Freelancer button appears in the prompt bar, after the
model/effort controls. On the first click, paste your Personal Access Token.

Other commands:

    node apply.js remove       # remove only this addon (keeps DeepSeek)
    node apply.js restore-all  # restore the original app.asar (removes all addons)
    node apply.js verify       # check the patched app.asar
    node apply.js status       # show install state

## Independence from the DeepSeek panel

Both addons share the append-only entry `out/main/oc-addons.js`, which loads the
base app and then any addon that is present. Each addon only touches its own
files, so any combination works:

| Installed            | What runs                          |
| -------------------- | ---------------------------------- |
| neither              | the base app                       |
| only DeepSeek        | base + DeepSeek                    |
| only Freelancer      | base + Freelancer                  |
| both                 | base + DeepSeek + Freelancer       |

`remove` neutralizes only the caller's addon. `restore-all` (available in both
addon folders) copies the shared pristine backup `app.asar.ocaddons-backup`
back, removing every addon at once.

## Target directory

The sync operates on `C:\Users\10293\Desktop\Repos\Freelancer` by default.
Set the `FREELANCER_DIR` environment variable to point elsewhere.

## Notes

- An OpenCode update replaces `app.asar`; run `node apply.js install` again (and
  the DeepSeek `install`) after updating.
- Installation order does not matter. Whichever addon is installed last keeps
  the shared entry; to restore one addon after a full `restore-all`, just run
  its `install` again.

## Files

- `apply.js` - installer (install / remove / restore-all / status / verify).
- `freelancer-main.js` - main-process module (token storage, IPC, sync trigger).
- `freelancer-sync.mjs` - pure sync logic (bids -> folder reconciliation).
- `freelancer-panel.js` - renderer prompt-bar button, spin animation, toast, token modal.
- `test_selfcheck.mjs` - runnable check for the sync logic.
- `VERSION` - panel version shown in the UI (injected at patch time).
