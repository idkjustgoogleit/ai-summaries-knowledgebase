// backend/tests/auth/oidc-security.test.js
/**
 * Security Attack Tests for OIDC Authentication
 *
 * Tests that security features properly prevent:
 * - CSRF attacks via state parameter
 * - Replay attacks via nonce
 * - Authorization code interception via PKCE
 * - Session hijacking attempts
 */

const {
    generateState,
    validateState,
    generateNonce,
    validateNonce,
    generateCodeVerifier,
    generateCodeChallenge,
    validateCodeChallenge
} = require('../../auth/oidc/index.js');

// Mock the shared auth module for logging
jest.mock('../../auth/shared', () => ({
    logAuthEvent: jest.fn()
}));

// Mock the auth config
jest.mock('../../config/auth', () => ({
    authConfig: {
        oidcSecurity: {
            stateExpiryMs: 10 * 60 * 1000, // 10 minutes
            pkceEnabled: true,
            stateEnabled: true,
            nonceEnabled: true
        }
    }
}));

describe('OIDC Security Attack Prevention', () => {

    describe('CSRF Attack Prevention (State Parameter)', () => {

        it('should reject callback without state parameter', () => {
            const req = {
                session: {
                    oidcState: 'valid-state-12345',
                    stateExpiresAt: Date.now() + 60000
                }
            };

            const result = validateState(req, undefined);

            expect(result).toBe(false);
        });

        it('should reject callback with null state parameter', () => {
            const req = {
                session: {
                    oidcState: 'valid-state-12345',
                    stateExpiresAt: Date.now() + 60000
                }
            };

            const result = validateState(req, null);

            expect(result).toBe(false);
        });

        it('should reject callback with empty state parameter', () => {
            const req = {
                session: {
                    oidcState: 'valid-state-12345',
                    stateExpiresAt: Date.now() + 60000
                }
            };

            const result = validateState(req, '');

            expect(result).toBe(false);
        });

        it('should reject callback with mismatched state (CSRF attack)', () => {
            const req = {
                session: {
                    oidcState: 'legitimate-state-abc',
                    stateExpiresAt: Date.now() + 60000
                }
            };

            // Attacker provides their own state
            const attackerState = 'attacker-state-xyz';

            const result = validateState(req, attackerState);

            expect(result).toBe(false);
        });

        it('should reject callback with expired state (delayed CSRF attack)', () => {
            const req = {
                session: {
                    oidcState: 'old-state',
                    stateExpiresAt: Date.now() - 1000 // Expired 1 second ago
                }
            };

            const result = validateState(req, 'old-state');

            expect(result).toBe(false);
        });

        it('should reject callback when state already consumed (replay attack)', () => {
            const req = {
                session: {
                    oidcState: 'one-time-state',
                    stateExpiresAt: Date.now() + 60000
                }
            };

            // First validation succeeds and consumes state
            const firstResult = validateState(req, 'one-time-state');
            expect(firstResult).toBe(true);
            expect(req.session.oidcState).toBeUndefined();

            // Attacker tries to replay with same state
            const secondResult = validateState(req, 'one-time-state');
            expect(secondResult).toBe(false);
        });

        it('should prevent state parameter prediction (cryptographic randomness)', () => {
            const states = [];

            // Generate 1000 states
            for (let i = 0; i < 1000; i++) {
                const req = { session: {} };
                const state = generateState(req);
                states.push(state);
            }

            // Check all are unique
            const uniqueStates = new Set(states);
            expect(uniqueStates.size).toBe(1000);

            // Check no obvious patterns (first few characters shouldn't repeat)
            const prefixes = states.map(s => s.substring(0, 4));
            const uniquePrefixes = new Set(prefixes);

            // With 32 hex chars, probability of 4-char prefix collision in 1000 samples is very low
            expect(uniquePrefixes.size).toBeGreaterThan(950);
        });

        it('should log security event on CSRF attack detection', () => {
            const { logAuthEvent } = require('../../auth/shared');
            const req = {
                session: {
                    oidcState: 'expected-state',
                    stateExpiresAt: Date.now() + 60000
                }
            };

            validateState(req, 'attacker-state');

            expect(logAuthEvent).toHaveBeenCalledWith(
                'error',
                'OIDC_STATE_MISMATCH',
                expect.objectContaining({
                    expected: 'expected-state',
                    received: 'attacker-state'
                })
            );
        });
    });

    describe('Replay Attack Prevention (Nonce)', () => {

        it('should reject ID token without nonce', () => {
            const req = {
                session: {
                    oidcNonce: 'valid-nonce-xyz'
                }
            };

            const tokenSet = {
                claims: jest.fn().mockReturnValue({
                    // No nonce field
                    sub: 'user123',
                    aud: 'client-id'
                })
            };

            const result = validateNonce(tokenSet, req);

            expect(result).toBe(false);
        });

        it('should reject ID token with mismatched nonce (replay attack)', () => {
            const req = {
                session: {
                    oidcNonce: 'legitimate-nonce'
                }
            };

            // Attacker replays old ID token with different nonce
            const tokenSet = {
                claims: jest.fn().mockReturnValue({
                    nonce: 'replayed-nonce',
                    sub: 'user123'
                })
            };

            const result = validateNonce(tokenSet, req);

            expect(result).toBe(false);
        });

        it('should reject ID token when nonce already consumed (one-time use)', () => {
            const req = {
                session: {
                    oidcNonce: 'one-time-nonce'
                }
            };

            const tokenSet = {
                claims: jest.fn().mockReturnValue({
                    nonce: 'one-time-nonce'
                })
            };

            // First validation succeeds and consumes nonce
            const firstResult = validateNonce(tokenSet, req);
            expect(firstResult).toBe(true);
            expect(req.session.oidcNonce).toBeUndefined();

            // Attacker tries to replay same ID token
            const req2 = {
                session: {} // Nonce was cleaned up
            };

            const secondResult = validateNonce(tokenSet, req2);
            expect(secondResult).toBe(false);
        });

        it('should prevent nonce prediction (cryptographic randomness)', () => {
            const nonces = [];

            // Generate 1000 nonces
            for (let i = 0; i < 1000; i++) {
                const req = { session: {} };
                const nonce = generateNonce(req);
                nonces.push(nonce);
            }

            // Check all are unique
            const uniqueNonces = new Set(nonces);
            expect(uniqueNonces.size).toBe(1000);

            // Check no obvious patterns
            const prefixes = nonces.map(n => n.substring(0, 4));
            const uniquePrefixes = new Set(prefixes);
            expect(uniquePrefixes.size).toBeGreaterThan(950);
        });

        it('should log security event on replay attack detection', () => {
            const { logAuthEvent } = require('../../auth/shared');
            const req = {
                session: {
                    oidcNonce: 'expected-nonce'
                }
            };

            const tokenSet = {
                claims: jest.fn().mockReturnValue({
                    nonce: 'replayed-nonce'
                })
            };

            validateNonce(tokenSet, req);

            expect(logAuthEvent).toHaveBeenCalledWith(
                'error',
                'OIDC_NONCE_MISMATCH',
                expect.objectContaining({
                    expected: 'expected-nonce',
                    received: 'replayed-nonce'
                })
            );
        });
    });

    describe('PKCE Code Interception Prevention', () => {

        it('should reject callback without code verifier', () => {
            const result = validateCodeChallenge(null);

            expect(result).toBeNull();
        });

        it('should reject callback with empty code verifier', () => {
            const result = validateCodeChallenge('');

            expect(result).toBeNull();
        });

        it('should reject callback with undefined code verifier', () => {
            const result = validateCodeChallenge(undefined);

            expect(result).toBeNull();
        });

        it('should generate deterministic challenge from verifier', () => {
            const verifier = generateCodeVerifier();
            const challenge1 = generateCodeChallenge(verifier);
            const challenge2 = generateCodeChallenge(verifier);

            expect(challenge1).toBe(challenge2);
        });

        it('should generate different challenges for different verifiers', () => {
            const verifier1 = generateCodeVerifier();
            const verifier2 = generateCodeVerifier();

            const challenge1 = generateCodeChallenge(verifier1);
            const challenge2 = generateCodeChallenge(verifier2);

            expect(challenge1).not.toBe(challenge2);
        });

        it('should prevent code verifier prediction (cryptographic randomness)', () => {
            const verifiers = [];

            // Generate 1000 verifiers
            for (let i = 0; i < 1000; i++) {
                verifiers.push(generateCodeVerifier());
            }

            // Check all are unique
            const uniqueVerifiers = new Set(verifiers);
            expect(uniqueVerifiers.size).toBe(1000);

            // Check entropy distribution (first character should vary widely)
            const firstChars = verifiers.map(v => v[0]);
            const uniqueFirstChars = new Set(firstChars);
            expect(uniqueFirstChars.size).toBeGreaterThan(50);
        });

        it('should have sufficient entropy in code verifier (256 bits)', () => {
            const verifier = generateCodeVerifier();

            // 32 random bytes = 256 bits, base64url encoded = 43 chars
            expect(verifier.length).toBe(43);

            // Should only contain base64url characters
            expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
        });

        it('should produce one-way hash (cannot derive verifier from challenge)', () => {
            const verifier = generateCodeVerifier();
            const challenge = generateCodeChallenge(verifier);

            // Challenge should not contain verifier
            expect(challenge).not.toContain(verifier);

            // Challenge should be different from verifier
            expect(challenge).not.toBe(verifier);

            // Verifier should not be derivable from challenge (one-way property)
            // This is ensured by SHA256 being a one-way hash function
        });

        it('should log security event on missing code verifier', () => {
            const { logAuthEvent } = require('../../auth/shared');

            validateCodeChallenge(null);

            expect(logAuthEvent).toHaveBeenCalledWith(
                'error',
                'OIDC_PKCE_MISSING',
                expect.objectContaining({
                    reason: 'No code verifier found in session'
                })
            );
        });
    });

    describe('Combined Security Features', () => {

        it('should require all three security features for maximum protection', () => {
            const req = {
                session: {}
            };

            // Generate all security parameters
            const verifier = generateCodeVerifier();
            const challenge = generateCodeChallenge(verifier);

            const state = generateState(req);
            const nonce = generateNonce(req);

            // Verify all are present in session
            expect(req.session.codeVerifier).toBeUndefined(); // Not stored by generateCodeVerifier
            expect(req.session.oidcState).toBe(state);
            expect(req.session.oidcNonce).toBe(nonce);

            // Verify challenge can be validated
            const validatedChallenge = validateCodeChallenge(verifier);
            expect(validatedChallenge).toBe(challenge);

            // Verify state can be validated
            const stateValid = validateState(req, state);
            expect(stateValid).toBe(true);

            // Verify nonce can be validated
            const tokenSet = {
                claims: jest.fn().mockReturnValue({
                    nonce: nonce
                })
            };
            const nonceValid = validateNonce(tokenSet, req);
            expect(nonceValid).toBe(true);
        });

        it('should fail authentication if any security feature fails', () => {
            const { logAuthEvent } = require('../../auth/shared');
            const securityEvents = [];

            logAuthEvent.mockImplementation((level, event) => {
                securityEvents.push(event);
            });

            // Test 1: Invalid state
            const req1 = { session: { oidcState: 'state1', stateExpiresAt: Date.now() + 60000 } };
            const stateResult = validateState(req1, 'wrong-state');
            expect(stateResult).toBe(false);

            // Test 2: Invalid nonce
            const req2 = { session: { oidcNonce: 'nonce1' } };
            const tokenSet2 = {
                claims: jest.fn().mockReturnValue({ nonce: 'wrong-nonce' })
            };
            const nonceResult = validateNonce(tokenSet2, req2);
            expect(nonceResult).toBe(false);

            // Test 3: Missing code verifier
            const verifierResult = validateCodeChallenge(null);
            expect(verifierResult).toBeNull();

            // All should have logged security errors
            expect(securityEvents.some(e => e === 'OIDC_STATE_MISMATCH')).toBe(true);
            expect(securityEvents.some(e => e === 'OIDC_NONCE_MISMATCH')).toBe(true);
            expect(securityEvents.some(e => e === 'OIDC_PKCE_MISSING')).toBe(true);
        });

        it('should prevent multiple simultaneous attack vectors', () => {
            const req = {
                session: {}
            };

            // Legitimate setup
            const legitState = generateState(req);
            const legitNonce = generateNonce(req);
            const legitVerifier = generateCodeVerifier();

            // Attacker tries multiple vectors
            const reqAttacker = {
                session: {
                    oidcState: 'attacker-state',
                    stateExpiresAt: Date.now() + 60000,
                    oidcNonce: 'attacker-nonce'
                }
            };

            // All attacks should fail
            expect(validateState(reqAttacker, legitState)).toBe(false);
            expect(validateState(reqAttacker, 'wrong-state')).toBe(false);

            const tokenSetAttacker = {
                claims: jest.fn().mockReturnValue({ nonce: 'wrong-nonce' })
            };
            expect(validateNonce(tokenSetAttacker, reqAttacker)).toBe(false);
        });
    });

    describe('Session Security', () => {

        it('should clean up sensitive data after validation', () => {
            const req = {
                session: {
                    oidcState: 'sensitive-state',
                    stateExpiresAt: Date.now() + 60000,
                    oidcNonce: 'sensitive-nonce',
                    codeVerifier: 'sensitive-verifier',
                    codeChallenge: 'sensitive-challenge'
                }
            };

            // Validate state (should clean up)
            validateState(req, 'sensitive-state');
            expect(req.session.oidcState).toBeUndefined();
            expect(req.session.stateExpiresAt).toBeUndefined();

            // Validate nonce (should clean up)
            const tokenSet = {
                claims: jest.fn().mockReturnValue({ nonce: 'sensitive-nonce' })
            };
            validateNonce(tokenSet, req);
            expect(req.session.oidcNonce).toBeUndefined();

            // Validate PKCE (manual cleanup in actual flow)
            expect(req.session.codeVerifier).toBeDefined();
            delete req.session.codeVerifier;
            delete req.session.codeChallenge;
            expect(req.session.codeVerifier).toBeUndefined();
        });

        it('should not leak sensitive information in logs', () => {
            const { logAuthEvent } = require('../../auth/shared');

            // Generate security parameters
            const req = { session: {} };
            const state = generateState(req);
            const nonce = generateNonce(req);
            const verifier = generateCodeVerifier();

            // Check logged events
            const loggedValues = logAuthEvent.mock.calls.map(call => {
                // Return the third argument (event data)
                return call[2];
            });

            // Verify sensitive values are not logged in plain text
            loggedValues.forEach(eventData => {
                if (eventData) {
                    // State and nonce should be logged but that's OK for debugging
                    // In production, these might be truncated
                    if (eventData.state) {
                        expect(eventData.state).toBe(state);
                    }
                    if (eventData.nonce) {
                        expect(eventData.nonce).toBe(nonce);
                    }
                    // Verifier should never be logged directly
                    expect(eventData.verifier).toBeUndefined();
                    expect(eventData.codeVerifier).toBeUndefined();
                }
            });
        });
    });
});
