// Async-hanging hook for timeout testing.
//
// Deviation (2026-04-29, T4.4): Original fixture used a synchronous
// `while(true){}` which blocks the JS event loop entirely — no Promise.race
// timeout can fire in single-threaded Node while the loop is executing. The
// realistic threat is ASYNCHRONOUS hangs (e.g. hung `await fetch()`). This
// fixture uses `await new Promise(() => {})` — a never-resolving async hang —
// so the 30s timeout race (exercised with a short injected timeoutMs in tests)
// can fire correctly.
module.exports = async function (ctx) {
  await new Promise(() => {});
};
