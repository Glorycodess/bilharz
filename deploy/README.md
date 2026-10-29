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
| `BILHARZ_ADMIN_TOKEN` | Secret | Enables CSV export and deleting reviews |
| `BILHARZ_REVIEW_CODE` | Secret, optional | Requires a code for reviews |
| `BILHARZ_REVIEWS_DIR` | Variable | Mount path of the reviews Storage Bucket (`/data`); see below |
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
