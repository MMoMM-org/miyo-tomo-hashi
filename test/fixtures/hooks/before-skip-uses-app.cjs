// Hook that accesses ctx.app.vault to verify app is reachable
module.exports = function (ctx) {
  // Access app.vault to prove app is available in hook context
  const vault = ctx.app.vault;
  return undefined;
};
