FROM golang:1.26-alpine AS builder

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/server/

FROM alpine:3.19
RUN apk --no-cache add ca-certificates tzdata
COPY --from=builder /server /server

EXPOSE 3001
CMD ["/server"]
