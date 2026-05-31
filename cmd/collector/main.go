package main

import (
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"dior-agent/internal/collectorapp"
)

func main() {
	path := os.Getenv("COLLECTOR_CONFIG")
	if path == "" {
		path = "collector.toml"
	}
	config, err := collectorapp.LoadConfig(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
	app, err := collectorapp.NewServer(config)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
	server := &http.Server{
		Addr:              config.Collector.Bind,
		Handler:           app.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		collectorapp.LogStarted(config.Collector.Bind)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			fmt.Fprintln(os.Stderr, err.Error())
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	_ = server.Close()
}
