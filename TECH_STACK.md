## Backend API Technology Stack

This document lists the recommended technologies for the new `backend-api` service. The goals are **security**, **scalability**, **maintainability**, and **developer productivity**.

---

### Core Runtime & Framework

- **Node.js**  
  - JavaScript runtime for building the backend.

- **TypeScript**  
  - Statically typed superset of JavaScript to improve safety, refactoring, and maintainability.

- **Koa**  
  - Minimal, modern web framework for Node.js with middleware-based architecture and good composability.

---

### Database & Data Access

- **PostgreSQL**  
  - Primary relational database for strong consistency, relational modeling, constraints, and transactions.

- **Drizzle ORM**  
  - Type-safe ORM and query builder for PostgreSQL with excellent TypeScript support.

- **drizzle-kit**  
  - Drizzle tooling for schema management and migrations.

- **pg** (PostgreSQL driver)  
  - Underlying driver/pool used by Drizzle for efficient database connections.

- **Database migrations (via drizzle-kit)**  
  - Version-controlled schema changes to keep environments in sync and enable safe deployments.

---

### Validation, Types, and Contracts

- **Zod**  
  - Runtime validation and schema definition for:
    - Request payloads (body, query, params)
    - Response shapes
    - Environment variables
  - Provides shared types between server logic and validation schemas.

- **Zod-based environment validation**  
  - Validate critical environment variables at startup (e.g. `DATABASE_URL`, `JWT_SECRET`, `REDIS_URL`) and fail fast if misconfigured.

- **OpenAPI documentation from Zod** (e.g. `@asteasolutions/zod-to-openapi`)  
  - Generate OpenAPI/Swagger documentation from Zod schemas so validation is the single source of truth for contracts.

---

### HTTP & API Middleware

- **@koa/cors**  
  - Configure CORS (allowed origins, headers, methods, credentials) for browser clients.

- **koa-bodyparser** (or similar)  
  - Parse JSON and URL-encoded request bodies for Koa.

- **koa-router** (or `@koa/router`)  
  - Route definitions with support for path parameters and middleware per route.

- **koa-helmet**  
  - Security-related HTTP headers (CSP, X-Frame-Options, etc.) to mitigate common attacks.

- **koa-compress**  
  - Gzip/Brotli compression for responses to reduce bandwidth.

- **koa-static** (if serving static assets)  
  - Static file serving (only needed if backend directly serves static content).

---

### Authentication & Authorization

- **jose** or **koa-jwt**  
  - JWT signing and verification for stateless authentication.

- **argon2** (or **bcrypt**)  
  - Password hashing library for securely storing credentials (Argon2 is preferred modern choice).

- **@koa/csrf** (if using cookie-based sessions)  
  - CSRF protection middleware for cookie/session-based auth flows.

- **Role/permission layer (custom)**  
  - Centralized authorization utilities to check roles/permissions per route.

---

### Security & Hardening

- **koa-helmet** (listed above)  
  - Security headers (XSS, clickjacking, MIME sniffing protections).

- **Rate limiting (koa-ratelimit)**  
  - Protect public endpoints from abuse/brute-force attacks (usually backed by Redis).

- **ioredis**  
  - Redis client used for:
    - Rate limiting storage
    - Caching
    - Background jobs
    - Sessions (if needed)

- **Input validation & sanitization**  
  - Primary: Zod schemas.
  - Additional: escape or sanitize any user-provided HTML or text where needed (e.g. `sanitize-html`).

- **Secure configuration management**  
  - `.env` files loaded through `dotenv` (or similar) and validated with Zod.

---

### Logging, Monitoring & Observability

- **Pino**  
  - High-performance JSON logger for Node.js.

- **koa-pino-logger**  
  - Koa middleware to attach request-based logging with Pino.

- **Correlation / Request IDs** (e.g. `uuid`)  
  - Generate and log a unique ID per request so logs can be traced end-to-end.

- **Structured error handling middleware** (custom)  
  - Centralized Koa middleware to:
    - Catch unhandled errors
    - Map them to standardized error responses
    - Log with context (user ID, request ID, route).

- **Metrics (optional)**  
  - `prom-client` or similar for exporting Prometheus metrics (HTTP latency, DB latency, error rates).

---

### Background Jobs, Caching & Messaging

- **Redis**  
  - In-memory store used for:
    - Caching (e.g. frequently accessed data)
    - Rate limiting storage
    - Background job queues
    - Session storage (if applicable)

- **BullMQ** (or similar Redis-based queue)  
  - Background job processing for:
    - Emails
    - Webhooks
    - Reports
    - Heavy computations

- **Task schedulers**  
  - Either:
    - Cron-based jobs in the app, or
    - External schedulers (e.g. hosted cron) triggering HTTP endpoints or queue jobs.

---

### Offline-Safe & Idempotent APIs

- **Idempotency keys for critical writes**  
  - Include a client-generated idempotency key (e.g. `clientRequestId`) on endpoints like `/sales` so retried offline-queued requests do not create duplicates.

- **Database-level uniqueness**  
  - Enforce unique constraints in PostgreSQL (via Drizzle migrations) on idempotency key columns to guarantee at-most-once creation even under concurrent retries.

- **Clear retry semantics**  
  - Design error codes and response shapes so offline sync logic can distinguish between retriable failures (e.g. network, 5xx) and permanent ones (e.g. validation errors, 4xx).

---

### Testing & Quality

- **Vitest**  
  - Fast test runner with great TypeScript support.

- **Supertest** (or similar)  
  - HTTP integration testing for Koa endpoints.

- **Testing-library equivalents** (where applicable)  
  - For more realistic API tests focused on behavior.

- **ESLint**  
  - Linting for code quality and consistency (with TypeScript support via `@typescript-eslint`).

- **Prettier**  
  - Opinionated code formatter to maintain a consistent style.

- **Husky** + **lint-staged**  
  - Pre-commit hooks to run linting/formatting/tests automatically on changed files.

---

### Development Experience & Tooling

- **tsx** or **ts-node**  
  - Run TypeScript directly in development without a separate build step.

- **Nodemon** (or `ts-node-dev` / `tsx --watch`)  
  - Auto-restart the dev server on file changes.

- **Build tooling (optional)**  
  - `tsup`, `esbuild`, or `swc` for fast production builds and bundling if needed.

- **Editor configuration**  
  - VSCode/Editor settings + recommended extensions (ESLint, Prettier, TypeScript tooling).

---

### API Documentation & Developer Portals

- **OpenAPI/Swagger UI**  
  - Interactive documentation for the API, generated from Zod schemas via OpenAPI tooling.

- **Postman / Insomnia collections**  
  - Optional API collections for manual testing and collaboration.

- **Client SDK generation (optional)**  
  - Generate TypeScript/JavaScript clients from OpenAPI for frontend or third-party integrators.

---

### External Integrations & Payments

- **HTTP client for third-party services** (e.g. `undici` or `axios`)  
  - For calling external APIs such as payment gateways or messaging providers from the backend (e.g. `/bv-payments/subscription-stk-push`).

- **M‑Pesa / mobile money SDK or integration**  
  - Library or custom integration layer for handling STK push flows and callbacks (e.g. for subscription payments).

- **Additional payment providers (optional)**  
  - Abstraction layer that allows plugging in providers like Stripe, Flutterwave, etc. later if needed.

---

### Email & Notifications

- **Nodemailer**  
  - Core email sending library for Node.js.

- **Email provider integration** (SMTP, SendGrid, Mailgun, etc.)  
  - For reliable delivery of transactional emails (invites, password reset, alerts).

- **Optional SMS/WhatsApp provider**  
  - For transactional messages (e.g. using services similar to Africa's Talking or Twilio).

---

### File Uploads & Media

- **Upload handling middleware** (e.g. `koa-multer` or streaming with `busboy`)  
  - For handling product images, documents, or other binary uploads from the web app.

- **Object storage** (e.g. AWS S3, Cloudinary, or similar)  
  - Persistent, CDN-capable storage for uploaded media referenced by fields like `imageUrl`.

---

### Real-time Updates (Optional)

- **WebSockets layer** (e.g. Socket.IO or ws)  
  - For live dashboards, POS updates, or notification feeds if needed in the future.

- **Hosted real-time services (optional)** (e.g. Pusher, Ably)  
  - Managed real-time infrastructure if you prefer not to run WebSockets yourself.

---

### Deployment, Operations & Resilience

- **Graceful shutdown handling**  
  - Capture `SIGTERM`/`SIGINT` to:
    - Stop accepting new connections
    - Finish in-flight requests
    - Close database and Redis connections cleanly.

- **Health & readiness endpoints**  
  - `/health` for basic liveness.
  - `/ready` for checking dependencies (Postgres, Redis, etc.) before traffic is sent.

- **Containerization (Docker)**  
  - Dockerfile and Docker Compose / Kubernetes manifests for repeatable deployments.

- **Configuration by environment**  
  - Use env vars for secrets and environment-specific configuration (dev/stage/prod).

---

### Summary of Key Technologies

- **Core**: Node.js, TypeScript, Koa  
- **Database**: PostgreSQL, Drizzle ORM, drizzle-kit, `pg`  
- **Validation & contracts**: Zod, Zod-based env validation, OpenAPI generation  
- **HTTP & middleware**: @koa/cors, koa-bodyparser, koa-router, koa-helmet, koa-compress  
- **Auth & security**: jose/koa-jwt, argon2, @koa/csrf (if cookie-based auth), Redis-backed rate limiting  
- **Observability**: Pino, koa-pino-logger, request IDs, optional Prometheus metrics  
- **Background work & caching**: Redis, BullMQ (or similar)  
- **Quality & DX**: Vitest, Supertest, ESLint, Prettier, Husky, lint-staged, tsx/ts-node, nodemon or watch-based dev server  
- **Ops**: Health/readiness endpoints, graceful shutdown, Docker-based deployment

