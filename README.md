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
- `GET /api/llm/status`
  - Returns LLM module status and configuration flags.
- `GET /api/llm/skills`
  - Lists built-in skills (tool functions).
- `POST /api/llm/skills/run`
  - Body: `{ "name": "get_time", "args": {} }`
  - Executes a skill and returns its result.
- `GET /api/llm/sessions`
  - Lists chat sessions (history management).
- `POST /api/llm/sessions`
  - Body: `{ "title": "New Session", "systemPrompt": "..." }`
- `GET /api/llm/sessions/:id`
  - Returns a session with messages.
- `DELETE /api/llm/sessions/:id`
  - Deletes a session.
- `POST /api/llm/chat`
  - Body: `{ "sessionId": "...", "message": "..." }`
  - Sends a chat message, manages context, returns assistant response.
- `GET /api/cli/commands`
  - Returns the built-in command presets (for quick selection).
- `POST /api/cli/run`
  - Body: `{ "command": "ls -la" }` or `{ "commandId": "project-status" }`
  - Executes a command and returns output (local mode, no auth).
- `GET /api/mcp/servers`
  - Lists configured MCP servers.
- `POST /api/mcp/servers`
  - Body: `{ "id": "local", "url": "http://127.0.0.1:3001" }`
- `GET /api/mcp/servers/:id/tools`
  - Lists MCP tools for a server.
- `POST /api/mcp/servers/:id/call`
  - Body: `{ "name": "tool_name", "arguments": { } }`
- `GET /api/notes`
  - Returns the latest notes.
- `POST /api/notes`
  - Body: `{ "text": "your note" }`
  - Stores a new note and returns it.

## LLM Environment

Set these env vars to enable model calls:

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL` (optional, default `https://api.openai.com/v1`)
- `OPENAI_MODEL` (optional, default `gpt-4o-mini`)
- `OPENAI_SUMMARY_MODEL` (optional)
- `LLM_MAX_CONTEXT_CHARS` (optional)
- `LLM_MAX_TAIL_MESSAGES` (optional)

> Note: `/api/cli/run` and skill `run_cli` are unrestricted in local mode. Do not expose to the public network without auth.
