<div align="center">

# noxy

**Egress proxy for operational security. Rust. Async. Chainable.**

Route traffic through chains of transports — direct, SOCKS, Tor, or nested — with cert-pinned upstreams and a live operator TUI.

[![Rust](https://img.shields.io/badge/rust-1.75.0+-blue.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](#license)
[![Status](https://img.shields.io/badge/status-In%20Development-orange)](#)

</div>

---

## What is this

A single Rust binary that sits on a machine and controls how traffic leaves it. Point any tool at its local SOCKS5 or HTTP port and noxy routes each connection through a chain you define:

```
app → noxy → direct → upstream
app → noxy → Tor → upstream
app → noxy → SOCKS proxy A → SOCKS proxy B → upstream
```

Noxy is designed for **operational security** — when you need traffic to exit from a specific point, through a specific path, with cryptographic verification at every hop.

### What it is not

Noxy is a **transport layer**. It doesn't scan, probe, deploy payloads, or execute commands on targets. It moves bytes through chains you configure. You bring the upper layer (C2 framework, browser, curl, whatever).

---

## Features

- **Chain routing** — connect through `direct → Tor → HTTPS upstream` or any sequence of transports
- **SOCKS5 + HTTP CONNECT** inbound — any tool that speaks proxy can use noxy
- **Cert pinning** on upstreams — SPKI-SHA256, multiple pins for rotation
- **Live ratatui dashboard** — active connections, per-chain stats, kill/routing controls
- **Non-blocking tokio event loop** — thousands of concurrent connections
- **`--no-tui` headless mode** — for server deployments
- **Config reload via SIGHUP** — swap routes and pins without restart

---

## Quick start

```bash
cargo build --release
cp noxy.conf.example noxy.conf
$EDITOR noxy.conf
./noxy --config noxy.conf
```

Aim something at it:

```bash
curl --socks5-hostname 127.0.0.1:1080 https://example.com
```

---

## Config

```ini
[listen]
socks5 = 127.0.0.1:1080
http   = 127.0.0.1:8080

[transport.direct]
type = direct

[transport.tor]
type = socks5-upstream
addr = 127.0.0.1:9050

[transport.egress]
type = socks5-upstream
addr = 203.0.113.1:1080

[chain.c2]
transports = ["direct", "egress"]

[chain.anon]
transports = ["tor", "egress"]

[route]
default = direct
rules = [
  "*.c2.example.com -> c2",
  "*/secret/*       -> anon"
]
```

| Section | Key | Does what |
|---------|-----|-----------|
| `listen` | `socks5` / `http` | Inbound proxy ports |
| `transport.<name>` | `type` / `addr` | `direct`, `socks5-upstream`, or `chain` |
| `chain.<name>` | `transports` | Ordered list of transports to traverse |
| `route` | `default` / `rules` | Match traffic to a chain. First match wins |
| `log` | `level` / `format` | `error | warn | info | debug`; `keyval | json` |

---

## The dashboard

```
┌ NOXY ──────────────────────────────────────────────── up 01:23:47 ─┐
│ listen socks5 127.0.0.1:1080  http 127.0.0.1:8080   route: [C2]    │
│ conns active 847  total 12,441  cps 203  ▲ 44.1MB  ▼ 401.2MB        │
├────────────────── CHAINS ───────────────────────────────────────────┤
│ c2   direct → egress        active 312  p50 12ms p99 89ms           │
│ anon tor → egress           active 18   p50 412ms p99 1.2s          │
├────────────────── CONNECTIONS ──────────────────────────────────────┤
│ #c2a1  127.0.0.1:54122  c2.example.com:443   c2     RLY  7K/41K      │
│ #c2a4  127.0.0.1:54141  10.0.0.5:22          c2     RLY  9K/9K       │
├────────────────── LOG ──────────────────────────────────────────────┤
│ 14:23:01 info  conn #c2a1 established via c2 chain                   │
├─────────────────────────────────────────────────────────────────────┤
│ [q]uit [r]oute [c]hain [l]og [f]ilter [k]ill [/]search [?]          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## How it works

```
app → socks5/http listener → tokio event loop → chain resolver → transport[0] → ... → transport[N] → upstream
                                                   │
                                            cert pinning
```
One async tokio loop owns every socket. Each connection walks a state machine: `handshake → route → chain-resolve → connect-series → relay → close`. Buffers are capped with backpressure — a fast peer can't bury a slow one.

---

## Roadmap

- [ ] SOCKS5 `UDP ASSOCIATE` for DNS
- [ ] Multi-worker with `SO_REUSEPORT`
- [ ] Health-check endpoints for load balancers
- [ ] JSON metrics endpoint for external monitoring

---

## License

MIT. See `LICENSE`.
