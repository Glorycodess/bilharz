# Deploying to the Hugging Face Space

The live app runs on the Hugging Face Space
[`iamglory/bilharz`](https://huggingface.co/spaces/iamglory/bilharz)
(Gradio SDK on ZeroGPU) at https://iamglory-bilharz.hf.space. One server
serves the API at `/api`, the built React site at `/`, and a small Gradio status
page at `/gradio`.

## Files

- `build_space.sh`: assembles the Space from this repository.
- `space/app.py`: the Space entry point. It only assembles the app: chooses the
  scorer (`load_gpu_scorer` from `bilharz/scoring.py` on ZeroGPU, ONNX on the CPU
  otherwise), starts ZeroGPU, builds the API with `server.create_app`, mounts
  Gradio and serves the site.
- `space/requirements.txt`: pinned versions for the Space (Python 3.12).
  `spaces` is pinned exactly because `app.py` calls `spaces.zero.startup()`,
  which is not public API (see `docs/architecture.md`).
- `space/README.md`: the Space's README, including its YAML configuration.

## Build

```sh
git clone https://huggingface.co/spaces/iamglory/bilharz ~/bilharz-space   # once
deploy/build_space.sh            # or: deploy/build_space.sh /path/to/space-clone
```

The script needs `npm`, `rsync` and a Python with numpy (`api/.venv` by
default; set `PYTHON` to use another). It checks that every asset exists before
changing anything. It replaces only what it manages (`app.py`, `server.py`,
`requirements.txt`, `README.md`, `.gitattributes`, `.gitignore`, `bilharz/`,
`assets/`, `static/`) and leaves `.git` alone. It never copies `api/data/`,
virtual environments, tests, notebooks, `node_modules` or `.env` files. The
stored scores are copied without the ground-truth labels. Model and archive
files go through Git LFS (`.gitattributes`). It does not commit or push.

## Try the Space locally

```sh
cd ~/bilharz-space
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py          # http://localhost:7860
```

Without ZeroGPU, uploads are scored with ONNX on the CPU (`/api/health` reports
`"scorer": "onnx-cpu"`). On the Space, each analysis response's `scorer` field
says which one scored that upload: `torch-gpu`, or `onnx-cpu` after a fallback.

## Settings on the Space

Set these in the Space's **Settings → Variables and secrets**:

| Name | Kind | Purpose |
| --- | --- | --- |
| `BILHARZ_ADMIN_TOKEN` | Secret | Makes the first admin (on the Admin page), and is the fallback for CSV export and deleting reviews. Use a long random value, e.g. `python3 -c "import secrets; print(secrets.token_urlsafe(32))"` |
| `BILHARZ_REVIEWS_DIR` | Variable | Mount path of the reviews Storage Bucket (`/data`); see below. Accounts are kept there too |
| `BILHARZ_UPLOAD_TIMEOUT_SECONDS` | Variable, optional | Time allowed for an upload to arrive (default 120); a sample is about 180 MB |

## Keeping reviews

The Space's disk is ephemeral, so the reviews database there is lost when the
Space restarts or sleeps. Reviews are kept in a Hugging Face Storage Bucket
instead:

1. Create a bucket on huggingface.co, for example `iamglory/bilharz-reviews`,
   and choose **Private**.
2. In the Space's **Settings → Storage Buckets**, attach it **read-write** with
   mount path **`/data`**.
3. Set the variable **`BILHARZ_REVIEWS_DIR`** to **`/data`**.

Every review is then written to `/data/reviews.jsonl` as well as to the local
database, which is rebuilt from that file each time the Space starts. Check
`/api/health`: `"reviews_persistent": true` means the journal directory passed
the write test at start-up; `false` means it did not (the Space logs say why),
and reviews are then kept only until the next restart. `reviews_unreadable`
counts journal lines that could not be read; they are logged by line number and
left in the file.

## Accounts

Reviewer accounts are kept in `/data/accounts.jsonl` in the same bucket.
`/api/health` reports `"accounts_writable": true` when the file was read and the
directory passed the write test. Sessions are held in memory, so a restart or
a new deployment signs everyone out; accounts are kept.

`BILHARZ_REVIEW_CODE` is no longer used: remove it from the Space secrets if it
is set (the Space logs a warning while it is).

**The first admin.** Sign up on the app at https://iamglory-bilharz.hf.space
(its own tab, not the huggingface.co page), open **Admin**, and enter the admin
token. The account becomes an approved admin.

**Deleting an account** (on request; the app has no delete button). The app
keeps the accounts in memory and rewrites the whole file on every change, so the
file must not be edited while the Space is running:

1. On the **Admin** page, disable the account. This signs it out everywhere at once.
2. Pause the Space (**Settings → Pause**).
3. In the bucket, download `accounts.jsonl`, delete that account's line, and
   upload it again. If the person also asked for their reviews to be deleted,
   remove their lines from `reviews.jsonl` the same way (reviews name the
   account by `reviewer_id`).
4. Restart the Space and check `/api/health`: `accounts_writable` and
   `reviews_persistent` must be `true`, and `reviews_unreadable` `0`.
