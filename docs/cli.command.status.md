# Flyflor CLI Command Status

This document tracks the Hermes-compatible CLI command surface copied into Flyflor.

Status legend:

- `Done`: wired to real Flyflor behavior.
- `Skeleton`: command and basic interaction exist, but persistence or full runtime behavior is incomplete.
- `Placeholder`: command is registered and parses, but prints the Hermes-compatible placeholder.
- `Removed`: intentionally not exposed.

## Core Runtime

| Command        | Status  | Current behavior                 | Development notes                                                 |
| -------------- | ------- | -------------------------------- | ----------------------------------------------------------------- |
| `flyflor`      | Done    | Starts terminal chat by default. | Keep this as the default entry.                                   |
| `flyflor chat` | Done    | Starts terminal chat.            | Options are registered; most overrides still need runtime wiring. |
| `flyflor tui`  | Done    | Starts the current Ink TUI.      | TUI is intentionally minimal for now.                             |
| `flyflor cli`  | Removed | Returns unsupported command.     | User-facing built-in CLI menu was removed by design.              |

## Setup And Configuration

| Command                   | Status  | Current behavior                                               | Development notes                                                                                             |
| ------------------------- | ------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `flyflor init`            | Done    | Creates or updates JSONC config.                               | Supports provider, model, API key, base URL, protocol, gateway port, force, yes.                              |
| `flyflor setup`           | Partial | Runs model setup, then optional gateway setup.                 | Only `model` and `gateway` are valid setup sections until more modules have real config.                      |
| `flyflor setup model`     | Done    | Writes the active provider/model profile into JSONC config.    | Supports custom provider id, base URL `/v1` normalization, OpenAI/Anthropic compatibility, API key and model. |
| `flyflor setup gateway`   | Done    | Writes gateway/channel config through the channel wizard.      | WeChat uses iLink binding/config; default channels remain api/webhook/stdio.                                  |
| `flyflor model`           | Done    | Delegates to model config wizard and writes only model config. | Does not overwrite gateway or memory config.                                                                  |
| `flyflor config show`     | Done    | Prints config summary.                                         | Current summary is concise.                                                                                   |
| `flyflor config path`     | Done    | Prints config file path.                                       | Uses configured Flyflor home.                                                                                 |
| `flyflor config env-path` | Done    | Prints secrets file path.                                      | Name kept for Hermes compatibility; business config still does not use env vars.                              |
| `flyflor config check`    | Done    | Runs doctor/config validation summary.                         | Uses loaded JSONC config and gateway channel status snapshot.                                                 |

## Gateway And Channels

| Command                          | Status      | Current behavior                     | Development notes                                         |
| -------------------------------- | ----------- | ------------------------------------ | --------------------------------------------------------- |
| `flyflor gateway run`            | Done        | Starts gateway in foreground.        | Existing gateway runtime is used.                         |
| `flyflor gateway setup`          | Skeleton    | Opens platform selection wizard.     | Needs full per-channel setup.                             |
| `flyflor gateway start`          | Placeholder | Prints not implemented.              | Needs service/background process strategy.                |
| `flyflor gateway stop`           | Placeholder | Prints not implemented.              | Needs service/background process strategy.                |
| `flyflor gateway restart`        | Placeholder | Prints not implemented.              | Needs service/background process strategy.                |
| `flyflor gateway status`         | Placeholder | Prints not implemented.              | Should connect to gateway status snapshot/service status. |
| `flyflor gateway install`        | Placeholder | Prints not implemented.              | Needs install story for one-click distribution.           |
| `flyflor gateway uninstall`      | Placeholder | Prints not implemented.              | Needs uninstall story.                                    |
| `flyflor gateway list`           | Placeholder | Prints not implemented.              | Needs profile-aware gateway registry.                     |
| `flyflor gateway migrate-legacy` | Placeholder | Prints not implemented.              | Needs legacy unit detection/removal.                      |
| `flyflor channels`               | Done        | Prints channel adapter status table. | Uses current gateway/channel snapshot.                    |
| `flyflor whatsapp`               | Placeholder | Prints not implemented.              | Needs channel-specific setup.                             |
| `flyflor slack manifest`         | Placeholder | Prints not implemented.              | Needs Slack manifest generator.                           |

## Status And Diagnostics

| Command                | Status      | Current behavior            | Development notes                                        |
| ---------------------- | ----------- | --------------------------- | -------------------------------------------------------- |
| `flyflor status`       | Done        | Prints runtime status.      | Options are registered; deep/all detail needs expansion. |
| `flyflor doctor`       | Done        | Prints current diagnostics. | `--fix` is registered but not implemented.               |
| `flyflor dump`         | Placeholder | Prints not implemented.     | Needs setup/config dump with redaction.                  |
| `flyflor debug share`  | Placeholder | Prints not implemented.     | Needs local report generation/upload strategy.           |
| `flyflor debug delete` | Placeholder | Prints not implemented.     | Depends on debug upload implementation.                  |
| `flyflor logs`         | Placeholder | Prints not implemented.     | Needs log store/tail/filter integration.                 |
| `flyflor insights`     | Placeholder | Prints not implemented.     | Needs usage analytics implementation.                    |

## Memory And Sessions

| Command                   | Status      | Current behavior                                 | Development notes                                           |
| ------------------------- | ----------- | ------------------------------------------------ | ----------------------------------------------------------- |
| `flyflor memory status`   | Done        | Prints memory/crystal/storage summary.           | Current output is local state only.                         |
| `flyflor memory setup`    | Skeleton    | Opens provider selection wizard.                 | Needs real provider persistence and SurrealDB/crystal flow. |
| `flyflor memory reset`    | Skeleton    | Asks confirmation when needed, then placeholder. | Needs targeted reset implementation.                        |
| `flyflor memory off`      | Placeholder | Prints not implemented.                          | Needs config update.                                        |
| `flyflor sessions list`   | Done        | Prints recent blackboard sessions.               | Limit/source options are registered but not wired.          |
| `flyflor sessions export` | Placeholder | Prints not implemented.                          | Needs export format.                                        |
| `flyflor sessions delete` | Placeholder | Prints not implemented.                          | Needs deletion behavior and confirmation.                   |
| `flyflor sessions prune`  | Placeholder | Prints not implemented.                          | Needs retention policy.                                     |
| `flyflor sessions stats`  | Placeholder | Prints not implemented.                          | Needs session store statistics.                             |
| `flyflor sessions rename` | Placeholder | Prints not implemented.                          | Needs metadata update.                                      |
| `flyflor sessions browse` | Placeholder | Prints not implemented.                          | Needs interactive picker.                                   |

## Tools, Skills, MCP, Plugins

| Command                                                                                                 | Status      | Current behavior                 | Development notes                                   |
| ------------------------------------------------------------------------------------------------------- | ----------- | -------------------------------- | --------------------------------------------------- |
| `flyflor tools`                                                                                         | Skeleton    | Opens tool configuration wizard. | Needs persistence and per-platform toolset updates. |
| `flyflor tools list`                                                                                    | Placeholder | Prints not implemented.          | Needs tool registry summary.                        |
| `flyflor tools enable`                                                                                  | Placeholder | Prints not implemented.          | Needs config mutation.                              |
| `flyflor tools disable`                                                                                 | Placeholder | Prints not implemented.          | Needs config mutation.                              |
| `flyflor skills config`                                                                                 | Skeleton    | Opens skill config wizard.       | Needs real skill toggles.                           |
| `flyflor skills browse`                                                                                 | Placeholder | Prints not implemented.          | Needs skill registry.                               |
| `flyflor skills search`                                                                                 | Placeholder | Prints not implemented.          | Needs skill registry search.                        |
| `flyflor skills install`                                                                                | Placeholder | Prints not implemented.          | Needs installer and trust checks.                   |
| `flyflor skills inspect`                                                                                | Placeholder | Prints not implemented.          | Needs preview renderer.                             |
| `flyflor skills list`                                                                                   | Placeholder | Prints not implemented.          | Needs installed skill index.                        |
| `flyflor skills check`                                                                                  | Placeholder | Prints not implemented.          | Needs update checks.                                |
| `flyflor skills update`                                                                                 | Placeholder | Prints not implemented.          | Needs update flow.                                  |
| `flyflor skills audit`                                                                                  | Placeholder | Prints not implemented.          | Needs local audit flow.                             |
| `flyflor skills uninstall`                                                                              | Placeholder | Prints not implemented.          | Needs uninstall flow.                               |
| `flyflor skills reset`                                                                                  | Placeholder | Prints not implemented.          | Needs bundled skill restore.                        |
| `flyflor skills publish`                                                                                | Placeholder | Prints not implemented.          | Needs publishing strategy.                          |
| `flyflor skills snapshot export/import`                                                                 | Placeholder | Prints not implemented.          | Needs snapshot format.                              |
| `flyflor skills tap list/add/remove`                                                                    | Placeholder | Prints not implemented.          | Needs tap registry.                                 |
| `flyflor mcp serve`                                                                                     | Placeholder | Prints not implemented.          | Needs MCP server runtime.                           |
| `flyflor mcp add`                                                                                       | Placeholder | Prints not implemented.          | Needs MCP config writer.                            |
| `flyflor mcp remove`                                                                                    | Placeholder | Prints not implemented.          | Alias `rm` registered.                              |
| `flyflor mcp list`                                                                                      | Placeholder | Prints not implemented.          | Alias `ls` registered.                              |
| `flyflor mcp test`                                                                                      | Placeholder | Prints not implemented.          | Needs connectivity check.                           |
| `flyflor mcp configure`                                                                                 | Placeholder | Prints not implemented.          | Alias `config` registered.                          |
| `flyflor mcp login`                                                                                     | Placeholder | Prints not implemented.          | Needs OAuth flow.                                   |
| `flyflor plugins install`                                                                               | Placeholder | Prints not implemented.          | Needs plugin installer.                             |
| `flyflor plugins update`                                                                                | Placeholder | Prints not implemented.          | Needs update flow.                                  |
| `flyflor plugins remove`                                                                                | Placeholder | Prints not implemented.          | Aliases `rm`, `uninstall` registered.               |
| `flyflor plugins list`                                                                                  | Placeholder | Prints not implemented.          | Alias `ls` registered.                              |
| `flyflor plugins enable`                                                                                | Placeholder | Prints not implemented.          | Needs plugin config writer.                         |
| `flyflor plugins disable`                                                                               | Placeholder | Prints not implemented.          | Needs plugin config writer.                         |
| `flyflor curator status/run/pause/resume/pin/unpin/restore/list-archived/archive/prune/backup/rollback` | Placeholder | Prints not implemented.          | Needs background skill maintenance design.          |

## Auth And Providers

| Command                   | Status      | Current behavior        | Development notes                    |
| ------------------------- | ----------- | ----------------------- | ------------------------------------ |
| `flyflor login`           | Placeholder | Prints not implemented. | Needs provider auth flow.            |
| `flyflor logout`          | Placeholder | Prints not implemented. | Needs credential clearing.           |
| `flyflor auth add`        | Placeholder | Prints not implemented. | Needs credential pool.               |
| `flyflor auth list`       | Placeholder | Prints not implemented. | Needs credential pool.               |
| `flyflor auth remove`     | Placeholder | Prints not implemented. | Needs credential pool.               |
| `flyflor auth reset`      | Placeholder | Prints not implemented. | Needs exhaustion-state reset.        |
| `flyflor auth status`     | Placeholder | Prints not implemented. | Needs provider credential status.    |
| `flyflor auth logout`     | Placeholder | Prints not implemented. | Needs provider credential clearing.  |
| `flyflor auth spotify`    | Placeholder | Prints not implemented. | Needs Spotify PKCE flow if retained. |
| `flyflor fallback list`   | Placeholder | Prints not implemented. | Alias `ls` registered.               |
| `flyflor fallback add`    | Placeholder | Prints not implemented. | Needs fallback chain config.         |
| `flyflor fallback remove` | Placeholder | Prints not implemented. | Alias `rm` registered.               |
| `flyflor fallback clear`  | Placeholder | Prints not implemented. | Needs fallback chain config.         |

## Automation And Collaboration

| Command                                                                                                                                                                                                                                                              | Status      | Current behavior        | Development notes                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ----------------------- | --------------------------------------------- |
| `flyflor cron list/create/edit/pause/resume/run/remove/status/tick`                                                                                                                                                                                                  | Placeholder | Prints not implemented. | Aliases copied where present.                 |
| `flyflor webhook subscribe/list/remove/test`                                                                                                                                                                                                                         | Placeholder | Prints not implemented. | Aliases copied where present.                 |
| `flyflor kanban init`                                                                                                                                                                                                                                                | Placeholder | Prints not implemented. | Needs board store.                            |
| `flyflor kanban boards list/create/rm/switch/show/rename`                                                                                                                                                                                                            | Placeholder | Prints not implemented. | Aliases copied where present.                 |
| `flyflor kanban create/list/show/assign/reclaim/reassign/diagnostics/link/unlink/claim/comment/complete/edit/block/unblock/archive/tail/dispatch/daemon/watch/stats/notify-subscribe/notify-list/notify-unsubscribe/log/runs/heartbeat/assignees/context/specify/gc` | Placeholder | Prints not implemented. | Large Hermes surface copied for later parity. |
| `flyflor hooks list/test/revoke/doctor`                                                                                                                                                                                                                              | Placeholder | Prints not implemented. | Aliases copied where present.                 |
| `flyflor pairing list/approve/revoke/clear-pending`                                                                                                                                                                                                                  | Placeholder | Prints not implemented. | Needs gateway user pairing store.             |

## Lifecycle And Distribution

| Command                                                                                      | Status      | Current behavior        | Development notes                           |
| -------------------------------------------------------------------------------------------- | ----------- | ----------------------- | ------------------------------------------- |
| `flyflor version`                                                                            | Done        | Prints version string.  | Currently hard-coded as `0.1.0`.            |
| `flyflor backup`                                                                             | Placeholder | Prints not implemented. | Needs backup archive implementation.        |
| `flyflor import`                                                                             | Placeholder | Prints not implemented. | Needs restore implementation.               |
| `flyflor checkpoints status/list/prune/clear/clear-legacy`                                   | Placeholder | Prints not implemented. | Needs checkpoint store first.               |
| `flyflor claw migrate/cleanup`                                                               | Placeholder | Prints not implemented. | Needs OpenClaw migration mapping.           |
| `flyflor update`                                                                             | Placeholder | Prints not implemented. | Needs one-click installation/update design. |
| `flyflor uninstall`                                                                          | Placeholder | Prints not implemented. | Needs uninstall design.                     |
| `flyflor acp`                                                                                | Placeholder | Prints not implemented. | Needs ACP server runtime.                   |
| `flyflor profile list/use/create/delete/show/alias/rename/export/import/install/update/info` | Placeholder | Prints not implemented. | Needs profile architecture.                 |
| `flyflor completion`                                                                         | Placeholder | Prints not implemented. | Needs shell completion generator.           |
| `flyflor dashboard`                                                                          | Placeholder | Prints not implemented. | Needs dashboard server.                     |

## Verification Commands

Current verification baseline:

```bash
bun run check
bun run format:check
bun test tests/command.boundaries.test.ts
bun run build:binary:docker
docker compose up -d --force-recreate flyflor
docker exec flyflor-dev flyflor --help
docker exec flyflor-dev flyflor cli
docker exec flyflor-dev flyflor fallback ls
printf '/exit\n' | docker exec -i flyflor-dev flyflor
```

Expected smoke results:

- `flyflor --help` shows the Hermes-compatible command surface.
- `flyflor` starts chat mode.
- `flyflor cli` is rejected because the built-in interactive CLI was removed.
- Placeholder commands parse and exit successfully without starting runtime.
