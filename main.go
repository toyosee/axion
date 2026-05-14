// Axion - A lightweight load testing tool with real-time dashboard
// This file contains Axion's main entry point, setting up the 
// HTTP server, WebSocket routes, and serving the dashboard.
// Author: Elijah Abolaji (tyabolaji@gmail.com)

package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"time"

	"github.com/toyosee/axion/internal/server"
)

//go:embed static/*
var staticFiles embed.FS

func openBrowser(url string) {
	var cmd string
	var args []string

	switch runtime.GOOS {
	case "darwin":
		cmd = "open"
		args = []string{url}
	case "linux":
		cmd = "xdg-open"
		args = []string{url}
	case "windows":
		cmd = "cmd"
		args = []string{"/c", "start", url}
	default:
		log.Printf("Cannot auto-open browser on %s. Please open %s manually.", runtime.GOOS, url)
		return
	}

	if err := exec.Command(cmd, args...).Start(); err != nil {
		log.Printf("Failed to open browser: %v", err)
		log.Printf("Please open %s manually.", url)
	}
}

func main() {
	srv := server.New()

	staticFS, err := fs.Sub(staticFiles, "static")
	if err != nil {
		log.Fatal(err)
	}

	// All Application Routes
	http.Handle("/", http.FileServer(http.FS(staticFS)))
	http.HandleFunc("/ws", srv.HandleWS)
	http.HandleFunc("/api/start", srv.HandleStartTest)
	http.HandleFunc("/api/stop", srv.HandleStopTest)
	http.HandleFunc("/api/history", srv.HandleGetHistory)

	port := ":8080"
	url := "http://localhost" + port
	dev_url := "https://github.com/toyosee"

	log.Printf("Axion is alive on %s", url)
	log.Printf("Launching dashboard in your default browser...")
	log.Printf("Developed by Elijah Abolaji %s", dev_url)

	go func() {
		time.Sleep(500 * time.Millisecond)
		openBrowser(url)
	}()

	if err := http.ListenAndServe(port, nil); err != nil {
		log.Fatal(err)
	}
}