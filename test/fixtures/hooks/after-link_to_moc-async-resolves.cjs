// Async hook that awaits microtask then returns undefined
module.exports = async function (ctx) {
  await Promise.resolve();
  return undefined;
};
