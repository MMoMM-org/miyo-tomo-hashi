// Hook that throws synchronously
module.exports = function (ctx) {
  throw new Error('Intentional hook error');
};
