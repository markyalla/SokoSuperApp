FROM golang:1.23-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN go build -o api ./cmd/api/main.go
RUN go build -o worker ./cmd/worker/main.go

FROM alpine:latest
WORKDIR /app
COPY --from=builder /app/api ./api
COPY --from=builder /app/worker ./worker
EXPOSE 8082
CMD ["./api"]