module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleFileExtensions: ["ts", "js", "json", "node"],
  // The workspace package is TS source; point jest straight at it.
  moduleNameMapper: {
    "^@qacc/shared$": "<rootDir>/packages/shared/src/index.ts",
    "^@qacc/shared/(.*)$": "<rootDir>/packages/shared/src/$1",
  },
  transform: {
    "^.+\\.ts$": ["ts-jest", { diagnostics: false }],
  },
};
