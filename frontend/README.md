# Bilharz frontend

React + Vite site for Bilharz triage.

```
npm install
npm run dev
```

The dev server sends `/api` requests to the backend at `http://localhost:8000`
(start it from `api/`). To use another backend, set `BILHARZ_API_TARGET`, for
example `BILHARZ_API_TARGET=http://localhost:8001 npm run dev`.

All network access is in `src/api.js`, which turns the backend's snake_case
fields into the camelCase the components use.

## Checking the backend contract

```
npm run check:api
```

With the backend running, this calls `/api/config`, `/api/samples`,
`/api/samples/DT40` and `/api/reviews` (both the current and the full view)
and checks every field the frontend relies on: that it is present and of the
right type. It prints one line per endpoint and exits with an error if anything
is missing or wrong, for example after a backend change that wasn't matched in
`src/api.js`, or when an old backend process is still running. Set
`BILHARZ_API_URL` to check a backend other than `http://localhost:8000`.

When a field changes, update `src/api.js` and `scripts/check-api.mjs` together.
