# ADR-0001: Host the read-only guest screen on the recording device

## Status

Accepted

## Context

The tablet is the source of truth and stores records locally. A second phone must view updates without installing an app or requiring internet access. The existing `localStorage` and `BroadcastChannel` implementation only works between windows on one device.

## Decision

The Tauri application will start an on-demand HTTP/WebSocket server on the tablet. It will expose a tokenized, read-only viewer URL as a QR code. Vue sends the active event snapshot to the Rust process, which broadcasts it to connected viewers. The server stops explicitly or when the application exits.

## Consequences

### Positive

- The phone needs only a browser.
- No cloud account, database or internet connection is required.
- Updates are pushed immediately and reconnecting viewers receive a full snapshot.
- The phone cannot edit ledger data.

### Negative

- Both devices must be on the same Wi-Fi or hotspot.
- Some routers enable client isolation and may block device-to-device traffic.
- Android may suspend the server if the tablet app is backgrounded or the screen is locked.
- Traffic is HTTP inside the LAN; the random token limits casual access but is not equivalent to TLS.

### Neutral

- A new random token and port are created for each sharing session.
- The viewer intentionally contains a lightweight standalone rendering instead of the full management application.

## Alternatives Considered

- Install the APK on the phone: rejected because the requested viewer must require no installation.
- Cloud synchronization: rejected because it adds accounts, hosting cost and internet dependency.
- WebRTC: rejected because signaling and connection complexity are unnecessary on one LAN.
