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
- `GET /api/cli/commands`
  - Returns the built-in command presets (for quick selection).
- `POST /api/cli/run`
  - Body: `{ "command": "ls -la" }` or `{ "commandId": "project-status" }`
  - Executes a command and returns output (local mode, no auth).
- `GET /api/notes`
  - Returns the latest notes.
- `POST /api/notes`
  - Body: `{ "text": "your note" }`
  - Stores a new note and returns it.
