/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  // Source imports use `.js` (required by NodeNext); map them back to the `.ts` files.
  moduleNameMapper: { '^(\\.{1,2}/.*)\\.js$': '$1' },
  // Creates and migrates the isolated test database (only when TEST_DATABASE_URL is set).
  globalSetup: '<rootDir>/tests/setup/global-setup.ts',
  // Database test files share one test database and truncate it between tests, so files must not
  // run concurrently. (Jest only parallelizes when it has no fast timings cached, e.g. on fresh CI
  // runners, which hides the race locally.) Revisit with per-worker databases if the suite grows slow.
  maxWorkers: 1,
  collectCoverageFrom: ['src/**/*.ts', '!src/server.ts'],
  clearMocks: true,
};
