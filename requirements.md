# Requirements Document: Minimal Web Front End for env0 Terminal + CYOA

## Purpose
Build a lightweight browser-based UI that:
- feels like a terminal when running `env0.terminal`
- is also capable of rendering CYOA scenes from `env0.adventure`
- avoids building a terminal renderer/emulator (no grids, no canvas, no ANSI control handling)

This is a **front-end requirements document**. It defines the UI, the interaction model, and the contract the backend must satisfy.

---

## 1) Scope

### In scope
- Single-page web app (HTML/CSS/JS) with:
  - a **single scrollback surface**
  - a **pinned prompt row** at the bottom
- Two modes:
  - **Terminal mode** (CLI interaction)
  - **Story mode** (scene text + numbered choices)
- Streaming output (line-based)
- Lightweight CRT-style visual FX using overlays (CSS only or CSS + optional canvas overlay)
- A small, explicit message protocol between browser and backend

### Out of scope (explicit non-goals)
- No true terminal emulation:
  - no ANSI parsing
  - no cursor positioning within the scrollback
  - no rewriting previous lines (except optional updating of the “current streaming line”)
  - no TUI applications
- No complex layout engine, no text measurement, no custom wrapping logic
- No save games / persistence
- No authentication / user accounts

---

## 2) User Experience Requirements

### Terminal feel requirements
- One unified transcript (typed commands appear in scrollback).
- Pinned prompt row at bottom.
- Keyboard-first interaction:
  - Enter submits
  - Up/Down cycles command history
  - Ctrl+L clears scrollback
- Low-latency feedback:
  - command echo appears immediately
  - output begins streaming shortly after

### Story requirements
- Same scrollback surface used for story text.
- Choices rendered as numbered, clickable lines.
- Numeric hotkeys (1–9) trigger choices.
- Prompt row hidden or repurposed during story mode.

---

## 3) UI Layout Requirements

### Structure
- Terminal container (full viewport)
  - Scrollback area (scrollable)
  - Prompt row (sticky to bottom)

### Prompt row content
- user@host
- current working directory
- prompt symbol
- single-line input field

### Output line types
- standard
- error
- system
- boot
- debug (optional)

Unknown types must fall back to standard.

---

## 4) Visual FX Requirements

### Constraints
- FX must not affect text layout.
- No transforms or filters on the text layer.
- FX implemented as overlays only.

### Baseline FX
- Scanlines
- Vignette
- Subtle glow
- Optional subtle flicker

FX must be toggleable.

---

## 5) Data + Interaction Model

### Core rule
UI is line-based:
- backend sends lines
- frontend appends lines
- frontend does not interpret terminal control codes

### Buffering
- Batch DOM updates
- Hard cap on scrollback (default 1000 lines)

### Streaming
- Backend may stream complete lines or partial updates to the last line only.

---

## 6) Frontend–Backend Contract

### Transport
- WebSocket endpoint `/ws`

### Client messages
- Input: `{ "t": "input", "text": "ls" }`
- Choice: `{ "t": "choice", "index": 1 }`
- Control: `{ "t": "control", "action": "clear" }`

### Server messages
- Mode: `{ "t": "mode", "value": "terminal|story" }`
- Prompt: `{ "t": "prompt", "user": "", "host": "", "cwd": "", "symbol": "$" }`
- Line: `{ "t": "line", "text": "", "type": "standard" }`
- Lines (batch): `{ "t": "lines", "items": [...] }`
- StoryScene: scene text + choices
- Clear: `{ "t": "clear" }`
- Error: `{ "t": "err", "message": "" }`

Frontend must echo input immediately for responsiveness.

---

## 7) Input Behavior

### Terminal mode
- Enter submits
- Up/Down history
- Ctrl+L clear
- Ctrl+C optional interrupt

### Story mode
- Click or numeric key selects choice
- Enter optional no-op

---

## 8) Accessibility
- Adequate contrast
- No forced blur on text
- Reduced-motion support

---

## 9) Error Handling
- Disconnection message
- Safe ignore of unknown messages
- Graceful malformed input handling

---

## 10) Implementation

### Frontend
- index.html
- app.css
- app.js
- No frameworks unless justified

### Backend
- Static file hosting
- WebSocket endpoint
- Adapter for terminal + story engines

---

## 11) Testing

### Manual
- Terminal interaction
- Story flow
- FX toggle
- High-volume output

### Automated
- Optional protocol validation

---

## 12) Milestones
1. Bare terminal transcript
2. Story mode
3. FX overlays
4. Polish

---

## Acceptance Criteria
- Terminal mode feels authentic
- Story mode integrated cleanly
- No renderer complexity
- FX cosmetic only
