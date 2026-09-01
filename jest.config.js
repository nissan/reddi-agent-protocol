const nextJest = require('next/jest')

const createJestConfig = nextJest({
  dir: './',
})

const customJestConfig = {
  testEnvironment: 'node',
  testMatch: ['**/lib/**/*.test.ts', '**/lib/**/__tests__/**/*.ts', '<rootDir>/packages/demo-agents/src/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // packages/agent-protocol uses ESM-style relative `./x.js` imports that
    // resolve to `.ts` sources when consumed through the tsconfig path alias.
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
}

module.exports = createJestConfig(customJestConfig)
