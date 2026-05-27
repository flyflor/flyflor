# Browser URL Safety Floor

This note records the Hermes-aligned always-blocked browser URL floor for `browser.use` and the atomic `browser.cdp` sidecar.

The browser sidecars reject cloud metadata and link-local credential endpoints before they open or navigate a page:

- `metadata.google.internal`
- `metadata.goog`
- `169.254.0.0/16`
- `169.254.169.254`, `169.254.170.2`, `169.254.169.253`
- `100.100.100.200`
- `fd00:ec2::254`
- IPv4-mapped variants of those metadata addresses

This is intentionally narrower than a full private-network SSRF policy. Localhost, local files, and ordinary private-network URLs remain available to explicit high-privilege local browser workflows; the non-negotiable metadata floor stays blocked regardless of backend.

