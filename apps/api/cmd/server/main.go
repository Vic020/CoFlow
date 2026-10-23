package main

import (
	migrations "coflow/api/db"
	"coflow/api/internal/httpapi"
	"coflow/api/internal/identity"
	"coflow/api/internal/store"
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	demo := os.Getenv("COFLOW_DEMO") == "true"
	var repo store.Repository
	cfg := httpapi.Config{Demo: demo, SecureCookies: os.Getenv("COFLOW_SECURE_COOKIES") == "true"}
	if url := os.Getenv("DATABASE_URL"); url != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		p, err := store.NewPostgres(ctx, url)
		if err != nil {
			log.Fatal(err)
		}
		defer p.Close()
		if err = migrations.Apply(ctx, p.Pool()); err != nil {
			log.Fatal(err)
		}
		repo = p
		if !demo {
			cfg.Identity = identity.New(p.Pool())
		}
		if demo {
			existing, err := p.List(ctx, "demo")
			if err != nil {
				log.Fatal("apply db/migrations/001_init.sql first: ", err)
			}
			if len(existing) == 0 {
				for _, r := range store.Seed(time.Now()) {
					comments := r.Comments
					v, err := p.Save(ctx, r)
					if err != nil {
						log.Fatal(err)
					}
					for _, c := range comments {
						c.ReportID = v.ID
						if _, err = p.Comment(ctx, "demo", c); err != nil {
							log.Fatal(err)
						}
					}
				}
			}
		}
	} else {
		if !demo {
			log.Fatal("DATABASE_URL is required for team mode; use COFLOW_DEMO=true only for the local demo")
		}
		path := os.Getenv("COFLOW_DATA_FILE")
		if path == "" {
			path = ".data/demo.json"
		}
		m, err := store.NewMemory(path)
		if err != nil {
			log.Fatal(err)
		}
		repo = m
	}
	addr := os.Getenv("COFLOW_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8080"
	}
	srv := &http.Server{Addr: addr, Handler: httpapi.NewWithConfig(repo, cfg), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 15 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 1 << 20}
	go func() {
		log.Printf("CoFlow API http://%s (demo=%t)", addr, demo)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
