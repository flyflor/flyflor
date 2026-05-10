# Docker dev workspace

This directory is reserved for Docker-backed config.

- `config/`: mounted into the container as `/root/.flyflor`.
- `config/config.jsonc`: container config file.
- `storage/qdrant/`: internal Qdrant index data for dev only.
- `storage/surrealdb/`: internal Crystal Memory graph/space data for dev only.

Qdrant and SurrealDB are part of Flyflor internal memory infrastructure. Docker dev exposes them only to the compose network; they are not published to the host.

Docker dev starts the gateway by default on host port `18790`.

```bash
bun run docker:templates
bun run build:binary:docker
docker compose up -d --force-recreate flyflor
curl http://127.0.0.1:18790/health
```

Interactive chat can still be opened inside the running container:

```bash
docker exec -it flyflor-dev flyflor
```

The container entrypoint copies the mounted Linux binary to local disk before
executing it, so the `flyflor` command remains usable even if Bun is unhappy
with running directly from the bind mount.

Equivalent helper scripts:

```bash
bun run docker:dev
bun run docker:chat
```
