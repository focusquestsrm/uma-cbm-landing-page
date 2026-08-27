(function (root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.UMA_GRADUATION_YEARS = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const MINIMUM_YEAR = 1996;
  const MAXIMUM_YEAR = 2023;

  function isValid(value) {
    const normalized = String(value || '').trim();
    if (!/^\d{4}$/.test(normalized)) return false;
    const year = Number(normalized);
    return year >= MINIMUM_YEAR && year <= MAXIMUM_YEAR;
  }

  return Object.freeze({
    MINIMUM_YEAR,
    MAXIMUM_YEAR,
    isValid
  });
});
