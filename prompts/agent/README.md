# Agent Protocol Package Template

This directory is the template for an agent protocol package.

Runtime prompt loading uses only these canonical files:

- `SOUL.md`: agent selfhood. It defines the agent's name, identity, self-description, values, communication style, and behavioral boundaries.
- `USER.md`: user profile. It records stable user-side facts, preferences, habits, relationship expectations, and communication expectations.
- `AGENTS.md`: fixed update constitution. It defines how the model requests updates to the protocol package and must not be edited by model-generated updates.
- `EXTENSION.md`: extension capability summary. It records extra tools, external tool-call abilities, infrastructure, scraping/opencli/codex-style extensions, and other operating capabilities. It is not long-term memory.

`README.md`, `README.zh.cn.md`, and `config.jsonc` are package metadata and design references. They are not runtime prompt sections.
