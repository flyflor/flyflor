# Docker dev workspace

This directory is reserved for Docker-backed config.

- `config/`: mounted into the container as `/root/.flyflor`.
- `config/config.jsonc`: container config file.
- `storage/qdrant/`: internal Qdrant index data for dev only.

Qdrant is part of Flyflor internal memory infrastructure. Docker dev exposes it only to the compose network; it is not published to the host.

Docker chat mode:

```bash
bun run build:binary:linux-x64
docker compose up -d flyflor
docker exec -it flyflor-dev flyflor
```

Equivalent npm script:

```bash
bun run docker:chat
```

Gateway mode can be started by overriding the command:

```bash
docker compose run --rm flyflor flyflor gateway
```
