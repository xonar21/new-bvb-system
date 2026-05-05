package db

import (
	"context"
	"log"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

type LoadCreatedCallback func(ctx context.Context, id int64)
type AllowedIPsChangedCallback func(ctx context.Context)

func listenLoop(ctx context.Context, dsn, channel string, onNotify func(payload string), onReconnect func()) {
	backoff := time.Second

	for {
		if err := ctx.Err(); err != nil {
			return
		}

		conn, err := pgx.Connect(ctx, dsn)
		if err != nil {
			log.Printf("DBListener(%s): connect failed: %v, retry in %v", channel, err, backoff)
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			if backoff < 30*time.Second {
				backoff *= 2
			}
			continue
		}

		backoff = time.Second

		if _, err := conn.Exec(ctx, "LISTEN "+channel); err != nil {
			log.Printf("DBListener(%s): LISTEN failed: %v", channel, err)
			conn.Close(ctx)
			continue
		}

		log.Printf("DBListener: listening on %s", channel)

		if onReconnect != nil {
			onReconnect()
		}

		for {
			notification, err := conn.WaitForNotification(ctx)
			if err != nil {
				if ctx.Err() != nil {
					conn.Close(ctx)
					return
				}
				log.Printf("DBListener(%s): notification error: %v, reconnecting", channel, err)
				break
			}

			onNotify(notification.Payload)
		}

		conn.Close(ctx)
	}
}

func ListenLoadsCreated(ctx context.Context, dsn string, cb LoadCreatedCallback) {
	listenLoop(ctx, dsn, "loads_created", func(payload string) {
		id, err := strconv.ParseInt(payload, 10, 64)
		if err != nil {
			log.Printf("DBListener: invalid payload %q: %v", payload, err)
			return
		}
		cb(ctx, id)
	}, nil)
}

func ListenAllowedIPsChanged(ctx context.Context, dsn string, cb AllowedIPsChangedCallback) {
	listenLoop(ctx, dsn, "allowed_ips_changed", func(_ string) {
		cb(ctx)
	}, nil)
}
