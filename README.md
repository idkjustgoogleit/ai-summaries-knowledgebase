# AI Summaries Library

**Privacy focused Personal Knowledge Base and Summarization tool with LLM integration on Edge Devices**

---

## Overview

The AI Summaries Library is a web application for processing and summarizing articles, YouTube videos, and custom content using (of course) a LLM. 

Features include content ingestion and talking about it with the LLM, AI-powered summarization, multi-summary chat, favorites, playlist management, and local OnDevice LLM inference via WebGPU. 

**Key Features:** LLM summaries, chat arena with cloud/local modes, OIDC authentication (PKCE hardening), YouTube processing with proxy support, playlist sync, and PWA support.

**Tech Stack:** React 18, Tailwind CSS, Node.js/Express, PostgreSQL, WebLLM.

---

## Features

### Authentication
OIDC-only authentication with PKCE, State Parameter, and Nonce hardening. PostgreSQL session storage with comprehensive audit logging (29+ audit points). Role-based access control (Admin/User) with dynamic rate limiting.

### Main Dashboard
Responsive grid layout (1-4 columns) with multi-dimensional filtering by search, channels, platforms, and tags. Multi-select for chat arena, favorites system, and user filtering modes.

### Chat Arena
Multi-source chat about videos, websites, and custom summaries with real-time streaming responses. Toggle between Cloud (OpenAI) and Local (WebLLM) modes. Pre-defined prompts and chat export.

### Content Processing
YouTube processing with hybrid Python/Node.js architecture, proxy rotation (ProxyScrape + paid), and playlist synchronization. Custom content and website summarization with status tracking.

### Admin Panel
Configuration management, content management across all types, status updates, search and filtering capabilities.

### Workers
Background processing with configurable intervals for import checking, summary processing, and playlist syncing. 

#### Status flow: 

1. `NEW_YTDLP` - Initial status when grabbed
2. `PENDING_YTDLP` - Queued for yt-dlp processing
3. `NEW` - Ready for summarization
4. `PENDING` - Queued for summarization
5. `DONE` - Successfully summarized
6. `FAILED` - Processing failed


---

## **Getting Started**

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Docker (for yt-dlp service)
- OpenAI API key (or compatible API)

## Installation


### 1. Docker Deployment

The application uses individual containers (WEB and WORKER modes) rather than docker-compose.

#### Use docker-compose.yaml example.

**Note:** Nginx reverse proxy configuration is deployment-specific and not included in this repository. Refer to your deployment documentation for proxy setup. Or use my example :)

### 2. Database Deployment

Create a Postgres DB with the create database.sql file.

### 3. OIDC Deployment

Requires an OIDC provider (e.g., Authelia). Configure OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET, and OIDC_REDIRECT_URI environment variables.

### 4. Configuration

#### Via admin backend web-interface and via docker .env vars.

### 5. LLM of Choice

Via the admin backend you will have the option to use 3 types of OpenAI compatible endpoints:
- PublicAi: As the name suggests a free llm provider -> e.g. Gemini Free
- MyCloud: point this to your own OpenAi compatible Endpoint (llama.cpp) -> Qwen3.5-0.8B-GGUF
- LocalAi: On device LLM inference via WebGPU for in Chrome and FireFox Nightly -> Qwen2.5-0.5B-Instruct-q4f32_1-MLC

For Summarizing LLM's you will have another 2 optiones plus failover possibilities:
- Primary -> local llama.cpp (Qwen3.5 4B)
- Secondary -> a free llm provider -> Gemini Free

#### Edge Device usage

In the admin panel you can setup different Content Chunking strategies to work with limited Context Windows and rate limiting.

---

## **Architecture**

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend Layer                           │
├─────────────────────────────────────────────────────────────┤
│  React Components (frontend/src/components/)                │
│  ├── MainPage.jsx          - Main dashboard                 │
│  ├── ArenaPage.jsx         - Chat arena                     │
│  ├── RequestPage.jsx       - Content request               │
│  ├── AdminPage.jsx         - Admin interface               │
│  └── SummaryDetailsPage.jsx - Summary details view          │
├─────────────────────────────────────────────────────────────┤
│  React Hooks (frontend/src/hooks/)                          │
│  ├── useSummaries.js     - Summary data management          │
│  ├── useFavorites.js     - Favorites system                │
│  ├── useChat.js          - Chat arena logic                │
│  └── useAuth.js          - Authentication state            │
├─────────────────────────────────────────────────────────────┤
│  Context Providers (frontend/src/context/)                  │
│  └── AuthContext.jsx     - Global auth state               │
├─────────────────────────────────────────────────────────────┤
│  Utilities (frontend/src/utils/)                            │
│  ├── api.js              - API client wrapper               │
│  └── helpers.js          - Helper functions                │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    Backend Layer                            │
├─────────────────────────────────────────────────────────────┤
│  Express.js Server (backend/server.js)                      │
│  ├── Routes (backend/routes/)                               │
│  │   ├── summaries.js          - Summary endpoints          │
│  │   ├── chat.js               - Chat API                  │
│  │   ├── auth.js               - OIDC authentication       │
│  │   ├── adminConfig.js        - Admin configuration       │
│  │   ├── favorites.js          - Favorites management      │
│  │   └── playlists.js          - Playlist management       │
│  ├── Middleware (backend/middleware/)                       │
│  │   ├── apiAuthMiddleware.js  - OIDC session verification  │
│  │   ├── checkAdminRights.js   - Admin role check          │
│  │   └── security.js           - Security headers, rate limit│
│  ├── Auth (backend/auth/)                                  │
│  │   ├── oidc/                 - OIDC implementation        │
│  │   └── shared/               - Session management, RBAC   │
│  └── Utils (backend/utils/)                                 │
│      ├── debugUtils.js     - Logging control               │
│      └── userUtils.js      - User detection                │
├─────────────────────────────────────────────────────────────┤
│  Workers (backend/workers/)                                 │
│  ├── summarizerWorker.js       - AI summarization           │
│  ├── ytDlpWorker.js            - YouTube job orchestration  │
│  ├── playlistWorker.js         - Playlist sync              │
│  ├── customSummarizerWorker.js - Custom content            │
│  ├── yt-dlp-provider.py        - Python transcript extractor│
│  └── proxy_manager.py          - Proxy rotation system      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    External Services                        │
├─────────────────────────────────────────────────────────────┤
│  PostgreSQL Database                                        │
│  ├── OpenAI API (or compatible)                             │
│  ├── Authelia (OIDC Provider)                               │
│  ├── YouTube (via yt-dlp + proxy rotation)                  │
│  └── ProxyScrape / Paid Proxies                             │
└─────────────────────────────────────────────────────────────┘
```

---

## **Tech Stack**

### Frontend
- **React 18.2.0** - UI framework with hooks
- **Vite 4.4.9** - Build tool and dev server
- **Tailwind CSS 3.3.3** - Utility-first styling
- **React Router v6.15.0** - Client-side routing
- **@mlc-ai/web-llm** - Local LLM inference (WebGPU)

### Backend
- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **PostgreSQL** - Database with pg client
- **node-cron** - Background task scheduling
- **node-oidc-validator** - OIDC token validation

### Infrastructure
- **Docker** - Containerization (individual containers, WEB and WORKER modes)
- **Authelia** - OIDC identity provider (deployment-specific)
- **Nginx** - Reverse proxy (deployment-specific)

---

---

## Contributing

This is a personal project, but contributions and ideas are welcome.

---

## **License**

IT IS FREE MY FRIENDS DO WHATEVER

---

## **Links**

- **GitHub Repository:** https://github.com/idkjustgoogleit/ai-summaries-library

