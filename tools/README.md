# Flyflor Tools

`tools/` is the project-local external tool surface. It is intentionally kept
next to `src/` so development, review and runtime discovery use the same
relative boundary.

## Layout

```text
tools/
  external.tools.jsonc
  packages/
  README.md
  init.sh
  init.ps1
  init.ts
```

- `external.tools.jsonc` is the registry loaded by the kernel.
- `packages/` is the isolated local payload area for external tool packages.
- `init.sh` initializes the registry on macOS/Linux.
- `init.ps1` initializes the registry on Windows.
- `init.ts` is a developer helper with the same output contract.

## Runtime Contract

The registry uses relative commands by default:

```jsonc
{
  "command": "./tools/packages/search-web/bin/flyflor",
  "args": ["xtool-sidecar", "web.search"]
}
```

This keeps the project portable. The compiled kernel dispatches
`xtool-sidecar <id>` internally, so users do not need a Bun runtime just to run
the bundled tool bridge. The initializer copies the project binary into each
package's `bin/` directory, and the registry loads those package-local binaries.

## Packages

`tools/packages/` is for optional local packages and delegates. It stays
ignored by git because package payloads are machine-specific. If a package is
needed at runtime, register it explicitly in `external.tools.jsonc`; the kernel
must not import files from `tools/packages/` directly.
