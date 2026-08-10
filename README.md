# jikan-rest-portainer

Self-hosted [Jikan](https://jikan.moe/) API stack (jikan-rest + MongoDB + Redis + Typesense),
built to feed [aiometadata](https://github.com/cedya77/aiometadata) via `JIKAN_API_BASE`,
now that the public Jikan API is shutting down (brownout Sep 1 2026, off Oct 1 2026).

Deployed as a Portainer **Git repository** stack so `mongo-init.js` lands on the host
automatically — Portainer's other build methods (Web editor, Upload) only take a single
compose file, no companion files.

This is an adaptation of the official self-hosting guide:
<https://github.com/cedya77/aiometadata/blob/dev/docs/self-hosted-jikan.md>

**What's different from the upstream guide:**

- Docker secrets (file-based) → plain environment variables, since this deploys without
  host shell access to create secret files.
- `${DOCKER_DATA_DIR}` bind mounts → named Docker volumes, so Portainer manages storage
  without needing a host path.
- **No `RepositoryQuery.php` bind mount.** On this Portainer/Docker setup, bind-mounting
  a single file that doesn't already exist at the resolved host path causes Docker to
  silently create an empty *directory* there instead, which then fails container startup
  with `not a directory: Are you trying to mount a directory onto a file (or vice-versa)?`.
  This happened reproducibly across multiple fresh clones, so the patch is applied by hand
  via console instead (see below) rather than mounted at deploy time.

## Repo contents

```
jikan-rest-portainer/
├── README.md
├── compose.yaml
├── RepositoryQuery.php   # reference copy — NOT mounted, see "Applying the patch" below
└── mongo-init.js         # mounted once at first Mongo boot
```

## Deploy

1. Create an external Docker network so this stack and `aiometadata` can reach each other:
   Portainer → Networks → Add network → `jikan-shared` (bridge driver, leave subnet/gateway
   blank, leave "Isolated network" and "Enable manual container attachment" off).
2. Portainer → Stacks → Add stack → Build method: **Repository**. Point it at this repo,
   branch `main`, compose path `compose.yaml`.
3. Set these environment variables on the stack:
   - `JIKAN_DB_USERNAME`, `JIKAN_DB_PASSWORD` — app-level Mongo user
   - `JIKAN_DB_ADMIN_USERNAME`, `JIKAN_DB_ADMIN_PASSWORD` — Mongo root user
   - `JIKAN_REDIS_PASSWORD`
   - `JIKAN_TYPESENSE_API_KEY`
   (Usernames are just labels; generate long random values for the passwords/keys.)
4. Deploy the stack.
5. Confirm all four containers reach `healthy`/`running` in Containers — `jikan_rest`
   included, since nothing blocks it from starting anymore.

## Seeding Mongo (once per fresh volume)

`mongo-init.js` only runs once, when Mongo's data directory is empty. Rather than bind-mount
it (same phantom-directory risk as `RepositoryQuery.php`), run it by hand the first time:

Containers → `jikan_mongo` → Console → connect with `/bin/sh`, then:

```sh
mongosh "mongodb://<JIKAN_DB_ADMIN_USERNAME>:<JIKAN_DB_ADMIN_PASSWORD>@localhost/admin"
```

Paste in the contents of `mongo-init.js` from this repo, substituting your real
`JIKAN_DB_USERNAME` / `JIKAN_DB_PASSWORD` values in place of `process.env.*` (there's no
env access in an interactive session). It should finish with:

```
anime indexes created: 29
```

If it prints `1` instead, the script didn't fully run — check for typos and retry.

## Applying the `RepositoryQuery.php` patch

This patches a v4-specific bug in jikan-rest's memoized query builder. It's applied
directly inside the running container rather than bind-mounted:

1. Wait for `jikan_rest` to be `healthy`.
2. Containers → `jikan_rest` → Console → `/bin/sh`, then:
   ```sh
   cat > /app/app/Support/RepositoryQuery.php << 'EOF'
   <?php

   namespace App\Support;

   use App\Contracts\RepositoryQuery as RepositoryQueryContract;
   use Illuminate\Contracts\Database\Query\Builder;
   use Illuminate\Support\Collection;
   use Laravel\Scout\Builder as ScoutBuilder;

   class RepositoryQuery extends RepositoryQueryBase implements RepositoryQueryContract
   {
       public function filter(Collection $params): Builder|ScoutBuilder
       {
           return $this->queryable(true)->filter($params);
       }

       public function search(string $keywords, ?\Closure $callback = null): ScoutBuilder
       {
           return $this->searchable($keywords, $callback, true);
       }

       public function where(string $key, mixed $value): Builder
       {
           return $this->queryable(true)->where($key, $value);
       }
   }
   EOF
   ```
3. Verify with `cat /app/app/Support/RepositoryQuery.php` — check it matches exactly,
   since pasting into some consoles can garble multi-line input.
3. Exit the console, then Containers → `jikan_rest` → **Restart** (not recreate — this
   keeps the container's writable layer so the patched file survives).

⚠️ **This patch does not survive a container recreate** — only a Restart. Any full stack
redeploy, GitOps-triggered update, or "Re-pull image" recreates the container from the
image fresh, reverting to the stock file. **Re-run step 2 above any time the stack is
redeployed**, including after a future jikan-rest v5 upgrade (check the upstream guide
first — the patch may no longer be needed by then, the way an older Typesense patch in
that guide was retired once fixed upstream).

## Connecting `aiometadata`

On the `aiometadata` stack's compose file:

1. Add a top-level `networks:` block declaring `jikan-shared` as external, and keep
   `aiometadata`'s existing implicit network explicit too if `aiometadata_redis` isn't
   also joining `jikan-shared` (otherwise you'll break the link between `aiometadata`
   and its own Redis):
   ```yaml
   networks:
     default:
     jikan-shared:
       external: true
   ```
2. Under the `aiometadata` service, add:
   ```yaml
   networks:
     - default
     - jikan-shared
   ```
3. Set `JIKAN_API_BASE=http://jikan_rest:8080/v4` — if `aiometadata` uses `env_file:
   - stack.env` (as in the default aiometadata compose), add the line to `stack.env`
   instead of an inline `environment:` block. If deployed via Portainer's Web
   editor/Upload, `stack.env` is managed through Portainer's "Environment variables"
   panel; if deployed via Repository, edit the committed `stack.env` file directly.
4. Update the stack.

## Seeding the catalog

Once `jikan_rest` is healthy, patched, and `aiometadata` can reach it — Containers →
`jikan_rest` → Console:

```sh
php artisan indexer:genres
php artisan indexer:producers
php artisan indexer:anime-current-season
php artisan indexer:anime-schedule
```

For the full catalog (runs for hours), run it detached since there's no `-d` flag
equivalent from a console session:

```sh
nohup php artisan indexer:anime --delay=1 > /tmp/indexer-anime.log 2>&1 &
```

Check progress any time with `tail -f /tmp/indexer-anime.log` in a fresh console session.

## Keeping it updated

Stack → **GitOps updates**: enable Polling or Webhook, and turn on **Re-pull image** so a
triggered update also pulls a new `jikan-rest:latest` (e.g. when v5 ships), not just changes
pushed to this repo.

Remember: any redeploy or image re-pull recreates `jikan_rest`'s container, which wipes the
`RepositoryQuery.php` patch. Re-apply it via console (see above) after every redeploy.
