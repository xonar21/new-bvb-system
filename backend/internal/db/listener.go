package db

import (
	"context"
	"log"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

type LoadCreatedCallback func(ctx context.Context, id int64)

func ListenLoadsCreated(ctx context.Context, dsn string, cb LoadCreatedCallback) {
	backoff := time.Second

	for {
		if err := ctx.Err(); err != nil {
			return
		}

		conn, err := pgx.Connect(ctx, dsn)
		if err != nil {
			log.Printf("DBListener: connect failed: %v, retry in %v", err, backoff)
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

		if _, err := conn.Exec(ctx, "LISTEN loads_created"); err != nil {
			log.Printf("DBListener: LISTEN failed: %v", err)
			conn.Close(ctx)
			continue
		}

		log.Println("DBListener: listening on loads_created")

		for {
			notification, err := conn.WaitForNotification(ctx)
			if err != nil {
				if ctx.Err() != nil {
					conn.Close(ctx)
					return
				}
				log.Printf("DBListener: notification error: %v, reconnecting", err)
				break
			}

			id, err := strconv.ParseInt(notification.Payload, 10, 64)
			if err != nil {
				log.Printf("DBListener: invalid payload %q: %v", notification.Payload, err)
				continue
			}

			cb(ctx, id)
		}

		conn.Close(ctx)
	}
}
