# TUI framework showcase

This directory holds throwaway prototypes for the `harness-switcher-tui` framework decision.

Each prototype renders the same state shape and follows the same keyboard scene.

- `src/ink.ts` uses Ink and React for the deterministic video prototype.
- `src/ink-live.ts` uses Ink with the repository's real `Jobs` and CPA path.
- `src/opentui.ts` uses OpenTUI core renderables and Bun.
- `rust/src/main.rs` uses Ratatui and Crossterm.
- `go/main.go` uses Bubble Tea and Lip Gloss.
- `scene.json` defines terminal size and recorded key timings.
- `record.py` drives every prototype through a PTY and writes asciicast files.
- `scripts/render-tui-videos.sh` builds, records, converts, and verifies the videos.

The OpenTUI prototype needs Bun 1.3 or later. The other prototypes use Node, Rust, or Go.

Run `npm run ink:live` for the real Ink TUI. It requires the repository dependencies, valid CPA configuration, and a working CPA session. It creates real HarnessAgent jobs in the existing memory sandbox.

The video prototypes are not production code. Keep the existing renderer unchanged until the videos settle the choice.

## Render the videos

Run video work on `macmini` through the guarded entry point.

```bash
$HOME/.pi/agent/bin/video-render-macmini \
  --project "$PWD" \
  --output "test-results/tui-videos" \
  -- bash scripts/render-tui-videos.sh
```

The output directory contains four MP4 files, one 2x2 comparison MP4, asciicast captures, and a contact sheet.

## Official references

- [Ink](https://github.com/vadimdemedes/ink)
- [OpenTUI](https://opentui.com/docs/getting-started/)
- [Ratatui](https://ratatui.rs/)
- [Bubble Tea](https://github.com/charmbracelet/bubbletea)
