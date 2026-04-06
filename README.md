# Procela

A SaaS platform that helps organizations connect their business processes to the data and systems that support them.

## Architecture Overview

Procela is organized as a monorepo with two primary packages:

- **packages/backend** - REST API server handling authentication, data processing, and business logic
- **packages/frontend** - Single-page application providing the user interface

## Tech Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Backend    | Node.js, Express, Prisma, PostgreSQL |
| Frontend   | React, TypeScript, Vite             |
| Cache      | Redis                               |
| AI         | Anthropic Claude API                |
| Auth       | JWT, AWS Cognito, SAML (pluggable)  |
| Storage    | Local filesystem or AWS S3          |

## Prerequisites

- Node.js 20+
- Docker and Docker Compose
- npm 9+

## Quick Start

```bash
# Clone the repository
git clone <repo-url> && cd Procela

# Copy environment variables
cp .env.example .env

# Start infrastructure services
docker compose up -d postgres redis

# Install dependencies
npm install

# Run database migrations (from packages/backend)
npm run migrate -w packages/backend

# Start development servers
npm run dev
```

The frontend will be available at `http://localhost:3000` and the API at `http://localhost:3001`.

## Available Scripts

| Script          | Description                                      |
|-----------------|--------------------------------------------------|
| `npm run dev`   | Start backend and frontend in development mode   |
| `npm run build` | Build both backend and frontend for production   |
| `npm test`      | Run tests across all packages                    |
| `npm run lint`  | Lint all packages                                |

## Project Structure

```
Procela/
├── packages/
│   ├── backend/          # Express API server
│   │   ├── src/
│   │   ├── prisma/       # Database schema and migrations
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── frontend/         # React SPA
│       ├── src/
│       ├── public/
│       ├── package.json
│       └── tsconfig.json
├── docker-compose.yml    # Local development stack
├── tsconfig.base.json    # Shared TypeScript config
├── package.json          # Monorepo root
├── .env.example          # Environment variable template
└── CLAUDE.md             # Full architecture documentation
```

## Documentation

See [CLAUDE.md](./CLAUDE.md) for full architecture documentation, design decisions, and development guidelines.

## License

MIT
