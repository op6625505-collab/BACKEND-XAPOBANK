# XapoBank Backend — Deploying to Render

This document explains how to deploy the `backend` folder to Render (recommended) and includes quick verification steps.

Prerequisites
- A GitHub/GitLab repo containing this project (already used for Vercel). 
- A Render account: https://dashboard.render.com
- MongoDB Atlas connection string and a DB user.

Recommended: Render Web Service (supports WebSockets)

1. Prepare repo

- Commit all changes in this repo. The `backend` folder contains `server.js` and `package.json` with a `start` script (`node server.js`).

2. Create a new Web Service on Render

- In Render: New → Web Service → Connect to your Git provider → select this repository.
- In the "Root Directory" field enter: `backend` (so Render builds that folder).
- For the Start Command enter: `npm start`.
- (Optional) Build Command: leave blank or `npm install`.

3. Add Environment Variables (Render → Service → Environment)

- `MONGO_URI` — MongoDB Atlas connection string (including username/password).
- `JWT_SECRET` — secure random string for signing tokens.
- `CLIENT_URL` — URL of your frontend (e.g., `https://your-site.vercel.app`).
- Any other env vars used by `backend/config/config.js`.

4. Health check and scaling

- Health check path: `/api/health` or `/` (optional).
- Choose instance size depending on traffic.

5. Deploy and test

- Render will build & deploy automatically after you confirm. Open the Render logs to ensure the server connected to MongoDB and started.

6. Wire the frontend (Vercel)

Option A — Proxy on Vercel (recommended):
- Add or update `vercel.json` in repo root to proxy `/api/*` and `/socket.io/*` to your Render URL (example `https://<YOUR_RENDER>.onrender.com`). Commit and push; Vercel will redeploy.

Example `vercel.json` routes:

```
{ "src": "/api/(.*)", "dest": "https://<YOUR_RENDER_URL>/api/$1" },
{ "src": "/socket.io/(.*)", "dest": "https://<YOUR_RENDER_URL>/socket.io/$1" }
```

Option B — Point clients directly
- Edit frontend fetch/socket calls to use full Render backend URL (e.g. `https://<YOUR_RENDER_URL>/api/auth/register`).

7. Verify sign-up / sign-in

From your browser or with curl:

```bash
curl -i https://<YOUR_RENDER_URL>/api/auth/register -X POST \
  -H "Content-Type: application/json" \
  -d '{"fullName":"Test","email":"t@example.com","password":"Password123"}'
```

8. WebSockets

- Render supports websockets on web services. If you proxy via Vercel, ensure the rewrite/proxy preserves websocket connections. If sockets fail, change the client to connect directly to the Render URL:

```js
const socket = io('https://<YOUR_RENDER_URL>');
```

Troubleshooting
- 404 on `/api/*`: confirm Vercel rewrite exists or client uses full backend URL.
- CORS errors: ensure `CLIENT_URL` is set and backend CORS allows the domain.
- Token problems: verify `JWT_SECRET` is the same across environments.

Container option (Docker)

Render can deploy from Docker. A simple `Dockerfile` is included in this folder if you prefer to run a container.

---
If you want, I can: (A) commit a `vercel.json` update with your Render URL, (B) commit a frontend change to point fetch() to Render, or (C) create this README only — which should I do next?
# XapoBank Backend (minimal scaffold)

This folder contains a minimal Express + Mongoose backend scaffold used by the frontend in this workspace.

Quick start (from `backend`):

```
npm install
# set environment variables (MONGO_URI, JWT_SECRET) or create a .env file
npm start
```

APIs implemented:
- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/me` (requires Authorization: Bearer <token>)
- `GET /api/transactions`
- `POST /api/transactions` (requires Authorization header)
