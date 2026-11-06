# SokoApp Backend

Multi-stack monorepo for the SokoApp ecosystem.

## Architecture

```
SokoApp (React Native)
      │
      ▼
Go API Gateway (Gin)  ──── Redis (sessions, cache, queues)
      │                         │
      ▼                         ▼
Unified Auth (JWT)         Asynq Workers
      │                    (driver assignment, push notifications,
      ▼                     KYC processing, statements)
┌─────────────────────────────────────────┐
│              PostgreSQL                 │
│  sokoaccount │ sokoshopper │ sokodelivery│
│  sokoloan    │ sokosusu    │ sokobank    │
└─────────────────────────────────────────┘
      │
      ▼
MinIO (profile images, KYC docs)
Paystack (payments + webhooks)
FCM / APNs (push notifications)
```

## Quick Start

```bash
# 1. Clone and enter
git clone <repo> sokoapp-backend && cd sokoapp-backend

# 2. Copy env file and fill in your secrets
cp .env.example .env

# 3. Start all services (Postgres, Redis, MinIO, API, Worker)
make up

# 4. Run all database migrations
make migrate

# 5. Check health
curl http://localhost:8082/health
```

## Database Domains

| DB | Purpose |
|---|---|
| `sokoaccount` | Users, KYC, roles, driver profiles, sessions |
| `sokoshopper` | Restaurants, menus, cart, orders, payments |
| `sokodelivery` | Delivery assignments, real-time tracking, earnings |
| `sokoloan` | Loan products, applications, repayment schedules |
| `sokosusu` | Rotating savings groups (ROSCA/chit fund) |
| `sokobank` | Wallets, transactions, transfers, statements |

## API Reference

### Auth (public)
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/auth/register` | Register (multipart/form-data with optional profile_image) |
| POST | `/api/v1/auth/login` | Login (email or phone + password) |
| POST | `/api/v1/auth/refresh` | Refresh JWT pair |
| POST | `/api/v1/auth/logout` | Revoke refresh token |

### Webhooks (public, signature-verified)
| Method | Path | Description |
|---|---|---|
| POST | `/api/v1/webhooks/paystack` | Paystack payment events |

### Protected (Bearer JWT required)
All routes under `/api/v1/` except auth and webhooks.

See `cmd/api/main.go` for the full route tree.

### Weather + SokoTraffic (Google Maps Platform)
| Endpoint | Google API | Rate limit (per user) |
|---|---|---|
| `GET /api/v1/weather/current?lat=&lng=` | Weather API (current conditions + hourly) | 20/min |
| `POST /api/v1/traffic/routes` `{origin:{lat,lng}, destination:{lat,lng}, travel_mode: DRIVE\|TWO_WHEELER\|WALK}` | Routes API `computeRoutes` (traffic-aware, alternatives) | 20/min |
| `GET /api/v1/traffic/places/autocomplete?q=&lat=&lng=&session=` | Places API (New) Autocomplete | 60/min |
| `GET /api/v1/traffic/places/:id?session=` | Places API (New) Place Details | 60/min |

Environment (server only, never in the app):
```
GOOGLE_WEATHER_API_KEY=   # key restricted to Weather API
GOOGLE_ROUTES_API_KEY=    # key restricted to Routes API
GOOGLE_PLACES_API_KEY=    # key restricted to Places API (New); falls back to the routes key
GOOGLE_MAPS_SERVER_KEY=   # optional shared fallback for any of the above
TRAFFIC_REGION_CODES=gh   # optional: limit destination search to these countries
WEATHER_CACHE_SECONDS=0   # optional: Redis cache per ~1 km cell; only if Google's terms allow
```
A feature with no key answers `503 {"code":"not_configured"}` and the app hides it gracefully.
Coordinates are rounded to ~1 km for weather, never logged, and no route history is stored.

## Registration Flow

```
POST /api/v1/auth/register
  Content-Type: multipart/form-data

  full_name        string (required)
  gender           enum: male|female|other|prefer_not_to_say
  date_of_birth    YYYY-MM-DD
  phone_number     string (required, unique)
  email            string (required, unique)
  password         string (min 8 chars)
  confirm_password string (must match password)
  profile_image    file  (optional, JPEG/PNG)

→ 201 { user, tokens, kyc_status: "pending" }
```

After registration the app checks `requires_kyc: true` and routes the user to the KYC form. KYC data is saved in `sokoaccount.kyc_submissions`.

## Payment Reference Convention

Paystack references follow this prefix scheme so the webhook router knows which subapp to update:

| Prefix | Subapp |
|---|---|
| `SK-SHOP-` | sokoshopper order |
| `SK-DEL-` | sokodelivery order |
| `SK-LOAN-` | sokoloan repayment |
| `SK-SUSU-` | sokosusu contribution |
| `SK-BANK-` | sokobank topup |

## Role Hierarchy

```
superadmin
  ├── sokoshopper_admin
  ├── sokodelivery_admin
  ├── sokoloan_admin
  ├── sokosusu_admin
  ├── sokobank_admin
  ├── driver
  └── user
```

Users start with `user` role. After KYC approval they can apply as a driver. Admins are assigned by a superadmin.

## Makefile Commands

```bash
make up            # Start all Docker services
make down          # Stop all services
make migrate       # Run all DB migrations
make migrate-down  # Roll back last migration (all DBs)
make migrate-one DB=sokoshopper  # Migrate single DB
make logs          # Follow API + worker logs
make build         # Compile binaries
make test          # Run tests with race detector
make lint          # Run golangci-lint
make clean         # Remove volumes + binaries
make psql-account  # Connect to sokoaccount via psql
make redis-cli     # Open Redis CLI
```

## Tech Stack

| Layer | Technology |
|---|---|
| Language | Go 1.22 |
| HTTP | Gin |
| Auth | JWT (golang-jwt/jwt v5) + bcrypt |
| Database driver | pgx v5 (pgxpool) |
| Migrations | golang-migrate |
| Cache / Queue | Redis 7 |
| Async workers | Asynq |
| Object storage | MinIO (S3-compatible) |
| Payments | Paystack |
| Push notifications | FCM (Firebase) |
| Geo queries | PostGIS |
| Containerisation | Docker + Docker Compose |

## Hosting Changes
Definitely change:

DB_PASSWORD=password — too obvious, use something like a random 20+ character string
STORAGE_ACCESS_KEY=minioadmin and STORAGE_SECRET_KEY=minioadmin — default MinIO credentials, change both
JWT_SECRET — the one you have is weak, generate a proper random 32+ character secret

Update for server context:

DB_HOST=localhost → should be postgres (the Docker service name, since your Go API will be in the same Docker network)
REDIS_HOST=localhost → should be redis
STORAGE_ENDPOINT=localhost:9000 → should be minio:9000
STORAGE_PUBLIC_URL=http://192.168.2.195:9000 → replace with your server's public IP or domain
API_BASE_URL=http://192.168.2.195:8082 → same, replace with server IP/domain
GIN_MODE=debug → change to release