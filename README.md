# jikan-rest-portainer

Self-hosted [Jikan](https://jikan.moe/) API stack (jikan-rest + MongoDB + Redis + Typesense),
built to feed [aiometadata](https://github.com/cedya77/aiometadata) via `JIKAN_API_BASE`,
now that the public Jikan API is shutting down (brownout Sep 1 2026, off Oct 1 2026).

Deployed as a Portainer **Git repository** stack so `RepositoryQuery.php` and `mongo-init.js`
land on the host automatically — Portainer's other build methods (Web editor, Upload) only
take a single compose file, no companion files.

This is an adaptation of the official self-hosting guide:
https://github.com/cedya77/aiometadata/blob/dev/docs/self-hosted-jikan.md

**What's different from the upstream guide:**
- Docker secrets (file-based) → plain environment variables, since this deploys without
  host shell access to create secret files.
- `${DOCKER_DATA_DIR}` bind mounts → named Docker volumes, so Portainer manages storage
  without needing a host path.

## Deploy

1. Create an external Docker network so this stack and `aiometadata` can reach each other:
   Portainer → Networks → Add network → `jikan-shared` (bridge driver).
2. Portainer → Stacks → Add stack → Build method: **Repository**. Point it at this repo,
   compose path `compose.yaml`.
3. Set these environment variables on the stack:
   - `JIKAN_DB_USERNAME`, `JIKAN_DB_PASSWORD` — app-level Mongo user
   - `JIKAN_DB_ADMIN_USERNAME`, `JIKAN_DB_ADMIN_PASSWORD` — Mongo root user
   - `JIKAN_REDIS_PASSWORD`
   - `JIKAN_TYPESENSE_API_KEY`
4. Deploy.
5. On the `aiometadata` stack, join the same `jikan-shared` network and set
   `JIKAN_API_BASE=http://jikan_rest:8080/v4`, then update that stack.
6. Seed the catalog once, via Portainer → Containers → `jikan_rest` → Console:
