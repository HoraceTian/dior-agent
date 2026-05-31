GO ?= go
BUN ?= bun

GOPATH_DIR := $(CURDIR)/.gopath
GOCACHE_DIR := $(CURDIR)/.go-cache
GOMODCACHE_DIR := $(CURDIR)/.gomodcache
PAGE_BIN := $(CURDIR)/page/node_modules/.bin

GO_ENV := GOPATH=$(GOPATH_DIR) GOCACHE=$(GOCACHE_DIR) GOMODCACHE=$(GOMODCACHE_DIR)
GO_PACKAGES := ./cmd/... ./internal/...

.PHONY: dev collector-dev start build test test-all page-install page-dev page-build page-typecheck clean

dev:
	$(GO_ENV) $(GO) run ./cmd/agent-server

collector-dev:
	$(GO_ENV) $(GO) run ./cmd/collector

start: build
	./dist/dior-agent

build:
	mkdir -p dist
	$(GO_ENV) $(GO) build -o dist/dior-agent ./cmd/agent-server
	$(GO_ENV) $(GO) build -o dist/dior-collector ./cmd/collector

test:
	$(GO_ENV) $(GO) test $(GO_PACKAGES)

test-all: test build page-build

page-install:
	cd page && $(BUN) install

page-dev:
	cd page && $(PAGE_BIN)/vite --host 127.0.0.1

page-build:
	cd page && $(PAGE_BIN)/tsc --noEmit && $(PAGE_BIN)/vite build

page-typecheck:
	cd page && $(PAGE_BIN)/tsc --noEmit

clean:
	rm -rf dist .go-cache .gomodcache .gopath page/dist
