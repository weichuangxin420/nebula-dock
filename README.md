# Nebula Dock

A simple Node.js server that serves a handcrafted landing page, a tiny JSON API, and a shared notes log.

## Run

```bash
npm run dev
```

Open `http://localhost:3000` in your browser.

## Pages

- `/` — Main landing page.
- `/agent` — Agent control room (idea-to-plan prototype).

## API

- `GET /api/status`
  - Returns uptime, server time, palette hints, and notes count.
- `GET /api/notes`
  - Returns the latest notes.
- `POST /api/notes`
  - Body: `{ "text": "your note" }`
  - Stores a new note and returns it.
