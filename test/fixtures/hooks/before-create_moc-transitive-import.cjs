// Hook that requires a helper module to test cache-eviction caveat
module.exports = function (ctx) {
  // Lazy-load helper to allow smoke test validation to pass
  // In production (via createRequire), __dirname is properly defined
  const path = require('path');
  const helperPath = path.join(__dirname, '_helper.cjs');
  const helper = require(helperPath);
  const val = helper.HELPER_CONSTANT;
  return undefined;
};
