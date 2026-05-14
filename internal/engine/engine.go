// Package engine implements the core load testing logic, 
// including worker management, request execution, and 
// real-time statistics tracking.
// Author: Elijah Abolaji (tyabolaji@gmail.com)

package engine

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"sync"
	"sync/atomic"
	"time"
)

// Config holds the test parameters
type Config struct {
	TargetURL    string
	Concurrency  int
	Duration     time.Duration // 0 = run until manually stopped
	RequestDelay time.Duration
}

// Stats holds live statistics about the test
type Stats struct {
	TotalRequests    int64   `json:"totalRequests"`
	ActiveWorkers    int64   `json:"activeWorkers"`
	SuccessCount     int64   `json:"successCount"`
	ErrorCount       int64   `json:"errorCount"`
	CurrentRPS       float64 `json:"currentRPS"`
	AverageLatencyMs float64 `json:"averageLatencyMs"`
	P99LatencyMs     float64 `json:"p99LatencyMs"`
	MinLatencyMs     float64 `json:"minLatencyMs"`
	MaxLatencyMs     float64 `json:"maxLatencyMs"`
	ElapsedSeconds   float64 `json:"elapsedSeconds"`
	// Internal tracking
	lastTickRequests int64
	lastTickTime     time.Time
	latencies        []float64
	mu               sync.Mutex
}

// TestRecord stores a completed test's final results
type TestRecord struct {
	ID               string    `json:"id"`
	TargetURL        string    `json:"targetUrl"`
	Concurrency      int       `json:"concurrency"`
	RequestDelayMs   int       `json:"requestDelayMs"`
	DurationSecs     float64   `json:"durationSecs"`
	TotalRequests    int64     `json:"totalRequests"`
	SuccessCount     int64     `json:"successCount"`
	ErrorCount       int64     `json:"errorCount"`
	AvgRPS           float64   `json:"avgRPS"`
	MaxRPS           float64   `json:"maxRPS"`
	AverageLatencyMs float64   `json:"averageLatencyMs"`
	P99LatencyMs     float64   `json:"p99LatencyMs"`
	MinLatencyMs     float64   `json:"minLatencyMs"`
	MaxLatencyMs     float64   `json:"maxLatencyMs"`
	StartedAt        time.Time `json:"startedAt"`
	CompletedAt      time.Time `json:"completedAt"`
	Status           string    `json:"status"` // "completed", "stopped", "error"
}

// Engine runs the load test
type Engine struct {
	config     Config
	stats      *Stats
	client     *http.Client
	ctx        context.Context
	cancel     context.CancelFunc
	isRunning  atomic.Bool
	onUpdate   func(*Stats)
	onComplete func(TestRecord)
	startTime  time.Time
	maxRPS     float64
	mu         sync.RWMutex
}

// New creates a new load test engine
func New(cfg Config, onUpdate func(*Stats), onComplete func(TestRecord)) *Engine {
	ctx, cancel := context.WithCancel(context.Background())
	return &Engine{
		config:     cfg,
		client:     &http.Client{Timeout: 30 * time.Second},
		ctx:        ctx,
		cancel:     cancel,
		onUpdate:   onUpdate,
		onComplete: onComplete,
		stats: &Stats{
			lastTickTime: time.Now(),
			latencies:    make([]float64, 0, 10000),
			MinLatencyMs: 999999,
		},
	}
}

// Start begins the load test
func (e *Engine) Start() {
	if !e.isRunning.CompareAndSwap(false, true) {
		return
	}

	e.startTime = time.Now()

	// If duration is set, create a timer to auto-stop
	if e.config.Duration > 0 {
		go func() {
			timer := time.NewTimer(e.config.Duration)
			defer timer.Stop()

			select {
			case <-timer.C:
				e.stopAndRecord("completed")
			case <-e.ctx.Done():
				return
			}
		}()
	}

	go e.metricsTicker()

	var wg sync.WaitGroup
	for i := 0; i < e.config.Concurrency; i++ {
		wg.Add(1)
		go e.worker(&wg)
	}

	go func() {
		wg.Wait()
		if e.isRunning.Load() {
			e.stopAndRecord("completed")
		}
	}()
}

// Stop halts the load test and records results
func (e *Engine) Stop() {
	e.stopAndRecord("stopped")
}

func (e *Engine) stopAndRecord(status string) {
	if !e.isRunning.CompareAndSwap(true, false) {
		return
	}

	e.cancel()

	record := e.buildRecord(status)

	if e.onComplete != nil {
		e.onComplete(record)
	}
}

func (e *Engine) buildRecord(status string) TestRecord {
	e.mu.Lock()
	defer e.mu.Unlock()

	completedAt := time.Now()
	elapsed := completedAt.Sub(e.startTime).Seconds()

	id := fmt.Sprintf("%d", completedAt.UnixMilli()%100000000)

	return TestRecord{
		ID:               id,
		TargetURL:        e.config.TargetURL,
		Concurrency:      e.config.Concurrency,
		RequestDelayMs:   int(e.config.RequestDelay.Milliseconds()),
		DurationSecs:     math.Round(elapsed*100) / 100,
		TotalRequests:    e.stats.TotalRequests,
		SuccessCount:     e.stats.SuccessCount,
		ErrorCount:       e.stats.ErrorCount,
		AvgRPS:           math.Round(float64(e.stats.TotalRequests)/elapsed*100) / 100,
		MaxRPS:           math.Round(e.maxRPS*100) / 100,
		AverageLatencyMs: math.Round(e.stats.AverageLatencyMs*100) / 100,
		P99LatencyMs:     math.Round(e.stats.P99LatencyMs*100) / 100,
		MinLatencyMs:     math.Round(e.stats.MinLatencyMs*100) / 100,
		MaxLatencyMs:     math.Round(e.stats.MaxLatencyMs*100) / 100,
		StartedAt:        e.startTime,
		CompletedAt:      completedAt,
		Status:           status,
	}
}

// GetStats returns a copy of current stats
func (e *Engine) GetStats() Stats {
	e.stats.mu.Lock()
	defer e.stats.mu.Unlock()

	return Stats{
		TotalRequests:    e.stats.TotalRequests,
		ActiveWorkers:    e.stats.ActiveWorkers,
		SuccessCount:     e.stats.SuccessCount,
		ErrorCount:       e.stats.ErrorCount,
		CurrentRPS:       e.stats.CurrentRPS,
		AverageLatencyMs: e.stats.AverageLatencyMs,
		P99LatencyMs:     e.stats.P99LatencyMs,
		MinLatencyMs:     e.stats.MinLatencyMs,
		MaxLatencyMs:     e.stats.MaxLatencyMs,
		ElapsedSeconds:   time.Since(e.startTime).Seconds(),
	}
}

func (e *Engine) worker(wg *sync.WaitGroup) {
	defer wg.Done()
	atomic.AddInt64(&e.stats.ActiveWorkers, 1)
	defer atomic.AddInt64(&e.stats.ActiveWorkers, -1)

	ticker := time.NewTicker(e.config.RequestDelay)
	defer ticker.Stop()

	for {
		select {
		case <-e.ctx.Done():
			return
		case <-ticker.C:
			e.makeRequest()
		}
	}
}

func (e *Engine) makeRequest() {
	start := time.Now()
	resp, err := e.client.Get(e.config.TargetURL)
	latency := float64(time.Since(start).Microseconds()) / 1000.0

	atomic.AddInt64(&e.stats.TotalRequests, 1)

	e.stats.mu.Lock()
	if err != nil {
		atomic.AddInt64(&e.stats.ErrorCount, 1)
	} else {
		atomic.AddInt64(&e.stats.SuccessCount, 1)
		if resp != nil {
			resp.Body.Close()
		}
	}

	if len(e.stats.latencies) < 10000 {
		e.stats.latencies = append(e.stats.latencies, latency)
	} else {
		e.stats.latencies = append(e.stats.latencies[1:], latency)
	}

	if latency < e.stats.MinLatencyMs {
		e.stats.MinLatencyMs = latency
	}
	if latency > e.stats.MaxLatencyMs {
		e.stats.MaxLatencyMs = latency
	}
	e.stats.mu.Unlock()
}

func (e *Engine) metricsTicker() {
	ticker := time.NewTicker(250 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-e.ctx.Done():
			return
		case <-ticker.C:
			e.calculateDerivedMetrics()
			if e.onUpdate != nil {
				e.onUpdate(e.stats)
			}
		}
	}
}

func (e *Engine) calculateDerivedMetrics() {
	e.stats.mu.Lock()
	defer e.stats.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(e.stats.lastTickTime).Seconds()
	currentRequests := e.stats.TotalRequests - e.stats.lastTickRequests

	if elapsed > 0 {
		e.stats.CurrentRPS = float64(currentRequests) / elapsed
		e.mu.Lock()
		if e.stats.CurrentRPS > e.maxRPS {
			e.maxRPS = e.stats.CurrentRPS
		}
		e.mu.Unlock()
	}

	e.stats.ElapsedSeconds = now.Sub(e.startTime).Seconds()

	if len(e.stats.latencies) > 0 {
		var sum float64
		for _, l := range e.stats.latencies {
			sum += l
		}
		e.stats.AverageLatencyMs = sum / float64(len(e.stats.latencies))
	}

	if len(e.stats.latencies) > 100 {
		sampleSize := len(e.stats.latencies) / 100
		if sampleSize < 1 {
			sampleSize = 1
		}
		p99Sum := 0.0
		for i := len(e.stats.latencies) - sampleSize; i < len(e.stats.latencies); i++ {
			p99Sum += e.stats.latencies[i]
		}
		e.stats.P99LatencyMs = p99Sum / float64(sampleSize)
	}

	e.stats.lastTickRequests = e.stats.TotalRequests
	e.stats.lastTickTime = now
}

// IsRunning returns whether the engine is actively running
func (e *Engine) IsRunning() bool {
	return e.isRunning.Load()
}

// SafeCopy returns a JSON-safe copy of Stats without the mutex
func (s *Stats) SafeCopy() Stats {
	s.mu.Lock()
	defer s.mu.Unlock()

	return Stats{
		TotalRequests:    s.TotalRequests,
		ActiveWorkers:    s.ActiveWorkers,
		SuccessCount:     s.SuccessCount,
		ErrorCount:       s.ErrorCount,
		CurrentRPS:       s.CurrentRPS,
		AverageLatencyMs: s.AverageLatencyMs,
		P99LatencyMs:     s.P99LatencyMs,
		MinLatencyMs:     s.MinLatencyMs,
		MaxLatencyMs:     s.MaxLatencyMs,
		ElapsedSeconds:   s.ElapsedSeconds,
	}
}