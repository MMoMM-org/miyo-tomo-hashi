# [0.4.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.3.1...0.4.0) (2026-05-27)


### Bug Fixes

* **hooks:** close disclosure modal after user decision ([0d376b3](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/0d376b373dff13295b4d11b0a5a841788c4c360d))
* **hooks:** reject .js hook files — Electron requires .cjs for CommonJS ([373fde0](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/373fde0cbe3b4040bb96191b172c3587d61b0cb6))
* **schema:** align TypeScript type for supporting_items with schema ([e4e228b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/e4e228b8e58d13e53918325c1a249b2ffe9ff613))
* **schema:** widen create_moc.supporting_items to accept string or array ([cf855d8](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/cf855d81ccaacc763e08c6f930dfd12f1cb3575e))


### Features

* **actions:** strip tomo: frontmatter after move_note and create_moc ([895c0ac](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/895c0acb804a9c28498e91aa613efe17f94dd6cf))
* **hooks:** pre-approve all hook disclosures before execution starts ([4e43d4b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/4e43d4bd4cc3f421605e769e0d58a32eccf6855f))

## [0.3.1](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.3.0...0.3.1) (2026-05-14)


### Bug Fixes

* **lint:** resolve obsidianmd 0.3.0 findings ([30d575c](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/30d575c180858489064e08f11950e6fe869c3c1f)), closes [#8](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/8)
* **lint:** wire validate-manifest and reformulate description ([1caf814](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/1caf814fae6ebd64e45c67d93c5e028f89d0c347))

# [0.3.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.2.0...0.3.0) (2026-05-08)


### Features

* **settings:** manifest-driven header with inlined hanko ([2ccc257](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/2ccc257a2ee355ac216ebf5785e7cd2c505b0ae8))

# [0.2.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.1.0...0.2.0) (2026-05-07)


### Bug Fixes

* 13 LOW polish — L1-L5, L7-L11, L13-L15 ([f3571fd](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/f3571fd00492b3bb60d70f928ef7d3050fa9489a))
* **a11y:** zoom buttons aria-pressed + picker aria-live — H5, H6 ([5e7ba1d](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/5e7ba1dd144dff12ef9650136e5a8485604d5b8e))
* **connection:** timeout + stream cleanup + persist hardening — M2, M3, M5 ([ae0090b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/ae0090bc93d90f0f882be8aa611065e88b022dbe))
* **perf+a11y:** single-chunk fast path + a11y polish — M11, M12, M13, M14 ([e094066](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/e094066feb5a8b628e02e747f4deadffb8b42747))
* **round-2:** LOW batch — connection cleanup, executor, a11y, CSS, docs ([ed9d8db](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/ed9d8db21258eefc249fb0d7fa1a3959793d815f))
* **round-2:** MEDIUM batch — settings live-read + reconnect + peer-sync ([db0acde](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/db0acdeeeedd3b550f9726bbc56afd2652b965e3))
* **round-2:** perf, a11y, security, comments + Kokoro run-log handoff ([329d80f](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/329d80f2a88388170345379611823815d7d8548b))
* **spec-001:** chat-view focus + PRIVACY.md — C1, H1 ([533ef9c](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/533ef9c05f6d2b28127b1912651a26fc28c39d0d))
* **spec-001:** cross-device auto-attach Notice + image-verification ADR — M6, M7 ([2e5194a](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/2e5194aed6a7f38ac673d8b6d9a6dc25140f5ac6))
* **spec-001:** live-test assertion + dialAttach CI coverage — H2, H3 ([c23826f](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/c23826fee8316b66c0acc0f2486dcc9b77401ee0))


### Features

* **executor:** create_moc destination-collision guard (F-43) ([40b7383](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/40b7383acabb7f5dc49fb37f0f7eb51f188752d1))
