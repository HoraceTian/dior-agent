package logging

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

type Logger struct {
	level int
}

const (
	levelDebug = 10
	levelInfo  = 20
	levelWarn  = 30
	levelError = 40
)

func New(level string) Logger {
	return Logger{level: parseLevel(level)}
}

func (l Logger) Debug(message string, fields map[string]any) {
	l.write(levelDebug, "debug", message, fields)
}

func (l Logger) Info(message string, fields map[string]any) {
	l.write(levelInfo, "info", message, fields)
}

func (l Logger) Warn(message string, fields map[string]any) {
	l.write(levelWarn, "warn", message, fields)
}

func (l Logger) Error(message string, fields map[string]any) {
	l.write(levelError, "error", message, fields)
}

func (l Logger) write(weight int, level string, message string, fields map[string]any) {
	if weight < l.level {
		return
	}
	event := map[string]any{
		"time":    time.Now().UTC().Format(time.RFC3339Nano),
		"level":   level,
		"message": message,
	}
	for key, value := range fields {
		event[key] = value
	}
	line, _ := json.Marshal(event)
	if level == "error" {
		fmt.Fprintln(os.Stderr, string(line))
		return
	}
	fmt.Println(string(line))
}

func parseLevel(level string) int {
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "debug":
		return levelDebug
	case "warn":
		return levelWarn
	case "error":
		return levelError
	default:
		return levelInfo
	}
}
