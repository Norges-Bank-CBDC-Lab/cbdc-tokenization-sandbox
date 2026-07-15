// TypeScript 7's native compiler does not yet expose the stable programmatic
// API required by ts-jest, so the pretest script compiles this tree first.
const compiledTestRoot = '<rootDir>/../../.tmp/nb-bond-api-jest';

module.exports = {
  testEnvironment: 'node',
  roots: [compiledTestRoot],
  testMatch: [`${compiledTestRoot}/tests/**/*.test.js`],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  clearMocks: true,
  setupFiles: [`${compiledTestRoot}/tests/jest.setup.js`],
  transform: {
    '^.+\\.m?js$': 'babel-jest',
  },
  transformIgnorePatterns: ['/node_modules/(?!@noble/secp256k1)'],
};
