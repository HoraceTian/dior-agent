package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"dior-agent/internal/app"
	"dior-agent/internal/collector"
	"dior-agent/internal/logging"
	"dior-agent/internal/model"
	"dior-agent/internal/session"
	transportws "dior-agent/internal/transport/ws"
)

func main() {
	if err := app.LoadEnvFile(".env"); err != nil {
		fmt.Fprintf(os.Stderr, "load .env: %v\n", err)
		os.Exit(1)
	}

	config, err := app.LoadConfig(nil)
	if err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}

	logger := logging.New(config.LogLevel)
	modelManager := model.NewManager(config.ModelConfigPath, config.ModelConfigWatch, logger)
	modelManager.Start()
	defer modelManager.Stop()

	collectors := collector.NewRegistry(config.CollectorsConfigPath, logger)
	collectors.Start(context.Background())

	store := session.NewStore(config.WorkspaceRoot)
	supervisor := session.NewSupervisor(
		session.NewHolderID(config.ServiceName),
		store,
		modelManager,
		model.NewClient(),
		logger,
	)
	router := transportws.NewServer(config, logger, supervisor, collectors)
	server := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", config.Host, config.Port),
		Handler:           router.Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		logger.Info("Dior agent server started", map[string]any{
			"url":    fmt.Sprintf("ws://%s:%d/ws", config.Host, config.Port),
			"health": fmt.Sprintf("http://%s:%d/health", config.Host, config.Port),
		})
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("Dior agent server failed", map[string]any{"error": err.Error()})
			os.Exit(1)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(ctx); err != nil {
		logger.Error("Dior agent server shutdown failed", map[string]any{"error": err.Error()})
	}
}
