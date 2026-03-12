// backend/tests/__fixtures__/authFixtures.js
/**
 * Authentication fixtures for testing
 * Provides mock users, OIDC sessions, and auth utilities for OIDC-only authentication
 */

/**
 * Mock users for testing (OIDC-only mode)
 */
const mockUsers = {
    admin: {
        id: 1,
        username: 'admin',
        email: 'admin@test.local',
        role: 'admin',
        isAdmin: true,
        // OIDC properties
        oidc_provider: 'auth.example.com',
        oidc_subject: 'admin-oidc-subject-123',
        oidc_email: 'admin@test.local'
    },
    regularUser: {
        id: 2,
        username: 'testuser',
        email: 'testuser@test.local',
        role: 'user',
        isAdmin: false,
        // OIDC properties
        oidc_provider: 'auth.example.com',
        oidc_subject: 'testuser-oidc-subject-456',
        oidc_email: 'testuser@test.local'
    }
};

/**
 * Generate a mock session token for OIDC testing
 * @param {Object} user - User object
 * @returns {string} Session token
 */
function generateMockSessionToken(user) {
    return `mock-session-${user.id}-${Date.now()}`;
}

/**
 * Generate a mock OIDC session for testing
 * @param {string} userType - 'admin' or 'regularUser'
 * @returns {Object} Mock OIDC session object
 */
function generateMockSession(userType = 'regularUser') {
    const user = mockUsers[userType];
    return {
        passport: {
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                isAdmin: user.isAdmin,
                oidc_provider: user.oidc_provider,
                oidc_subject: user.oidc_subject,
                oidc_email: user.oidc_email
            }
        },
        cookie: {
            originalMaxAge: 604800000 // 7 days
        }
    };
}

/**
 * Get authorization headers for a user (OIDC-only mode)
 * @param {string} userType - 'admin' or 'regularUser'
 * @returns {Object} Headers object
 */
function getAuthHeaders(userType = 'regularUser') {
    const user = mockUsers[userType];

    // OIDC-only mode uses session cookies, not Bearer tokens
    // But for testing API routes, we can simulate authenticated requests
    return {
        'cookie': `connect.sid=${generateMockSessionToken(user)}`,
        'x-user-id': user.id.toString(),
        'x-auth-mode': 'oidc'
    };
}

/**
 * Mock request object with OIDC authenticated user
 * @param {string} userType - 'admin' or 'regularUser'
 * @returns {Object} Mock request object
 */
function mockRequest(userType = 'regularUser') {
    const user = mockUsers[userType];
    const session = generateMockSession(userType);

    return {
        user: { ...user },
        session: session,
        headers: {
            cookie: `connect.sid=${generateMockSessionToken(user)}`
        },
        ip: '127.0.0.1',
        isAuthenticated: () => true,
        logout: jest.fn(),
        login: jest.fn(),
        save: jest.fn(),
        get: jest.fn((header) => {
            if (header === 'User-Agent') return 'test-agent';
            if (header === 'Referer') return 'http://localhost:3000';
            return null;
        })
    };
}

/**
 * Mock request object without authentication
 * @returns {Object} Mock unauthenticated request object
 */
function mockUnauthenticatedRequest() {
    return {
        user: null,
        session: {},
        headers: {},
        ip: '127.0.0.1',
        isAuthenticated: () => false,
        logout: jest.fn(),
        login: jest.fn(),
        save: jest.fn(),
        get: jest.fn((header) => {
            if (header === 'User-Agent') return 'test-agent';
            return null;
        })
    };
}

/**
 * Mock response object
 * @returns {Object} Mock response object
 */
function mockResponse() {
    const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
        send: jest.fn().mockReturnThis(),
        sendFile: jest.fn().mockReturnThis(),
        redirect: jest.fn().mockReturnThis(),
        cookie: jest.fn().mockReturnThis(),
        clearCookie: jest.fn().mockReturnThis()
    };
    return res;
}

/**
 * Mock OIDC callback token set
 * @param {string} userType - 'admin' or 'regularUser'
 * @param {string} nonce - Nonce value
 * @returns {Object} Mock tokenSet object
 */
function mockTokenSet(userType = 'regularUser', nonce = 'test-nonce-123') {
    const user = mockUsers[userType];

    return {
        claims: jest.fn().mockReturnValue({
            sub: user.oidc_subject,
            nonce: nonce,
            aud: 'test-client-id',
            iss: 'https://auth.example.com',
            exp: Math.floor(Date.now() / 1000) + 3600,
            iat: Math.floor(Date.now() / 1000),
            email: user.email,
            preferred_username: user.username,
            name: user.username
        })
    };
}

/**
 * Mock OIDC user info
 * @param {string} userType - 'admin' or 'regularUser'
 * @returns {Object} Mock userinfo object
 */
function mockUserinfo(userType = 'regularUser') {
    const user = mockUsers[userType];

    return {
        sub: user.oidc_subject,
        email: user.email,
        preferred_username: user.username,
        name: user.username,
        groups: user.role === 'admin' ? ['admin'] : ['users']
    };
}

/**
 * Create mock OIDC authentication environment
 * @param {string} userType - 'admin' or 'regularUser'
 * @returns {Object} Object with req, res, and next mock
 */
function mockAuthEnvironment(userType = 'regularUser') {
    return {
        req: mockRequest(userType),
        res: mockResponse(),
        next: jest.fn()
    };
}

module.exports = {
    mockUsers,
    generateMockSessionToken,
    generateMockSession,
    getAuthHeaders,
    mockRequest,
    mockUnauthenticatedRequest,
    mockResponse,
    mockTokenSet,
    mockUserinfo,
    mockAuthEnvironment
};
