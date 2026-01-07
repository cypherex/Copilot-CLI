export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  // Avoid ChildProcess spawn in restricted environments
  workerThreads: true,
  maxWorkers: 1,
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/*.test.ts', '**/*.spec.ts'],
  testPathIgnorePatterns: ['\\.integration\\.test\\.ts$'],
  transform: {
    '^.+\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        jsx: 'react',
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
      },
    }],
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
  ],
  moduleNameMapper: {
    '^chalk$': '<rootDir>/src/test/chalk-mock.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
};
