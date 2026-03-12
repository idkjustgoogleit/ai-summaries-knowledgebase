// backend/tests/setup.js
/**
 * Test setup file
 * Configures Jest and test environment
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DEBUG_MODE = 'false';

// Mock database pool
jest.mock('../utils/db', () => ({
    pool: {
        query: jest.fn(),
        connect: jest.fn(),
        end: jest.fn()
    }
}));

// Global test timeout
jest.setTimeout(10000);
