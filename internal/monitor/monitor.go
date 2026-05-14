// Package monitor provides a simple way to track system resource usage 
// such as CPU and memory. It periodically samples these vitals and can 
// invoke a callback with the latest data.
// Author: Elijah Abolaji (tyabolaji@gmail.com)

package monitor

import (
	"runtime"
	"time"
)

// Vitals represents system resource usage
type Vitals struct {
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryMB      float64 `json:"memoryMB"`
	NumGoroutines int     `json:"numGoroutines"`
}

// Monitor periodically samples system vitals
type Monitor struct {
	stopCh   chan struct{}
	onSample func(Vitals)
}

// New creates a new monitor
func New(onSample func(Vitals)) *Monitor {
	return &Monitor{
		stopCh:   make(chan struct{}),
		onSample: onSample,
	}
}

// Start begins monitoring
func (m *Monitor) Start() {
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()

		for {
			select {
			case <-m.stopCh:
				return
			case <-ticker.C:
				m.sample()
			}
		}
	}()
}

// Stop halts monitoring
func (m *Monitor) Stop() {
	close(m.stopCh)
}

func (m *Monitor) sample() {
	var mem runtime.MemStats
	runtime.ReadMemStats(&mem)

	v := Vitals{
		MemoryMB:      float64(mem.Alloc) / 1024 / 1024,
		NumGoroutines: runtime.NumGoroutine(),
		CPUPercent:    float64(runtime.NumGoroutine()) / 100, // rough approximation
	}

	if m.onSample != nil {
		m.onSample(v)
	}
}