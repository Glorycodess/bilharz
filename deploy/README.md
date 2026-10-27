# Deploying to the Hugging Face Space

The live app runs on the Hugging Face Space
[`iamglory/bilharz`](https://huggingface.co/spaces/iamglory/bilharz)
(Gradio SDK on ZeroGPU) at https://iamglory-bilharz.hf.space. One server
serves the API at `/api`, the built React site at `/`, and a small Gradio status
page at `/gradio`.

## Files

- `build_space.sh`: assembles the Space from this repository.
- `space/app.py`: the Space entry point. It builds the API with
  `server.create_app`, scores uploads on ZeroGPU with ONNX on the CPU as the
  fallback, mounts Gradio and serves the site.
- `space/requirements.txt`: pinned versions for the Space (Python 3.12).
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
`"scorer": "onnx-cpu"`).

## Settings on the Space

Set these in the Space's **Settings → Variables and secrets**:

| Name | Kind | Purpose |
| --- | --- | --- |
| `BILHARZ_ADMIN_TOKEN` | Secret | Enables CSV export and deleting reviews |
| `BILHARZ_REVIEW_CODE` | Secret, optional | Requires a code for reviews |

Reviews are stored in SQLite on the Space's disk, which is ephemeral: they are
lost when the Space restarts or sleeps. `/api/health` reports
`"reviews_persistent": false`.
