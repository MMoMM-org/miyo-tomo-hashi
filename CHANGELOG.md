## [0.20.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.19.2...0.20.0) (2026-09-01)

### Features

* **deps:** bump xterm to 6.0.0 and raise CON-7 to 980 KB ([c67267b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/c67267b1228fc9757beed239b712b907d3d54fde)), closes [xtermjs#5096](https://github.com/MMoMM-org/xtermjs/issues/5096)

## [0.19.2](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.19.1...0.19.2) (2026-08-31)

### Bug Fixes

* **deps:** hoist esbuild to 0.28.2 so Dependabot lockfiles pass npm ci ([8d68ee5](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/8d68ee5f83ee0cb3829068ad7fbc99a977011624)), closes [#103](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/103)

## [0.19.1](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.19.0...0.19.1) (2026-08-31)

### Bug Fixes

* **deps:** drop obsolete nested vitest/esbuild override ([024571d](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/024571dd388d324af26c1c6e68b9b5fb6d6fe8e9))

## [0.19.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.18.0...0.19.0) (2026-07-27)

### Features

* **006:** "Open Instruction Fixer" option on the execute-result surface (T4.2) ([af779bd](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/af779bdf20c6e3828ad1b4be4c926f06495851b3))
* **006:** add "Open instruction fixer" command (T4.1) ([bebdb1d](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/bebdb1d9027d6a6cc97783a2bc46320c0079f307))
* **executor:** add markActionFields atomic writer (spec-006 T1.2) ([525c07c](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/525c07c46c5c0b9ff38bcdb01abce0cdd35c245a))
* **instruction-fixer:** add editGate fail-closed edit gate (spec-006 T2.2) ([92401c6](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/92401c651fa76b8e756fe5972f8ce0e2f6c07180))
* **instruction-fixer:** per-kind repair cards, gate wiring, note nav (T3.2) ([3fc0a41](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/3fc0a41f7d302b19c45096e7869aadceb8e0fafa))
* **instruction-fixer:** pick anchors and markers from the target note ([b215fe7](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/b215fe78732711719f8f0286fbbc940a51cc1ea6))
* **instruction-fixer:** re-run bridge + post-run reconcile (spec-006 T3.3) ([b6f6637](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/b6f6637a3fdbc5c3bb3b9ccd63980b6ede35aace))
* **instruction-fixer:** resolveOutcomes trusted-outcome source (spec-006 T2.1) ([e4c6a95](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/e4c6a95b457123a64ba885de85abca1501886112))
* **instruction-fixer:** view shell — leaf, gate grouping, save guard (spec-006 T3.1) ([1585c0d](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/1585c0dd0ab1229e41ab1c435cdbcb84ab785a9c))
* **spec-006:** instruction-fixer setTargetField transform (T1.3) ([9b8098e](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/9b8098e12d9c814346bf9d87b58226b85d1a4381))
* **spec-006:** InstructionSetDoc port + ObsidianInstructionSetDoc adapter ([5652563](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/5652563424c72137303984569e509f620080f72d))

### Bug Fixes

* **006:** address T4.2 review — testable fixer-idle order, wrapped buttons ([39697a8](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/39697a8359ad53afa9d3dcc951805efbd15327b9))
* **006:** disambiguate fixer labels when basenames collide (T4.2 review) ([2cf9bea](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/2cf9bea2b2f340fbc5f7af6a1921c9183ab4cc16))
* **006:** sentence-case the "Open instruction fixer" button label ([41cbf86](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/41cbf86f39576e2e04bfa74bc098e11402c05d36))
* **executor:** close applied-monotonicity gap in markActionFields patch ([0dd56c2](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/0dd56c2517def906988b0166bbc9dcd6cc1e879e))
* **executor:** drop run-log I## deep-link, add Fixer pointer line (spec-006 T4.3) ([bd9d1d3](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/bd9d1d3194042a22705d695caaa0cab97523d5e6))
* **instruction-fixer:** don't let a stale save advance the new doc's baseline (spec-006) ([a9a8fa6](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/a9a8fa6d1a13c08a579093f8f3e2c975e67b679a))
* **instruction-fixer:** fail closed on an unreadable newer run log (spec-006 T2.1) ([1c9791a](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/1c9791aac0a010138aebd519e1f038a33dd86592))
* **instruction-fixer:** guard stale save errors, plain-language save panel (spec-006 T3.1) ([b691417](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/b691417bc342a74a672fa9d777af8c766a9e4d6f))
* **instruction-fixer:** marker pick seeds line, closing a silent-clobber trap ([51eb524](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/51eb5240db6a90f26d670788e9be3a9b30403050))
* **instruction-fixer:** marker pick swaps line's prefix, keeps the payload ([ab1dc5b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/ab1dc5b352bee27feb27a826a4d9578e30b5e243))
* **instruction-fixer:** name create_moc's source, sweep affectedNotePath over all 14 kinds ([3c42308](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/3c423089303c9fa3bb940a5d35ddc7c076b420cc))
* **instruction-fixer:** name editGate table titles by scenario, not row order ([81519f6](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/81519f613f18c1ff830a7e7ff06232f875452479))
* **instruction-fixer:** put the failure reason under the intent it explains (T3.2) ([9e86b8b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/9e86b8b6cb6601b2090201b34edca92e61965209))
* **instruction-fixer:** reload after a failed re-run too (spec-006 T3.3 review) ([08c35f0](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/08c35f03865ce50071f730321c0da1cefcced13d))
* **instruction-fixer:** report how much of a failed save landed (spec-006 T3.1) ([9eb0d0f](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/9eb0d0febffcdbcad07cb77789d8403a4f109576))
* **instruction-fixer:** revert marker-pick line seed — wrong on the merits ([47f6a2e](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/47f6a2e3e972ff01ee4ac4c742029fbc56e7a0e6))
* **instruction-fixer:** route save() through markActionFields + validate (spec-006 T1.5) ([a8dd5ab](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/a8dd5ab30242f6d32ab6ec60ae756e6b78847feb))
* **instruction-fixer:** suppress vacuous no-signal banner, guard load reentrancy ([5e7835c](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/5e7835c800a9b4d6b35aed06f4a30fc382c20c01))
* **spec-006:** collapse target-field dispatch, cover unresolved fields (T1.3) ([8672c73](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/8672c731fcac972f347e1c6efccea10cc0076c5f))

## [0.18.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.17.2...0.18.0) (2026-07-25)

### Features

* **actions:** add edit_note_text action for garden-audit link fixes ([911e79e](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/911e79e20169e987c54bc368affb50a75f84190a))
* **actions:** remove_up_link action for garden-audit broken_up removal ([4ee6d40](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/4ee6d40008cca628aeabeb08126bb7f961855c06))
* **actions:** resolve_dead_link — alias-aware dead-link resolution (14th kind) ([a18577c](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/a18577c24ae4568195dd322bcacea53bd8bd4c10))
* **garden-audit:** advisory read-only cards (T5.5) ([abcab75](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/abcab758c8f71156c4aa4827486672c28270c104))
* **garden-audit:** Ajv2020 wire validator with accept/reject coverage (T1.2) ([681556c](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/681556c4ec5fa082b821758b380740f28255c22b))
* **garden-audit:** async cached dead-link context (T6.1) ([b225c24](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/b225c24b130fb893d3ba379d4266e1bfdaa61626))
* **garden-audit:** candidate chip click auto-selects Apply ([e353be1](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/e353be1739893e9adad9143048b8b12cfdeaed08))
* **garden-audit:** candidate chips — display-only, click-to-pick (T5.3) ([c770a06](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/c770a06710622ef588d1fafb5cb07d72ac0dd06a))
* **garden-audit:** composite TargetControl widget (T5.1) ([0bcc19f](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/0bcc19f568481c1ffb6a330340d556aeb22e5e39))
* **garden-audit:** discovery regex + resolver (disjoint from suggestions) (T3.1) ([45e6e67](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/45e6e67139ce5f51b786af23d1dc229bdc60a55e))
* **garden-audit:** editor view lifecycle + leaf-head (T4.1) ([a683114](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/a683114af1a53b504bcd29756f40bcacb3c7feba))
* **garden-audit:** empty & error states (T4.4) ([cf72f9a](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/cf72f9a6ffb4a479bea7d14e5909ef7f54a16935))
* **garden-audit:** empty-state tooltips + no-scan-candidate hint ([c66c21e](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/c66c21e079863d301688e511eb42dd49357aaa4a))
* **garden-audit:** fixable per-check cards (T5.2) ([196098a](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/196098a0d105c434cbf8fa9104742639e2231603))
* **garden-audit:** GardenAuditDoc port + adapter (JSON-only verbatim write, ADR-6) (T2.1) ([3be2f6d](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/3be2f6d16ff3abf658d12f1627ea7625560cc330))
* **garden-audit:** open-beside + hover-preview note navigation (T6.2) ([2679c42](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/2679c42c2c86e5e41c5b892d7b3f89ce57b2f7df))
* **garden-audit:** per-tier "X of Y" apply-progress count ([f507fdf](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/f507fdfff37398e6de31aaea56fbe031d82b8610))
* **garden-audit:** pure apply-decision transforms with ADR-5 action rule (T2.2) ([556313a](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/556313aa4340df963e360c716a877f74f6fd06e4))
* **garden-audit:** register view type + wire opener into main (T3.3) ([ac5570c](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/ac5570c6d5e1df601fc582e121b4abfab9b7a05d))
* **garden-audit:** save/revert/dirty affordance with concurrent-change guard (T4.3) ([aeec04f](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/aeec04f0b9980dc9fa7f76a2b12f125ec20784fc))
* **garden-audit:** suffix-dispatch open command to both editors (T3.2) ([1b44a28](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/1b44a285119f0e92a227764e7e81b03da44c7940))
* **garden-audit:** suggest_pending gate + two-run banner & highlight ([7a630f0](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/7a630f0ce3b4691f300f9a0796a0982bfd7a39c5))
* **garden-audit:** suggest-targets toggle + two-run hints (T5.4) ([c33e770](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/c33e770b775136c66a1eedf940add0cbc7224ced))
* **garden-audit:** target edit on skipped finding auto-selects apply ([080f173](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/080f173604c1d2a0f20f8018913fa5f68d4e2b6b))
* **garden-audit:** tier-grouped tab shell (T4.2) ([3640c72](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/3640c726d2bac5a0ba2d6aea93582645c7523931))
* **garden-audit:** vendor wire schema + hand-aligned types (T1.1) ([bb4f7a5](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/bb4f7a52adcbd63ba46faee172f0eb01a4162941))

### Bug Fixes

* **garden-audit:** address Phase 3 spec review (T3.x) ([098b3ee](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/098b3ee0bb34d3c93c8f437a205cfc3a9a119d50))
* **garden-audit:** flip broken_up remove tooltip to link-only wording ([5e8d0cb](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/5e8d0cb3941f45d23b0fed256245011964c70e76))
* **garden-audit:** move no-scan-candidate hint to the detail-line slot ([bf020e0](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/bf020e0e2d2975312491bcd2c0f07598b109e0b8))
* **garden-audit:** normalize broken_up action on save — ADR-5 apply-only gap ([f7a43c2](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/f7a43c269853012d0231cf09f79399724365d92f))
* **garden-audit:** register hover-link source + context edge polish (P6 validation) ([25ae89f](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/25ae89f4e3741cd7300eefe1a18016eecdb2e2f5)), closes [#tag](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/tag)
* **garden-audit:** reset dead-link context cache per doc load (T6.1 review) ([a28f534](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/a28f534884c189cfd6b95ebc5d0a2b9017bef840))
* **garden-audit:** singular-aware aria-label for single-finding tier count ([ebd04ea](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/ebd04ea5a4ee98115db68b2d26756f0ceb269cae))
* **schema:** clear validator error for unknown action kind (was misleading 'source') ([7287867](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/7287867b3a8ec64fd82778c793efb95bc612d47c))

## [0.17.2](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.17.1...0.17.2) (2026-07-13)

### Bug Fixes

* **lint:** drop disallowed prefer-create-el disable in error banner ([03bdbe6](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/03bdbe6e1450d85a09fcbe208d62bebaf9e9da5f))

## [0.17.1](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.17.0...0.17.1) (2026-07-13)

### Bug Fixes

* **lint:** clear Obsidian scorecard failures for v0.17.0 ([d1ddd55](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/d1ddd551961bbaad182dd25ff4b3943a42270ea6))
* **lint:** enable the obsidianmd ruleset that was silently disabled ([8f2203b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/8f2203bb53e65d770ff6a25bdebeeea641393a2b))

## [0.17.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.16.0...0.17.0) (2026-07-11)

### Features

* **spec-004:** adapt to new suggestions wire schema — per-note summary ([75b62f8](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/75b62f86394420b8ab91795698ec9cab56111131))
* **spec-004:** add EditModel wrapping the whole wire doc (T1.1 follow-up) ([4df6efb](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/4df6efbc1fead043f063da70626e791955b8627d))
* **spec-004:** daily edit transforms — content/position/time/accept (T1.7) ([3b36512](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/3b365126f7d092214ef7ca69674079e328c1dee1))
* **spec-004:** Daily tab — content/position/time/accept + existence check (T3.6) ([9b33cdf](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/9b33cdf38172122db45b203c83ae962763602ce9))
* **spec-004:** daily-log indicator icon on suppressed cards ([cad6352](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/cad6352ced68b91ccd5563214eec9a1ba4fdf250))
* **spec-004:** discover the Force-Atomic Resolve fan doc (_suggestions-fan) ([5c18aa8](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/5c18aa8eb1f95e808ec80c6d4c63ced3dd150018))
* **spec-004:** EditModel types + schema version gate (T1.1) ([873fccd](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/873fccd455f2271c9790d2f877a7b1e523fed240))
* **spec-004:** force-atomic stem-sync transform (T1.4) ([f887357](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/f8873577a4ebe415d9e6433aec129adfc2f37b47))
* **spec-004:** fuzzy field pickers — MOC/tags/template/location/parent (T3.4) ([4fdc62c](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/4fdc62c46aa139cbf38737f25d346ae5bbedd67a))
* **spec-004:** ObsidianSuggestionsDoc load + save (T2.1/T2.2) ([6a703c9](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/6a703c93a1c0072b9b585b68a3fc0c899a105710))
* **spec-004:** pre-live-run editor refinements (settings, UX, 5 editor fixes) ([c61e653](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/c61e653ca8710e1769109befb2da5042531e488a))
* **spec-004:** Proposed MOCs tab — rename/parent/decision/merge + member titles (T3.5) ([56c21ff](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/56c21ff86b6c04f6756ba140714003c01b04a720))
* **spec-004:** proposed-MOC graph ops — rename/reparent/decision/merge (T1.5) ([65e0765](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/65e07654b987c7805d74e2523239536bafcc9246))
* **spec-004:** rebuild editor UI to the approved mockup + add Save; fix 6 bugs ([2270570](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/227057093e444e62d4af8c1750688439c607280f))
* **spec-004:** register Suggestions Editor view + open command (T4.1) ([13299fd](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/13299fda3b8dc564f8e9c566da666ffc48b36d07))
* **spec-004:** show proposed-MOC membership on Suggestions cards ([a0ea97d](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/a0ea97d49e7d360780fd752ca26a39ebad1a654e))
* **spec-004:** SpotPicker (op 2) — real structure, executor-honourable placements (T3.3) ([956d808](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/956d808c0148e242a8107d05c0613de58a9a1bb1))
* **spec-004:** suggestion field transforms — op1/op4/note fields (T1.3) ([1b5e7e8](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/1b5e7e8d2f5ce06bf6c50b54a7515347e51e925b))
* **spec-004:** Suggestions tab — worthy vs suppressed cards (T3.2) ([de74438](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/de74438693d31cc8c8f4e45e123f3a9fbad5a345))
* **spec-004:** SuggestionsDoc port + FakeSuggestionsDoc (T1.2) ([aa9ff6f](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/aa9ff6f4ce0231aa69c1594720038bc273e0c2f4))
* **spec-004:** SuggestionsEditorView leaf + tab chrome + tab contract (T3.1) ([c2c615d](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/c2c615de01bffcefd4d8653fac3e9b94add0abb8))
* **spec-004:** suggestionsStore wrapping Store<T> (T1.9) ([d31f78c](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/d31f78c84c5b864bc58ecf431763c32ef0ea42a4))
* **spec-004:** Tag-Handler tab — read-only context + approve/keep-source (T3.7) ([31a884b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/31a884b8267bc9447ffeedae977a940b5bc201f2))
* **spec-004:** tag-handler toggle transform (T1.8) ([eb8ad43](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/eb8ad43c0923eaeb4c832107c24755964ae597f9))
* **spec-004:** validPlacements(anchorType) — executor-honourable placements (T1.6) ([f2c647b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/f2c647b55ccca9bdde7883de68814f5529defe4a))

### Bug Fixes

* **spec-002:** don't misroute non-instructions docs into the executor; offer a picker ([a1cf56c](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/a1cf56cc075f97e1016c18c59ba7ea5da7a28c48))
* **spec-004:** adapter save robustness (T2.1/T2.2 review) ([8eb9b40](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/8eb9b4004d681fc851502fbd24eb33f024b5a44a))
* **spec-004:** daily no-op must preserve dirty (T1.4/T1.6/T1.7 review) ([3f138ba](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/3f138ba90da2c2a044ae3e11bc31e1b6e2152500))
* **spec-004:** no-op dirty gating for transforms (T1.3/T1.5/T1.7 review) ([3805cb3](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/3805cb393cfed8128676ae67292bee7a39b47a0a))
* **spec-004:** preserve Tomo frontmatter + write Pass-2 gate in _suggestions.md ([3801fc3](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/3801fc360c133faef069c56bf56f70cca595d790))
* **spec-004:** QA round 2 — openable origin links + conditional suppressed hint ([0530205](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/053020594eb79cdf216c3c73ec1de75806f55b44))
* **spec-004:** retarget proposed-MOC reason count on merge ([2697f2b](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/2697f2b738c5de5e78dc0ced776b315a3a777b00))
* **spec-004:** Save race guard + a11y (rebuild code-quality review) ([62cf58d](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/62cf58dc2a1af6ac9a615c471a1eea81e9d74fc1))
* **spec-004:** separate SpotPicker label from its placement badge ([cd4e7f6](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/cd4e7f6d6b2f1f78fb96c379600a002abea9e87f))
* **spec-004:** style tracker + log-link daily rows; link the log-link target ([2931584](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/29315846d020e8914db33678f440d53d08a2e3a5))
* **spec-004:** tab inline-helper no-op contract (T3.2/T3.5 review) ([e8ec66a](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/e8ec66ad5c7b5b2c35b5d0eba155d30480ee6d0d))

## [0.16.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.15.0...0.16.0) (2026-07-03)

### Features

* **connection:** make chat container component configurable ([#81](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/81)) ([7e8c356](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/7e8c356ad97076aa0b0c32dbaaadea4e62c068f9))

## [0.15.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.14.0...0.15.0) (2026-07-01)

### ⚠ BREAKING CHANGES

* **schema:** bump schema_version v1→v2, rename move_note source_inbox_item (#41) (#79)

### Features

* **schema:** bump schema_version v1→v2, rename move_note source_inbox_item ([#41](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/41)) ([#79](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/79)) ([228e966](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/228e96629f7dd38f67d356fdb0399803a8b63b3b))

### Bug Fixes

* **release:** adopt conventionalcommits preset so feat!/fix! commits release ([#80](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/80)) ([c8ec793](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/c8ec79319b19e16f538bc283b72e9321f26e5f73)), closes [#79](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/79)

# [0.14.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.13.0...0.14.0) (2026-06-27)


### Features

* **run-log:** stamp tomo_skip_inbox_analysis on run-log frontmatter ([#78](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/78)) ([7a436e4](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/7a436e4ce2407e5ff0d2c9642ce9abfaa634fb00))

# [0.13.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.12.0...0.13.0) (2026-06-25)


### Bug Fixes

* **connection:** classify raw docker.sock errors instead of leaking them ([#76](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/76)) ([35c94d8](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/35c94d8905d45535940c103e1daeab3b26cf1eed))


### Features

* **actions:** add block anchor + replace_section for structure-aware compose ([#75](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/75)) ([86c0fc4](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/86c0fc45ee2a554938abcd2413817c27d0e19747)), closes [miyo-tomo#47](https://github.com/miyo-tomo/issues/47) [#68](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/68)

# [0.12.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.11.1...0.12.0) (2026-06-23)


### Features

* **actions:** add insert_under_marker — multi-line block insert under any marker ([#47](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/47)) ([#73](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/73)) ([a565ed1](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/a565ed1b675a1defea4c87d33727e3f30d902390))

## [0.11.1](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.11.0...0.11.1) (2026-06-23)


### Performance Improvements

* **build:** stub dockerode's eager gRPC ./session — bundle 1172→759 KB ([#46](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/46)) ([#72](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/72)) ([e2e3621](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/e2e3621cb734ac64f36ab786087533c191d3a20f))

# [0.11.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.10.4...0.11.0) (2026-06-20)


### Features

* **schema:** accept optional top-level tomo provenance block ([#71](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/71)) ([7fe621e](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/7fe621e96a7a07298417593f0b72eca48d0264c1)), closes [miyo-tomo#74](https://github.com/miyo-tomo/issues/74)

## [0.10.4](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.10.3...0.10.4) (2026-06-17)


### Bug Fixes

* resolve link_to_moc & daily-note sections from content, not the metadataCache ([#68](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/68)) ([#70](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/70)) ([30f76c4](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/30f76c4dcb81340853a8c0a0564ac62e31fa119f))

## [0.10.3](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.10.2...0.10.3) (2026-06-17)


### Bug Fixes

* **actions:** align filename validation with Tomo sanitization contract ([#69](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/69)) ([c580c06](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/c580c06bf36d9ed6a80e93b1c089cb4420ed8f4e)), closes [#66](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/66)

## [0.10.2](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.10.1...0.10.2) (2026-06-17)


### Bug Fixes

* **deps:** patch protobufjs/js-yaml/esbuild alerts + record filename decision ([#67](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/67)) ([58e0417](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/58e04174b0f22d02bf8fd32dc147fee5c8df064d)), closes [#66](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/66)

## [0.10.1](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.10.0...0.10.1) (2026-06-17)


### Bug Fixes

* **executor:** reject illegal filenames + guard modal onClose recursion ([#66](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/66)) ([65086b0](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/65086b02198714c7015320a1c8adf04f848a00d2))

# [0.10.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.9.0...0.10.0) (2026-06-13)


### Features

* **link_to_moc:** generalize apply into one insert primitive (before + multi-line) ([a3e9b99](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/a3e9b993fdb471ccf75115bdf2448139d3fb5ea1)), closes [hashi#42](https://github.com/hashi/issues/42) [hashi#43](https://github.com/hashi/issues/43) [28/#29](https://github.com/MMoMM-org/miyo-tomo-hashi/issues/29)

# [0.9.0](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.8.2...0.9.0) (2026-06-13)


### Bug Fixes

* **executor:** make the permanent-delete warning Notice sticky ([0769976](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/076997616c465e35b2d801f21003943a6974fbf6))


### Features

* **executor:** one-time permanent-delete warning + F4 trash-semantics amendment ([d6c3957](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/d6c3957ddb2b727f8b4311aa565196e6d9c98429))

## [0.8.2](https://github.com/MMoMM-org/miyo-tomo-hashi/compare/0.8.1...0.8.2) (2026-06-12)


### Bug Fixes

* **lint:** use window.* timers and declare @codemirror/view ([98cef59](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/98cef599ccd9583cd529653347440ac24531d410))
* **vault:** trash via fileManager.trashFile to honor user delete preference ([44c710f](https://github.com/MMoMM-org/miyo-tomo-hashi/commit/44c710fb9839e6d2efb32fdf1029bb40d4e34b64))

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
