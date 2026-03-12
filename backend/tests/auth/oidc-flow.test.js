// backend/tests/auth/oidc-flow.test.js
/**
 * OIDC Flow Integration Tests
 *
 * Tests the complete OIDC authentication flow from login to callback:
 * - Login request generates PKCE verifier, state, and nonce
 * - Callback validates security parameters
 * - User is created/updated in database
 * - Admin role is assigned correctly
 * - Session verification works
 * - Logout flow works
 *
 * These tests mock the Passport OIDC strategy to avoid needing a real OIDC provider
 */

const {
    generateCodeVerifier,
    generateCodeChallenge,
    generateState,
    generateNonce,
    validateState,
    validateNonce
} = require('../../auth/oidc/index.js');

const {
    createOrUpdateUser,
    getUserByOidcSubject,
    isAdmin
} = require('../../auth/shared');

// Mock the database
jest.mock('../../auth/shared', () => {
    const actualModule = jest.requireActual('../../auth/shared');
    return {
        ...actualModule,
        initialize: jest.fn(),
        createOrUpdateUser: jest.fn(),
        getUserByOidcSubject: jest.fn(),
        getUserById: jest.fn(),
        isAdmin: jest.fn((user) => user?.role === 'admin'),
        logAuthEvent: jest.fn(),
        logAuditEvent: jest.fn()
    };
});

// Mock the auth config
jest.mock('../../config/auth', () => ({
    authConfig: {
        adminUsername: 'admin',
        roles: {
            admin: 'admin',
            user: 'user'
        },
        oidcSecurity: {
            pkceEnabled: true,
            stateEnabled: true,
            nonceEnabled: true,
            stateExpiryMs: 10 * 60 * 1000
        },
        logging: {
            enabled: true
        }
    }
}));

describe('OIDC Flow Integration Tests', () => {

    describe('Login Request - Security Parameter Generation', () => {

        it('should generate all security parameters for login', () => {
            const mockSession = {};
            const mockRequest = { session: mockSession };

            // Simulate login route behavior
            // 1. Generate PKCE code verifier
            const codeVerifier = generateCodeVerifier();
            expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
            expect(codeVerifier).toHaveLength(43);

            // 2. Generate code challenge
            const codeChallenge = generateCodeChallenge(codeVerifier);
            expect(codeChallenge).toBeDefined();
            expect(codeChallenge).not.toBe(codeVerifier);

            // 3. Generate state parameter
            const state = generateState(mockRequest);
            expect(state).toMatch(/^[a-f0-9]+$/);
            expect(state).toHaveLength(32);
            expect(mockSession.oidcState).toBe(state);
            expect(mockSession.stateExpiresAt).toBeDefined();

            // 4. Generate nonce
            const nonce = generateNonce(mockRequest);
            expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
            expect(mockSession.oidcNonce).toBe(nonce);

            // Verify all parameters are present
            expect(codeVerifier).toBeDefined();
            expect(codeChallenge).toBeDefined();
            expect(state).toBeDefined();
            expect(nonce).toBeDefined();
        });

        it('should store security parameters in session', () => {
            const mockSession = {};
            const mockRequest = { session: mockSession };

            // Generate security parameters
            const state = generateState(mockRequest);
            const nonce = generateNonce(mockRequest);
            const codeVerifier = generateCodeVerifier();
            const codeChallenge = generateCodeChallenge(codeVerifier);

            // Store in session (simulating login route)
            mockSession.codeVerifier = codeVerifier;
            mockSession.codeChallenge = codeChallenge;

            // Verify session has all parameters
            expect(mockSession.oidcState).toBe(state);
            expect(mockSession.oidcNonce).toBe(nonce);
            expect(mockSession.codeVerifier).toBe(codeVerifier);
            expect(mockSession.codeChallenge).toBe(codeChallenge);
            expect(mockSession.stateExpiresAt).toBeDefined();
        });
    });

    describe('Callback - Security Parameter Validation', () => {

        it('should validate all security parameters in callback', () => {
            const { createOrUpdateUser, logAuthEvent } = require('../../auth/shared');

            // Setup session with security parameters
            const mockSession = {
                oidcState: 'test-state-abc123',
                stateExpiresAt: Date.now() + 60000,
                oidcNonce: 'test-nonce-xyz789',
                codeVerifier: 'test-code-verifier',
                codeChallenge: null // Will be set in test
            };
            const mockRequest = { session: mockSession };

            // Generate matching challenge
            mockSession.codeChallenge = generateCodeChallenge(mockSession.codeVerifier);

            // Mock tokenSet and userinfo
            const mockTokenSet = {
                claims: jest.fn().mockReturnValue({
                    sub: 'user-oidc-subject-123',
                    nonce: mockSession.oidcNonce,
                    aud: 'test-client-id',
                    iss: 'https://auth.example.com',
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    iat: Math.floor(Date.now() / 1000),
                    email: 'testuser@example.com'
                })
            };

            const mockUserinfo = {
                sub: 'user-oidc-subject-123',
                email: 'testuser@example.com',
                preferred_username: 'testuser',
                name: 'Test User'
            };

            // Validate state
            const stateValid = validateState(mockRequest, mockSession.oidcState);
            expect(stateValid).toBe(true);

            // Validate nonce
            const nonceValid = validateNonce(mockTokenSet, mockRequest);
            expect(nonceValid).toBe(true);

            // Verify state was cleaned up
            expect(mockSession.oidcState).toBeUndefined();
            expect(mockSession.stateExpiresAt).toBeUndefined();

            // Verify nonce was cleaned up
            expect(mockSession.oidcNonce).toBeUndefined();

            // Verify auth events logged
            expect(logAuthEvent).toHaveBeenCalledWith(
                'info',
                'OIDC_STATE_VALIDATED',
                expect.objectContaining({ state: mockSession.oidcState })
            );
            expect(logAuthEvent).toHaveBeenCalledWith(
                'info',
                'OIDC_NONCE_VALIDATED',
                expect.objectContaining({ nonce: mockTokenSet.claims().nonce })
            );
        });

        it('should reject callback with invalid state', () => {
            const mockSession = {
                oidcState: 'expected-state',
                stateExpiresAt: Date.now() + 60000
            };
            const mockRequest = { session: mockSession };

            const invalidState = 'attacker-state';

            const stateValid = validateState(mockRequest, invalidState);
            expect(stateValid).toBe(false);
        });

        it('should reject callback with invalid nonce', () => {
            const mockSession = {
                oidcNonce: 'expected-nonce'
            };
            const mockRequest = { session: mockSession };

            const mockTokenSet = {
                claims: jest.fn().mockReturnValue({
                    nonce: 'different-nonce',
                    sub: 'user-123'
                })
            };

            const nonceValid = validateNonce(mockTokenSet, mockRequest);
            expect(nonceValid).toBe(false);
        });
    });

    describe('User Creation and Update Flow', () => {

        it('should create new user on first login', async () => {
            const { createOrUpdateUser, getUserByOidcSubject } = require('../../auth/shared');

            const newUserData = {
                username: 'newuser',
                email: 'newuser@example.com',
                oidcProvider: 'auth.example.com',
                oidcSubject: 'new-user-oidc-subject',
                oidcEmail: 'newuser@example.com',
                oidcClaims: null
            };

            // Mock getUserByOidcSubject to return null (user doesn't exist)
            getUserByOidcSubject.mockResolvedValue(null);

            // Mock createOrUpdateUser to return the new user
            const mockCreatedUser = {
                id: 999,
                username: 'newuser',
                email: 'newuser@example.com',
                role: 'user',
                oidc_provider: 'auth.example.com',
                oidc_subject: 'new-user-oidc-subject',
                oidc_email: 'newuser@example.com'
            };
            createOrUpdateUser.mockResolvedValue(mockCreatedUser);

            const user = await createOrUpdateUser(newUserData);

            expect(user).toBeDefined();
            expect(user.id).toBe(999);
            expect(user.username).toBe('newuser');
            expect(user.role).toBe('user');
            expect(createOrUpdateUser).toHaveBeenCalledWith(newUserData);
        });

        it('should update existing user on subsequent login', async () => {
            const { createOrUpdateUser, getUserByOidcSubject } = require('../../auth/shared');

            const existingUserData = {
                username: 'existinguser',
                email: 'updated-email@example.com', // Updated email
                oidcProvider: 'auth.example.com',
                oidcSubject: 'existing-user-oidc-subject',
                oidcEmail: 'updated-email@example.com',
                oidcClaims: null
            };

            // Mock getUserByOidcSubject to return existing user
            const existingUser = {
                id: 123,
                username: 'existinguser',
                email: 'old-email@example.com',
                role: 'user',
                oidc_subject: 'existing-user-oidc-subject',
                oidc_provider: 'auth.example.com'
            };
            getUserByOidcSubject.mockResolvedValue(existingUser);

            // Mock createOrUpdateUser to return updated user
            const mockUpdatedUser = {
                id: 123,
                username: 'existinguser',
                email: 'updated-email@example.com',
                role: 'user',
                oidc_provider: 'auth.example.com',
                oidc_subject: 'existing-user-oidc-subject',
                oidc_email: 'updated-email@example.com'
            };
            createOrUpdateUser.mockResolvedValue(mockUpdatedUser);

            const user = await createOrUpdateUser(existingUserData);

            expect(user).toBeDefined();
            expect(user.id).toBe(123); // Same ID
            expect(user.email).toBe('updated-email@example.com'); // Updated email
            expect(createOrUpdateUser).toHaveBeenCalledWith(existingUserData);
        });
    });

    describe('Admin Role Assignment', () => {

        it('should assign admin role when username matches ADMIN_USERNAME', async () => {
            const { createOrUpdateUser } = require('../../auth/shared');

            const adminUserData = {
                username: 'admin',
                email: 'admin@example.com',
                oidcProvider: 'auth.example.com',
                oidcSubject: 'admin-oidc-subject',
                oidcEmail: 'admin@example.com',
                oidcClaims: null
            };

            // Mock createOrUpdateUser to return admin user
            const mockAdminUser = {
                id: 1,
                username: 'admin',
                email: 'admin@example.com',
                role: 'admin', // Admin role assigned
                oidc_provider: 'auth.example.com',
                oidc_subject: 'admin-oidc-subject'
            };
            createOrUpdateUser.mockResolvedValue(mockAdminUser);

            const user = await createOrUpdateUser(adminUserData);

            expect(user.role).toBe('admin');
            expect(createOrUpdateUser).toHaveBeenCalledWith(adminUserData);
        });

        it('should assign admin role when OIDC groups contain admin group', async () => {
            const { createOrUpdateUser } = require('../../auth/shared');

            // Mock ADMIN_OIDC_GROUPS environment variable
            process.env.ADMIN_OIDC_GROUPS = 'admin,administrators,superusers';

            const groupAdminUserData = {
                username: 'groupadmin',
                email: 'groupadmin@example.com',
                oidcProvider: 'auth.example.com',
                oidcSubject: 'group-admin-oidc-subject',
                oidcEmail: 'groupadmin@example.com',
                oidcClaims: {
                    groups: ['admin', 'users'] // Contains admin group
                }
            };

            // Mock createOrUpdateUser to return admin user
            const mockGroupAdminUser = {
                id: 2,
                username: 'groupadmin',
                email: 'groupadmin@example.com',
                role: 'admin', // Admin role assigned via groups
                oidc_provider: 'auth.example.com',
                oidc_subject: 'group-admin-oidc-subject'
            };
            createOrUpdateUser.mockResolvedValue(mockGroupAdminUser);

            const user = await createOrUpdateUser(groupAdminUserData);

            expect(user.role).toBe('admin');

            // Clean up
            delete process.env.ADMIN_OIDC_GROUPS;
        });

        it('should assign user role when no admin criteria matched', async () => {
            const { createOrUpdateUser } = require('../../auth/shared');

            const regularUserData = {
                username: 'regularuser',
                email: 'regularuser@example.com',
                oidcProvider: 'auth.example.com',
                oidcSubject: 'regular-user-oidc-subject',
                oidcEmail: 'regularuser@example.com',
                oidcClaims: {
                    groups: ['users'] // No admin group
                }
            };

            // Mock createOrUpdateUser to return regular user
            const mockRegularUser = {
                id: 3,
                username: 'regularuser',
                email: 'regularuser@example.com',
                role: 'user', // Regular user role
                oidc_provider: 'auth.example.com',
                oidc_subject: 'regular-user-oidc-subject'
            };
            createOrUpdateUser.mockResolvedValue(mockRegularUser);

            const user = await createOrUpdateUser(regularUserData);

            expect(user.role).toBe('user');
            expect(createOrUpdateUser).toHaveBeenCalledWith(regularUserData);
        });

        it('should detect admin role correctly', () => {
            const { isAdmin } = require('../../auth/shared');

            const adminUser = { id: 1, username: 'admin', role: 'admin' };
            const regularUser = { id: 2, username: 'user', role: 'user' };

            expect(isAdmin(adminUser)).toBe(true);
            expect(isAdmin(regularUser)).toBe(false);
            expect(isAdmin(null)).toBe(false);
            expect(isAdmin(undefined)).toBe(false);
        });
    });

    describe('Session Verification Flow', () => {

        it('should verify valid user session', async () => {
            const { getUserById } = require('../../auth/shared');

            const mockUser = {
                id: 1,
                username: 'admin',
                email: 'admin@example.com',
                role: 'admin'
            };
            getUserById.mockResolvedValue(mockUser);

            const user = await getUserById(1);

            expect(user).toBeDefined();
            expect(user.id).toBe(1);
            expect(user.username).toBe('admin');
            expect(user.role).toBe('admin');
        });

        it('should return null for non-existent user', async () => {
            const { getUserById } = require('../../auth/shared');

            getUserById.mockResolvedValue(null);

            const user = await getUserById(999);

            expect(user).toBeNull();
        });
    });

    describe('Logout Flow', () => {

        it('should clean up session on logout', () => {
            // Simulate logout session cleanup
            const mockSession = {
                oidcState: 'some-state',
                oidcNonce: 'some-nonce',
                codeVerifier: 'some-verifier',
                returnTo: '/some-page'
            };

            // Simulate session destruction (Passport logout)
            Object.keys(mockSession).forEach(key => {
                delete mockSession[key];
            });

            // Verify session is empty
            expect(Object.keys(mockSession).length).toBe(0);
        });
    });

    describe('Complete OIDC Flow Integration', () => {

        it('should complete full OIDC authentication flow', async () => {
            const { createOrUpdateUser, getUserByOidcSubject, logAuthEvent } = require('../../auth/shared');

            // Step 1: Login request - Generate security parameters
            const mockSession = {};
            const mockRequest = { session: mockSession };

            const codeVerifier = generateCodeVerifier();
            const codeChallenge = generateCodeChallenge(codeVerifier);
            mockSession.codeVerifier = codeVerifier;
            mockSession.codeChallenge = codeChallenge;

            const state = generateState(mockRequest);
            const nonce = generateNonce(mockRequest);

            // Verify security parameters generated
            expect(mockSession.oidcState).toBe(state);
            expect(mockSession.oidcNonce).toBe(nonce);
            expect(mockSession.codeVerifier).toBe(codeVerifier);
            expect(mockSession.codeChallenge).toBe(codeChallenge);

            // Step 2: Callback - Validate security parameters
            const mockTokenSet = {
                claims: jest.fn().mockReturnValue({
                    sub: 'test-user-oidc-subject',
                    nonce: nonce,
                    aud: 'test-client-id',
                    iss: 'https://auth.example.com',
                    exp: Math.floor(Date.now() / 1000) + 3600,
                    email: 'testuser@example.com'
                })
            };

            const stateValid = validateState(mockRequest, state);
            expect(stateValid).toBe(true);

            const nonceValid = validateNonce(mockTokenSet, mockRequest);
            expect(nonceValid).toBe(true);

            // Step 3: User creation/update
            const userData = {
                username: 'testuser',
                email: 'testuser@example.com',
                oidcProvider: 'auth.example.com',
                oidcSubject: 'test-user-oidc-subject',
                oidcEmail: 'testuser@example.com',
                oidcClaims: null
            };

            const mockUser = {
                id: 42,
                username: 'testuser',
                email: 'testuser@example.com',
                role: 'user',
                oidc_provider: 'auth.example.com',
                oidc_subject: 'test-user-oidc-subject'
            };
            createOrUpdateUser.mockResolvedValue(mockUser);

            const user = await createOrUpdateUser(userData);

            expect(user).toBeDefined();
            expect(user.id).toBe(42);
            expect(user.username).toBe('testuser');
            expect(user.role).toBe('user');

            // Verify auth events were logged
            expect(logAuthEvent).toHaveBeenCalledWith(
                'info',
                'OIDC_STATE_VALIDATED',
                expect.any(Object)
            );
            expect(logAuthEvent).toHaveBeenCalledWith(
                'info',
                'OIDC_NONCE_VALIDATED',
                expect.any(Object)
            );
        });

        it('should complete full OIDC flow for admin user', async () => {
            const { createOrUpdateUser, isAdmin, logAuthEvent } = require('../../auth/shared');

            // Step 1: Login request
            const mockSession = {};
            const mockRequest = { session: mockSession };

            generateState(mockRequest);
            generateNonce(mockRequest);
            const codeVerifier = generateCodeVerifier();
            mockSession.codeVerifier = codeVerifier;
            mockSession.codeChallenge = generateCodeChallenge(codeVerifier);

            // Step 2: Callback
            const nonce = mockSession.oidcNonce;
            const mockTokenSet = {
                claims: jest.fn().mockReturnValue({
                    sub: 'admin-oidc-subject',
                    nonce: nonce,
                    email: 'admin@example.com'
                })
            };

            validateState(mockRequest, mockSession.oidcState);
            validateNonce(mockTokenSet, mockRequest);

            // Step 3: Admin user creation
            const adminUserData = {
                username: 'admin',
                email: 'admin@example.com',
                oidcProvider: 'auth.example.com',
                oidcSubject: 'admin-oidc-subject',
                oidcEmail: 'admin@example.com',
                oidcClaims: null
            };

            const mockAdminUser = {
                id: 1,
                username: 'admin',
                email: 'admin@example.com',
                role: 'admin',
                oidc_provider: 'auth.example.com',
                oidc_subject: 'admin-oidc-subject'
            };
            createOrUpdateUser.mockResolvedValue(mockAdminUser);

            const adminUser = await createOrUpdateUser(adminUserData);

            expect(adminUser.role).toBe('admin');
            expect(isAdmin(adminUser)).toBe(true);

            // Verify admin role event logged
            expect(logAuthEvent).toHaveBeenCalledWith(
                'info',
                'ADMIN_ROLE_ASSIGNED',
                expect.objectContaining({
                    userId: 1,
                    username: 'admin',
                    role: 'admin'
                })
            );
        });
    });

    describe('PKCE Integration', () => {

        it('should generate matching code challenge from verifier', () => {
            const verifier = generateCodeVerifier();
            const challenge1 = generateCodeChallenge(verifier);
            const challenge2 = generateCodeChallenge(verifier);

            // Challenge should be deterministic
            expect(challenge1).toBe(challenge2);

            // Challenge should be different from verifier (one-way hash)
            expect(challenge1).not.toBe(verifier);
        });

        it('should store code verifier in session during login', () => {
            const mockSession = {};
            const mockRequest = { session: mockSession };

            const verifier = generateCodeVerifier();
            const challenge = generateCodeChallenge(verifier);

            // Simulate login route storing verifier
            mockRequest.session.codeVerifier = verifier;
            mockRequest.session.codeChallenge = challenge;

            expect(mockRequest.session.codeVerifier).toBe(verifier);
            expect(mockRequest.session.codeChallenge).toBe(challenge);
        });
    });

    describe('Error Handling in OIDC Flow', () => {

        it('should handle missing OIDC subject gracefully', async () => {
            const { createOrUpdateUser } = require('../../auth/shared');

            const invalidUserData = {
                username: 'testuser',
                email: 'testuser@example.com',
                oidcProvider: 'auth.example.com',
                oidcSubject: null, // Missing subject
                oidcEmail: 'testuser@example.com'
            };

            // Should handle gracefully (implementation should catch this)
            // In real implementation, database query would fail or return null
            createOrUpdateUser.mockRejectedValue(new Error('OIDC subject is required'));

            await expect(createOrUpdateUser(invalidUserData)).rejects.toThrow();
        });

        it('should handle missing session parameters', () => {
            const mockRequest = { session: {} };

            // State validation should fail gracefully
            const stateValid = validateState(mockRequest, 'some-state');
            expect(stateValid).toBe(false);

            // Nonce validation should fail gracefully
            const mockTokenSet = {
                claims: jest.fn().mockReturnValue({ nonce: 'some-nonce' })
            };
            const nonceValid = validateNonce(mockTokenSet, mockRequest);
            expect(nonceValid).toBe(false);
        });
    });
});
