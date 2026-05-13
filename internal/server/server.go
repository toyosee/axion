package server

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/toyosee/axion/internal/engine"
	"github.com/toyosee/axion/internal/monitor"
	"github.com/toyosee/axion/internal/ws"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for local dev
	},
}

// Server is the main HTTP + WebSocket server
type Server struct {
	hub         *ws.Hub
	engine      *engine.Engine
	monitor     *monitor.Monitor
	mu          sync.Mutex
	testRecords []engine.TestRecord
	recordsMu   sync.RWMutex
}

// StartTestRequest comes from the frontend
type StartTestRequest struct {
	TargetURL      string `json:"targetUrl"`
	Concurrency    int    `json:"concurrency"`
	DurationSecs   int    `json:"durationSecs"`
	RequestDelayMs int    `json:"requestDelayMs"`
}

// New creates a new Server
func New() *Server {
	hub := ws.NewHub()
	go hub.Run()

	return &Server{
		hub:         hub,
		testRecords: make([]engine.TestRecord, 0),
	}
}

// HandleWS handles WebSocket connections
func (s *Server) HandleWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade error:", err)
		return
	}

	client := ws.NewClient(s.hub, conn)
	s.hub.Register(client)

	go client.WritePump()
	go client.ReadPump()
}

// HandleStartTest starts a new load test
func (s *Server) HandleStartTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req StartTestRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// Stop existing test if running
	if s.engine != nil && s.engine.IsRunning() {
		s.engine.Stop()
	}
	if s.monitor != nil {
		s.monitor.Stop()
	}

	// Create and start new engine
	cfg := engine.Config{
		TargetURL:    req.TargetURL,
		Concurrency:  req.Concurrency,
		Duration:     time.Duration(req.DurationSecs) * time.Second,
		RequestDelay: time.Duration(req.RequestDelayMs) * time.Millisecond,
	}

	// Engine takes 3 callbacks now: config, onUpdate, onComplete
	s.engine = engine.New(cfg,
		// onUpdate — sends live stats to frontend
		func(stats *engine.Stats) {
			s.hub.Broadcast(ws.Message{
				Type: ws.TypeStats,
				Data: stats.SafeCopy(),
			})
		},
		// onComplete — stores record and notifies frontend
		func(record engine.TestRecord) {
			s.recordsMu.Lock()
			s.testRecords = append([]engine.TestRecord{record}, s.testRecords...)
			if len(s.testRecords) > 50 {
				s.testRecords = s.testRecords[:50]
			}
			s.recordsMu.Unlock()

			s.hub.Broadcast(ws.Message{
				Type: ws.TypeStatus,
				Data: map[string]interface{}{
					"status": "completed",
					"record": record,
				},
			})

			log.Printf("Test completed: %s — %d req in %.1fs (status: %s)",
				record.ID, record.TotalRequests, record.DurationSecs, record.Status)
		},
	)

	s.engine.Start()

	// Start monitoring
	s.monitor = monitor.New(func(v monitor.Vitals) {
		s.hub.Broadcast(ws.Message{
			Type: ws.TypeVitals,
			Data: v,
		})
	})
	s.monitor.Start()

	// Send status update
	s.hub.Broadcast(ws.Message{
		Type: ws.TypeStatus,
		Data: map[string]string{"status": "running"},
	})

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "started"})
}

// HandleStopTest stops the running test
func (s *Server) HandleStopTest(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if s.engine != nil {
		s.engine.Stop()
	}
	if s.monitor != nil {
		s.monitor.Stop()
	}

	s.hub.Broadcast(ws.Message{
		Type: ws.TypeStatus,
		Data: map[string]string{"status": "stopped"},
	})

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "stopped"})
}

// HandleGetHistory returns test history
func (s *Server) HandleGetHistory(w http.ResponseWriter, r *http.Request) {
	s.recordsMu.RLock()
	defer s.recordsMu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.testRecords)
}