## [0.8.1](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.8.0...0.8.1) (2026-06-09)


### Bug Fixes

* **executor:** graduate skipped-already actions, not just applied ([4be50e6](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/4be50e66d84662689126f012f2d19678548e6eca))
* **runlog:** write the run log once at finalize, drop start() placeholder ([e454c85](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/e454c855036a3934048b8a86acb1cfbd8663154d))

# [0.8.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.7.4...0.8.0) (2026-06-08)


### Bug Fixes

* **executor:** surface failed actions at console.warn, not debug ([dfa3464](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/dfa34646c7d9ec349a69b8d2b78b7e1117361eed))
* **hooks:** gate hook console traces behind debugLogging, not delete them ([825b9de](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/825b9de82c476f41a4081c7376d27e679bb9a1e4)), closes [#52](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/52) [#52](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/52) [#52](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/52)


### Features

* **executor:** debug-gated per-action execution logging ([8cce39d](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/8cce39d7b812f36d4f57e0e81afbbafac0417fe1))

## [0.7.4](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.7.3...0.7.4) (2026-06-08)


### Bug Fixes

* **executor:** crash-safe run log + resolve hooks once per run ([61bcd20](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/61bcd2026491c106aa3fd9a4cb6eaa567e17d775)), closes [#52](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/52)

## [0.7.3](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.7.2...0.7.3) (2026-06-08)


### Bug Fixes

* **add-relationship:** match and preserve callout list-item fields (`> - up::`) ([9fafac2](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/9fafac2ea3da68e6d819326ee88198b7c137d1b6)), closes [#51](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/51)

## [0.7.2](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.7.1...0.7.2) (2026-06-06)


### Bug Fixes

* **session-view:** send LF on Shift+Enter so newlines don't submit ([52b73e7](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/52b73e79363ee155515983d1f8baf2ae9c64ad2e))

## [0.7.1](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.7.0...0.7.1) (2026-06-03)


### Bug Fixes

* **deps:** bump vitest to 4.1.8 to clear critical UI-server CVE ([117fa2b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/117fa2bbb126cc9456d224d410224e4838184382))

# [0.7.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.6.2...0.7.0) (2026-06-01)


### Features

* **settings:** folder autocomplete for Tomo inbox + hooks directory paths ([86e91d1](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/86e91d1a7be1d2f9cace65cf237ea56f0f3f22c0))

## [0.6.2](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.6.1...0.6.2) (2026-05-31)


### Bug Fixes

* **css:** carry status-bar state cue on border-bottom, not text-decoration ([e8bd095](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/e8bd095247b3cf4c62b7409ad54025ade78866f1))

## [0.6.1](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.6.0...0.6.1) (2026-05-31)


### Bug Fixes

* **css:** use text-decoration shorthand for Obsidian 1.6.5 compat ([c3dfaa9](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/c3dfaa9fe34c48db3a23d7bb128555440055abb7))
* **deps:** override fast-uri/uuid/protobufjs to patched versions ([94fc886](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/94fc886f699b24267d940fff711a0c2889b38d65))

# [0.6.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.5.3...0.6.0) (2026-05-31)


### Bug Fixes

* **ide-bridge:** address code-quality review W1/W2/S1 on editor adapter ([e8a048b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/e8a048bf37869a7b48c5fda194779e3f9717a747))
* **ide-bridge:** correct WebSocket magic GUID to RFC 6455 value (T1.3) ([d645e39](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/d645e396b63e61a9912480dd5039f37898c7d3b4))
* **ide-bridge:** include serverInfo.version in MCP initialize result (handshake) ([db94ded](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/db94dedafbadb4cf0c569297e4ae9047a74f6c36))
* **ide-bridge:** land T4.4 copyAuthToken fix lost from 9db008f amend ([90e708c](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/90e708c43824caf4f61e71aed0190f3bf6fa1b57))
* **ide-bridge:** persist + surface the auth token across reloads (no regeneration) ([7b36113](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/7b36113070a1f8db3e3ad92de2bc533dbcab6f24))
* **ide-bridge:** remove casts + add sync-handler coverage in T2.5 (W1/W2/S2) ([a40bbbf](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/a40bbbf3a7727f40e70ddc8560f9f59ddbf160ec))
* **ide-bridge:** remove unused beforeEach import in tools-openFile test ([f0c8323](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/f0c8323b246b42b2de0cda78c17714af9fe7a277))
* **ide-bridge:** route tools via MCP tools/call with content envelope (T5.1a) ([051bc07](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/051bc0755e3d74315d2374f0fbfc1330ce7f5e98))
* **settings:** persist in place so subsystems don't clobber each other (token regen) ([9c94ff2](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/9c94ff216e0625eab08aa9f99a17ac42b432bd54))


### Features

* **ide-bridge:** add auth token generate/ensure helpers (T1.4) ([33b0bb3](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/33b0bb3091570c7b7ef9b4db668a300f0595b953))
* **ide-bridge:** add ConfirmModal for destructive-action confirmation (T4.2) ([f295fa7](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/f295fa712786ace73a62270f5a87a4084db8b6e3))
* **ide-bridge:** add connection-lifecycle debug logging for handshake diagnosis ([fd4ff8f](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/fd4ff8f9abf5fab1b306a1beab7f76b51875de3d))
* **ide-bridge:** add editor adapter seam + fake (T2.1) ([902deb1](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/902deb16b07f1e5a8d0cca9c53c9523c84c44cd0))
* **ide-bridge:** add IDE bridge settings section (T4.3) ([5d6f410](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/5d6f4109ea4db4c7695d9e0bc173d0c61b096a8e))
* **ide-bridge:** add IDE settings fields + v1→v2 migration (T4.1) ([665666a](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/665666a9c6ca00d782541c07ddbaad9042efe903))
* **ide-bridge:** add IdeBridge orchestrator — lifecycle & store writer (T3.2) ([06e5574](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/06e5574bc6b70b4d9ab542e2181075f99cd15551))
* **ide-bridge:** add JSON-RPC parse + dispatch with error envelopes (T1.5) ([a341e69](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/a341e69477a3617bb9d3f0a8c412c79221314d78))
* **ide-bridge:** add openFile tool with path-safety (T2.3) ([7fa6dab](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/7fa6dab1a40528df1e2bb4752dfb3ea841ff4682))
* **ide-bridge:** add protocol stub handlers (T2.4) ([6b244d4](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/6b244d4b3845aa15cb070c0a0674797e86423adc))
* **ide-bridge:** add protocol types, IdeBridge state, and store (T1.1) ([2d3d1b0](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/2d3d1b0368320809e2eeef572407d612ba62ff3d))
* **ide-bridge:** add RFC 6455 frame codec (T1.2) ([6af298b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/6af298b7c3ad79abf2292ae62e08c428687a6e47))
* **ide-bridge:** add selection tracker with debounce/dedup/broadcast (T2.6) ([d571d63](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/d571d63143110a1f3f61d68f5f08799efcc75e2f))
* **ide-bridge:** add selection/openEditors/workspace tools (T2.2) ([5915453](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/5915453e23573013a9953aed902d9443a43f11a6))
* **ide-bridge:** add tool registry + tools/list with dispatch error-bridge (T2.5) ([dd1c8a2](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/dd1c8a28373c86b68b479923684d7aad1fc6c38b))
* **ide-bridge:** add WebSocket handshake accept + auth check (T1.3) ([e19331b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/e19331bb40f922e2fe7af279dacbb81f45d7b415))
* **ide-bridge:** add WebSocket server with upgrade auth, broadcast & keepalive (T3.1) ([5285d65](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/5285d650aa8b2522dbc3d8860e2c5e7873462e64))
* **ide-bridge:** fold IDE state into 友 status bar + popover (T4.4) ([9db008f](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/9db008fd06e166b62e05fa87edcec69164b21722))
* **ide-bridge:** wire IdeBridge lifecycle + toggle command into main (T4.5) ([9bd136c](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/9bd136c3d353e4532a3516867f4eaf60d4702711))
* **settings:** rename sections (Tomo chat/Tomo context) + polish connection & token rows ([eb52ba7](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/eb52ba77c5faadd6ec2abf939e7deaf72b98dc19))

## [0.5.3](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.5.2...0.5.3) (2026-05-27)


### Bug Fixes

* address community plugin submission findings ([7a7876b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/7a7876b4c05f80f490dda40810a0b31b5b6593b5))

## [0.5.2](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.5.1...0.5.2) (2026-05-27)


### Bug Fixes

* **lint:** resolve all 18 pre-existing lint errors ([d766dbe](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/d766dbe2e76d1909740fd81d751bf476f5d0be7d))

## [0.5.1](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.5.0...0.5.1) (2026-05-27)


### Bug Fixes

* **lint:** register obsidianmd plugin explicitly in flat config ([b2cc5fc](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/b2cc5fc2e14f42396e9fd92c97284f56ff8d593e))

# [0.5.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.4.0...0.5.0) (2026-05-27)


### Features

* **chat:** inject [@file](https://github.com/file) references directly into Docker session stdin ([577a456](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/577a456312215fa295636cd72e8874dd4b89fd18))

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
