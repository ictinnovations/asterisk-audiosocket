# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/); versions follow [SemVer](https://semver.org/).

## [0.1.0] — 2026-08-09

Initial release. Extracted from the ICTContact AI Voice Agent media sidecar.

### Added
- `AudioSocketServer` — event-driven TCP server for the Asterisk AudioSocket protocol.
- `AudioSocketConnection` — per-call `id` / `audio` / `hangup` / `error` events.
- `play()` — deadline-paced 20 ms outbound audio writer with per-frame clamp.
- `FrameParser`, `encodeFrame`, `encodeAudio`, `encodeHangup`, `parseUuid` — low-level codec.
- Full protocol support: UUID, AUDIO, HANGUP, ERROR frames.
- Zero runtime dependencies; ESM + type declarations.
