<div align="center">

# Stratum

**A fast, extensible forwarding proxy in C. Because your traffic is your business.**

Private DNS, pluggable routing (direct / Tor / I2P / chains), cert pinning, and a terminal dashboard that doesn't look like 1998.

[![Build](https://img.shields.io/badge/build-passing-brightgreen)](#building)
[![C11](https://img.shields.io/badge/C-11-blue)](#)
[![Platform](https://img.shields.io/badge/platform-Linux%20x86__64-lightgrey)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](#license)

</div>

---

## What is this

Stratum is a single binary that sits between your apps and the internet and gives you actual control over how packets leave the building.

Point something at its local SOCKS5 or HTTP port and it will:

- resolve names over **DNS-over-HTTPS**, so your ISP stops reading your bedtime browsing like a diary
- send each connection through whatever **transport** you want: straight out, through Tor, through I2P, or down a chain of proxies
- **pin certificates** on its own upstreams, so a swapped key fails loudly instead of getting a polite handshake
- show you all of it live in a terminal dashboard

It runs on a non-blocking `epoll` loop and is built to juggle thousands of connections without breaking a sweat.

> **What it is not:** an attack tool. Stratum forwards traffic *you* send it. It doesn't scan, probe, or poke anything, it ships zero payloads, and it does not crack open your apps' TLS to read it. It tunnels that stuff blind. It only terminates TLS on connections it makes itself (its resolver, its upstreams), and it pins those. It's a privacy plumbing tool, not a crowbar.

---

## Features

- **SOCKS5 + HTTP CONNECT.** If your tool can use a proxy, it can use Stratum.
- **DNS-over-HTTPS** with a TTL cache, because asking the same question 400 times is rude.
- **Pluggable transports.** Tor and I2P aren't special cases, they're just SOCKS upstreams on a different port. The core doesn't even know their names.
- **Rule-based routing.** `*.onion` to Tor, `*.i2p` to I2P, `10.0.0.0/8` straight out, everything else wherever you say. First rule wins, no surprises.
- **Cert pinning** (SPKI-SHA256, multiple pins for rotation). Wrong key, no connection, angry log line.
- **A live TUI** for watching connections, flipping routes, and killing things, all without a restart. Or run `--no-tui` if you enjoy reading logs like a monk.
- **Doesn't leak memory.** Bounds-checked parsers, capped buffers, strict ownership, and a test suite that runs under ASan, UBSan, and valgrind so you don't have to take our word for it.

---

## Quick start

```bash
make
cp stratum.conf.example stratum.conf
$EDITOR stratum.conf
./stratum --config stratum.conf
```

Then aim something at it:

```bash
curl --socks5-hostname 127.0.0.1:1080 https://example.com
https_proxy=http://127.0.0.1:8080 curl https://example.com
```

Running it on a server with no patience for UIs:

```bash
./stratum --config stratum.conf --no-tui
```

---

## Installing

You need a C11 compiler, `make`, OpenSSL (>= 1.1.1), and ncurses for the dashboard.

```bash
# Debian / Ubuntu
sudo apt install build-essential libssl-dev libncurses-dev

# Fedora
sudo dnf install gcc make openssl-devel ncurses-devel
```

### Building

```bash
make          # release build -> ./stratum
make debug    # with ASan + UBSan, for when things go sideways
make test     # run the tests
make clean
```

`./stratum --version` tells you it worked.

---

## Config

One INI file. No YAML, no 200-line JSON, no feelings.

```ini
[listen]
socks5 = 127.0.0.1:1080
http   = 127.0.0.1:8080

[resolver]
doh_url = https://1.1.1.1/dns-query
doh_pin = "sha256/REPLACE_ME_WITH_A_REAL_PIN="
mode    = doh_only            ; doh_only | doh_then_system

[transport.tor]
type = socks5-upstream
addr = 127.0.0.1:9050

[transport.i2p]
type = socks5-upstream
addr = 127.0.0.1:4447

[route]
default = direct
rules = [
  "*.onion     -> tor",
  "*.i2p       -> i2p",
  "10.0.0.0/8  -> direct"
]

[log]
level  = info                 ; error | warn | info | debug
format = keyval               ; keyval | json
```

| Section | Key | Does what |
|---------|-----|-----------|
| `listen` | `socks5` / `http` | where to listen. Drop a line to turn one off. |
| `resolver` | `doh_url` / `doh_pin` | your DoH endpoint and its pin |
| `resolver` | `mode` | `doh_only` (private) or `doh_then_system` (fallback, less private) |
| `transport.<name>` | `type` / `addr` | `direct`, `socks5-upstream`, or `chain` |
| `route` | `default` / `rules` | where traffic goes. First match wins. |
| `log` | `level` / `format` | how loud, and in what shape |

Send `SIGHUP` (or hit reload in the TUI) to re-read routes, log level, and pins live. Changing the listen ports needs a restart, sorry.

---

## The dashboard

```
┌ STRATUM ───────────────────────────────────────────── up 02:14:09 ─┐
│ listen socks5 127.0.0.1:1080  http 127.0.0.1:8080   route: [TOR]    │
│ conns active 1,284  total 58,201  cps 412  ▲ 88.2MB  ▼ 902.1MB      │
│ cache hit 96.3%   DoH p50 7ms p99 41ms   pins ok   errors 3         │
├──────────── CONNECTIONS ────────────────────────────────────────────┤
│ #58a2  127.0.0.1:54122  example.com:443   tor     RLY   2K/41K      │
│ #58a4  127.0.0.1:54141  10.0.0.5:22        direct  RLY   9K/9K       │
├──────────── LOG ────────────────────────────────────────────────────┤
│ 12:14:01 info  conn #58a2 established via tor                        │
├────────────────────────────────────────────────────────────────────┤
│ [q]uit [r]oute [p]ins [c]onfig [l]og [f]ilter [k]ill [/]search [?]   │
└────────────────────────────────────────────────────────────────────┘
```

`j/k` to move, `Enter` to inspect, `r` to switch routes, `c` to reload config, `K` to kill a connection (it asks first, it's not a maniac), `?` for the full keymap, `q` to leave. `Esc` always backs out.

---

## Writing a transport

A transport is five functions. That's the whole contract.

```c
typedef struct transport {
    const char *name;
    void *(*ctx_new)(const conn_t *c);
    int   (*open)(void *ctx, const char *host, uint16_t port);
    int   (*on_writable)(void *ctx, int fd);   /* 0 pending, 1 ready, <0 error */
    int   (*on_readable)(void *ctx, int fd);
    void  (*ctx_free)(void *ctx);
} transport_t;
```

`open()` kicks off a non-blocking connection and can run its own little handshake (the SOCKS upstream does exactly this). When it says "ready," the core starts relaying and stops caring how you got there. Register it, name it in config, done. No core surgery required.

---

## How it works

```
your apps ─▶ socks5/http listeners ─▶ epoll event loop ─▶ transport ─▶ upstream
                                          │                  (direct/socks/chain)
                                   ┌──────┴───────┐
                                DoH resolver   TLS + pinning
                                  (+ cache)
```

One epoll loop owns every socket and never blocks. Each connection walks a tiny state machine (`handshake → resolving → connecting → relaying → closing`). Buffers are capped and push back, so a fast peer can't bury a slow one and memory stays where you left it. Who frees what is written down and not up for debate.

---

## Tests and speed

```bash
make test                       # unit + integration
make debug && ./stratum ...     # under the sanitizers
make bench                      # load harness, bring your own hardware
```

Parsers get fuzzed, a soak test runs under valgrind, and all client input is treated like it wants to hurt you. The goal is thousands of concurrent connections with overhead you'd need a stopwatch and good intentions to measure. Run the bench and write down your own numbers, don't trust a README's bragging.

---

## Roadmap

- [ ] Multi-worker scaling with `SO_REUSEPORT`
- [ ] SOCKS5 `UDP ASSOCIATE`
- [ ] `kqueue` backend so the BSD crowd stops complaining
- [ ] Prometheus-style metrics

---

## Contributing

PRs welcome. Keep the build warning-free (`-Wall -Wextra`), run `make test` and a `make debug` sanitizer pass before you push, match the style (`clang-format` config is in the repo), and write down ownership for anything you allocate. New parser or transport? It comes with tests.

Also: keep contributions inside the lane. This is a traffic-forwarding privacy tool, not a starter kit for hassling strangers' servers.

---

## Security

Found a hole? Report it privately via `SECURITY` instead of yelling about it in a public issue. Pin failures and protocol violations land on a dedicated security log channel, so if you see mystery pin mismatches, that's not noise, that's a hint.

---

## License

MIT. See `LICENSE`. Go build something.