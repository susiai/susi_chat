# SUSI.AI Chat Terminal (Browser Client)

This project is a browser-based chat terminal that blends an LLM chat UI with a lightweight, terminal-like command interface. It also includes a virtual file system (VFS) concept so chat-produced code can be captured and managed in a file-like structure.

## Core principles implemented so far

### 1) Terminal-first UI with chat as the default command
- The UI is a single terminal surface (`index.html`, `css/chat_terminal.css`) with a content-editable input line appended after each command.
- Input handling favors terminal muscle memory: `Enter` submits; `Shift+Enter` inserts a newline.
- Output is streamed and rendered through Markdown (`marked`) and syntax highlighting (`highlight.js`), keeping the experience close to a dev console.

### 2) Chat history is the source of truth for LLM context
- Chat history is managed by `js/susi_chat_history.js` as an in-memory list of `{role, content}` entries.
- The system prompt is always message 0 and is persisted in `config.json` inside the IndexedDB VFS.
- Commands are interpreted first; anything unrecognized becomes a user prompt to the LLM, which is then appended to chat history.
- A special `???` suffix triggers a two-step "context first, answer later" prompt flow.

### 3) Streaming LLM output with stop-token cleanup
- The client calls `/v1/chat/completions` with `stream: true`.
- Each streamed chunk updates the last terminal line in-place and re-highlights newly emitted code blocks.
- Known stop tokens are stripped from the end of the stream to keep the visible output clean.
- Response timing stats are tracked for prompt processing and token generation, then exposed via the `performance` command.

### 4) Persistent VFS and shell layering
- `js/susi_vfs.js` is a standalone IndexedDB-backed VFS library (no dependencies).
- `js/susi_shell_commands.js` is the shell executor that depends only on the VFS and implements `touch`, `rm`, `mv`, `ls`, `pwd`, `cd`, `mkdir`, `rmdir`, `tree`, `less`, and `edit`.
- The chat UI calls the shell executor with access to the VFS; the shell manages paths and file operations.
- Command help is generated from command metadata, so each command self-documents.

### 5) IndexedDB VFS capabilities
- `js/susi_vfs.js` defines the VFS API and exposes it on `window.vfs`.
- Paths are normalized as keys with rules: leading slash required, trailing slash indicates a directory.
- Commands in this module mirror common shell ops: `put`, `get`, `rm`, `touch`, `cp`, `mv`, `ls`, `cat`, `find`, `du`, `df`, `grep`.
- This VFS is exposed on `window.vfs` and exercised in `js/vfs-test.html`.

### 6) Persistent config via IndexedDB VFS
- Configuration is stored in `config.json` inside the IndexedDB-backed VFS, not `localStorage`.
- A small config layer loads/saves keys such as `apihost`, `model`, `apikey`, `companion`, and `systemprompt`.
- The `agent` and `team` commands store definitions inside the same config file for reuse.
- `mem` prints the config contents; `mem clear` resets to defaults and rewrites `config.json`.

### 7) Export and capture flows
- `export` writes chat history to a local download in JSON, TXT, MD, CSV, or DOCX.
- `make` extracts the latest assistant code block and writes it to a VFS file.
- Image attachments are supported for the LLM call (JPEG/PNG with size gating).

## High-level flow
1) User types in the terminal.
2) The shell executor runs first; if no shell command matches, the chat executor handles the command or routes to the LLM.
3) For LLM calls: payload is streamed, output is rendered progressively, and the final answer is appended to chat history.
4) File operations are handled via the IndexedDB VFS (`susi_vfs.js`).

## Key files
- `index.html`: app shell and script wiring.
- `js/susi_chat_terminal.js`: terminal UI, command parser, chat/LLM streaming, config abstraction over `config.json`, and a thin integration layer to the shell.
- `js/susi_shell_commands.js`: shell executor that depends only on the VFS and owns shell command dispatch.
- `js/susi_chat_executor.js`: chat command executor (non-shell commands and LLM routing).
- `js/susi_chat_history.js`: chat history state and manipulation helpers.
- `js/susi_ui_commands.js`: UI-only commands (editor).
- `js/susi_vfs.js`: IndexedDB-backed VFS with shell-like commands.
- `js/vfs-test.html`: manual test harness for the IndexedDB VFS.
- `css/chat_terminal.css`: terminal look-and-feel.

## Known separations (intentional seams)
- Terminal files and configuration both persist via the IndexedDB VFS (`config.json` plus user files).
- The VFS is dependency-free; the shell depends only on the VFS; the chat UI depends on the shell.
- The API host defaults to a SUSI endpoint but can be overridden from the terminal (`host`, `set api`).
