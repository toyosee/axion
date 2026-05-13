# Axion

<div align="center">

**Real-time stress testing with a heartbeat.**

*Watch your infrastructure's pulse. Know instantly if it's healthy, struggling, or crashing.*

[![Go Version](https://img.shields.io/badge/Go-1.21+-00ADD8?style=flat&logo=go)](https://go.dev)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)](https://github.com/toyosee/axion)

</div>

---

## Why Axion?

Stress testing tools are either too complex (CLI-only, config-heavy) or too simplistic (basic HTTP benchmarks). **Axion gives you a live, visual heartbeat of your system under load** — making it intuitive for developers, founders, product managers, and QA engineers alike.

> **No CLI required. No config files. Just a browser and a URL.**

---

## Features

### 🫀 Live Heartbeat Monitor
Watch an ECG-style waveform pulse in real-time as requests hit your endpoint. The color tells the story:

| State | Color | Meaning |
|---|---|---|
| Healthy | 🟢 Green | Error rate < 10%, system handling load well |
| Degraded | 🟡 Amber | Error rate 10–50%, system struggling |
| Critical | 🔴 Red | Error rate > 50%, system overwhelmed or down |

### 📊 Real-Time Metrics
- **Throughput** (RPS) — current requests per second
- **Success Rate** — with progress bar
- **Error Rate** — with progress bar
- **Latency** — Avg, Min, Max, and **P99** (the one that matters)
- **Engine Vitals** — memory and goroutines of the load generator

### ⚡ Configurable Load Testing
- **Concurrent workers** (1–1000+) — simulate real traffic patterns
- **Request delay** (0–10000ms) — control aggressiveness
- **Duration** — set a time limit or run until manually stopped
- **Auto-stop** — test ends gracefully when duration expires

### 📝 Test History & Reports
- Every test auto-saved with full metrics
- Expand any record for detailed stats
- Download reports as **JSON** or **CSV**

### 🎨 Modern UI
- Futuristic dark theme (light mode available)
- Responsive design (mobile to ultrawide)
- Built-in documentation with live search
- Persistent notification system
- Zero UI framework dependencies

---

## Quick Start

### Download & Run

```bash
# Clone the repository
git clone https://github.com/toyosee/axion.git
cd axion

# Run (auto-opens browser)
go run main.go
```

Your browser opens automatically to `http://localhost:8080`. Enter a target URL, set your parameters, and click **Start Test**.

### Test a Public Endpoint

Try these safe test URLs:
```
https://httpbin.org/get        # Basic test
https://httpbin.org/delay/1    # 1-second delay (test latency)
https://httpbin.org/status/500 # Returns errors (test error handling)
```

### Run a Local Test Server

```bash
# Python
python -m http.server 3000

# Node.js
npx http-server -p 3000

# Then point Axion at: http://localhost:3000
```

---

## Configuration

| Parameter | Type | Default | Description |
|---|---|---|---|
| `targetUrl` | URL | — | Endpoint to test |
| `concurrency` | Number | 10 | Simultaneous workers (1–1000) |
| `requestDelayMs` | Number | 100 | Delay between requests per worker (ms) |
| `durationSecs` | Number | 0 | Test duration (0 = until stopped) |

### Scenario Guide

| Scenario | Workers | Delay | Use Case |
|---|---|---|---|
| Smoke test | 1–5 | 500–1000ms | Basic health check |
| Average load | 20–50 | 100–200ms | Normal traffic simulation |
| Stress test | 100–500 | 0–50ms | Finding breaking points |
| Spike test | 1000+ | 0ms | Maximum capacity testing |

**Estimated RPS:** `Workers ÷ (Delay in seconds)`  
*Example: 50 workers with 100ms delay ≈ 500 RPS*

---

## Architecture

```
┌─────────────────────────────────────────┐
│              Browser (UI)               │
│  ┌───────────────────────────────────┐  │
│  │  • Live Heartbeat (Canvas/ECG)    │  │
│  │  • Metrics Dashboard              │  │
│  │  • Test Configuration             │  │
│  │  • History & Reports              │  │
│  └──────────────┬────────────────────┘  │
│                 │  WebSocket             │
└─────────────────┼───────────────────────┘
                  │
┌─────────────────┼───────────────────────┐
│            Go Engine                     │
│  ┌──────────────┴────────────────────┐  │
│  │  • HTTP Server (port 8080)        │  │
│  │  • WebSocket Hub                  │  │
│  │  • Load Test Engine (goroutines)  │  │
│  │  • System Monitor                 │  │
│  │  • Test Record Store              │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
                  │
                  │  HTTP Requests (the load)
                  ▼
        ┌──────────────────┐
        │  Target Service   │
        │  (your API/app)   │
        └──────────────────┘
```

---

## Project Structure

```
axion/
├── main.go                    # Entry point, routes, embedded files
├── go.mod / go.sum            # Dependencies
├── static/                    # Embedded frontend
│   ├── index.html             # Single-page dashboard
│   ├── css/
│   │   └── style.css          # Full stylesheet (dark/light themes)
│   └── js/
│       └── app.js             # All dashboard logic
├── internal/
│   ├── engine/
│   │   └── engine.go          # Load generation, stats, records
│   ├── server/
│   │   └── server.go          # HTTP handlers, WebSocket, history API
│   ├── monitor/
│   │   └── monitor.go         # System vitals sampling
│   └── ws/
│       └── hub.go             # WebSocket client management
└── README.md
```

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Dashboard UI |
| `WS` | `/ws` | WebSocket (live stats) |
| `POST` | `/api/start` | Start a load test |
| `POST` | `/api/stop` | Stop running test |
| `GET` | `/api/history` | Get test history (JSON) |

### Start Test Request

```json
{
  "targetUrl": "https://httpbin.org/get",
  "concurrency": 50,
  "requestDelayMs": 100,
  "durationSecs": 30
}
```

### History Response

```json
[
  {
    "id": "45231890",
    "targetUrl": "https://httpbin.org/get",
    "concurrency": 50,
    "durationSecs": 30.01,
    "totalRequests": 15042,
    "successCount": 15000,
    "errorCount": 42,
    "avgRPS": 500.8,
    "maxRPS": 612.3,
    "averageLatencyMs": 45.2,
    "p99LatencyMs": 89.7,
    "status": "completed"
  }
]
```

---

## Tech Stack

| Component | Technology |
|---|---|
| Engine | Go (goroutines, net/http) |
| Real-time | WebSocket (Gorilla WebSocket) |
| Frontend | Vanilla HTML/CSS/JS (no framework) |
| Icons | Font Awesome 6 |
| Fonts | Inter + JetBrains Mono |
| Storage | In-memory (server) + localStorage (browser) |

---

## Roadmap

- [ ] CLI headless mode (`axion test --url ...`)
- [ ] Request body support (POST, custom headers, auth tokens)
- [ ] Distributed load generation (multiple agents)
- [ ] Configurable thresholds (auto-stop on high error rate)
- [ ] VS Code extension
- [ ] Docker image
- [ ] Grafana/Prometheus integration

---

## Contributing

Contributions are welcome! Axion is in active development.

```bash
# Fork and clone
git clone https://github.com/toyosee/axion.git
cd axion

# Run tests
go test ./...

# Start development server
go run main.go
```

Please open an issue before submitting major changes to discuss your ideas.

---

## License

MIT © [Elijah Abolaji](https://github.com/toyosee) — [Barterverse Technologies Ltd.](https://github.com/toyosee)

---

<div align="center">

**Built with precision for modern engineering teams.**

*"If you can read a heartbeat, you can understand your infrastructure."*

</div>