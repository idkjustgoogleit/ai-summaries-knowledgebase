// backend/jest.config.js
/**
 * Jest configuration for backend testing
 */

module.exports = {
    // Test environment
    testEnvironment: 'node',

    // Setup files
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

    // Test file patterns
    testMatch: [
        '**/tests/**/*.test.js',
        '**/__tests__/**/*.js'
    ],

    // Coverage configuration
    collectCoverageFrom: [
        'routes/**/*.js',
        'middleware/**/*.js',
        'auth/**/*.js',
        '!**/node_modules/**',
        '!**/tests/**'
    ],

    // Module paths
    moduleDirectories: ['node_modules', '.'],

    // Transform files (if using ES modules or TypeScript)
    transform: {},

    // Ignore patterns
    testPathIgnorePatterns: [
        '/node_modules/',
        '/dist/'
    ],

    // Coverage thresholds
    coverageThreshold: {
        global: {
            branches: 70,
            functions: 70,
            lines: 70,
            statements: 70
        }
    },

    // Verbose output
    verbose: true
};
