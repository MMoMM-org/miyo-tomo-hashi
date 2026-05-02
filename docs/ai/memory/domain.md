# Domain Memory

<!-- 2026-05-02 -->
- **Vault filename sanitization** — Obsidian and Kado reject `:` in filenames, but external recording apps (and other sources) emit timestamps containing `:`. Any code path in Hashi that writes a file into the vault (instruction-set executor, future ferry features, hook outputs) must sanitize incoming filenames by replacing `:` with `-` before the write. Same rule likely applies to other reserved chars (`\ / : * ? " < > |` on Windows; `:` and `/` on macOS/Linux paths) — start with `:` since that is the observed real-world case.
