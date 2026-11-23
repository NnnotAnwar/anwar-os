// ops-agent: the only anwar.os process with the Docker socket. web calls it over
// the internal network with HMAC-signed requests (internal/sign); it lists,
// starts, stops, restarts and redeploys containers labelled os.managed=true
// (internal/agent). See services/ops-agent/README.md.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/nnnotanwar/anwar-os/services/ops-agent/internal/agent"
	"github.com/nnnotanwar/anwar-os/services/ops-agent/internal/docker"
	"github.com/nnnotanwar/anwar-os/services/ops-agent/internal/sign"
)

// Set at build time: -ldflags "-X main.version=<sha>".
var version = "dev"

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func seconds(key string, def int) time.Duration {
	n, err := strconv.Atoi(env(key, strconv.Itoa(def)))
	if err != nil || n <= 0 {
		n = def
	}
	return time.Duration(n) * time.Second
}

func main() {
	healthcheck := flag.Bool("healthcheck", false, "probe /healthz on the local listener and exit 0/1 (image HEALTHCHECK)")
	flag.Parse()

	addr := env("OPS_AGENT_ADDR", ":8080")
	if *healthcheck {
		os.Exit(probe(addr))
	}

	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	secret := os.Getenv("OPS_AGENT_SECRET")
	if len(secret) < 32 {
		log.Error("OPS_AGENT_SECRET must be set to at least 32 characters (openssl rand -hex 32)")
		os.Exit(2)
	}

	engine := docker.New(env("DOCKER_SOCKET", "/var/run/docker.sock"))
	if user, token := os.Getenv("OPS_AGENT_REGISTRY_USER"), os.Getenv("OPS_AGENT_REGISTRY_TOKEN"); user != "" && token != "" {
		engine.SetRegistryCredentials(env("OPS_AGENT_REGISTRY_HOST", "ghcr.io"), user, token)
	}

	a := agent.New(engine, sign.NewVerifier([]byte(secret)), agent.Config{
		Projects:      projects(),
		DeployTimeout: seconds("OPS_AGENT_DEPLOY_TIMEOUT", 240),
		Settle:        seconds("OPS_AGENT_SETTLE", 10),
		Version:       version,
	}, log)

	srv := &http.Server{
		Addr:              addr,
		Handler:           a.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Minute, // a deploy waits for the healthcheck
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()
	go func() {
		<-ctx.Done()
		// Let a running deploy finish or roll back before exiting.
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()

	log.Info("ops-agent listening", "addr", addr, "version", version, "projects", strings.Join(projects(), ","))
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("server stopped", "err", err.Error())
		os.Exit(1)
	}
}

func probe(addr string) int {
	host, port := "127.0.0.1", addr
	if len(addr) > 0 && addr[0] == ':' {
		port = addr[1:]
	} else if h, p, ok := cut(addr); ok {
		host, port = h, p
	}
	client := http.Client{Timeout: 3 * time.Second}
	res, err := client.Get(fmt.Sprintf("http://%s:%s/healthz", host, port))
	if err != nil {
		return 1
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return 1
	}
	return 0
}

func cut(addr string) (string, string, bool) {
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' {
			h := addr[:i]
			if h == "" || h == "0.0.0.0" {
				h = "127.0.0.1"
			}
			return h, addr[i+1:], true
		}
	}
	return "", "", false
}

// projects reads OPS_AGENT_PROJECTS ("anwar-os,shiftella"; the first is the
// primary) or, for older .env files, the single OPS_AGENT_PROJECT.
func projects() []string {
	raw := os.Getenv("OPS_AGENT_PROJECTS")
	if raw == "" {
		raw = os.Getenv("OPS_AGENT_PROJECT")
	}
	var out []string
	for _, p := range strings.Split(raw, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}
