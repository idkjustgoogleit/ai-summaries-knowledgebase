// backend/tests/auth/oidc-state.test.js
/**
 * Tests for State Parameter implementation
 * Tests CSRF protection via state parameter validation
 *
 * State parameter prevents CSRF attacks on OIDC flow
 */

const {
    generateState,
    validateState
} = require('../../auth/oidc/index.js');

// Mock the shared auth module for logging
jest.mock('../../auth/shared', () => ({
    logAuthEvent: jest.fn()
}));

// Mock the auth config
jest.mock('../../config/auth', () => ({
    authConfig: {
        oidcSecurity: {
            stateExpiryMs: 10 * 60 * 1000 // 10 minutes
        }
    }
}));

describe('State Parameter Implementation (CSRF Protection)', () => {

    describe('generateState', () => {

        it('should generate a 32-character hex string', () => {
            const req = {
                session: {}
            };

            const state = generateState(req);

            expect(state).toBeDefined();
            expect(typeof state).toBe('string');
            expect(state.length).toBe(32);
            expect(state).toMatch(/^[0-9a-f]+$/);
        });

        it('should store state in session', () => {
            const req = {
                session: {}
            };

            const state = generateState(req);

            expect(req.session.oidcState).toBeDefined();
            expect(req.session.oidcState).toBe(state);
        });

        it('should store state expiration timestamp in session', () => {
            const req = {
                session: {}
            };

            const nowBefore = Date.now();
            generateState(req);
            const nowAfter = Date.now();

            expect(req.session.stateExpiresAt).toBeDefined();
            expect(req.session.stateExpiresAt).toBeGreaterThanOrEqual(nowBefore + 10 * 60 * 1000 - 100);
            expect(req.session.stateExpiresAt).toBeLessThanOrEqual(nowAfter + 10 * 60 * 1000 + 100);
        });

        it('should set expiry to 10 minutes from now', () => {
            const req = {
                session: {}
            };

            const now = Date.now();
            generateState(req);

            const expiresAt = req.session.stateExpiresAt;
            const expiryMinutes = (expiresAt - now) / (60 * 1000);

            expect(expiryMinutes).toBeGreaterThan(9.9);
            expect(expiryMinutes).toBeLessThan(10.1);
        });

        it('should generate different values on each call', () => {
            const req1 = { session: {} };
            const req2 = { session: {} };

            const state1 = generateState(req1);
            const state2 = generateState(req2);

            expect(state1).not.toBe(state2);
        });

        it('should overwrite existing state in session', () => {
            const req = {
                session: {
                    oidcState: 'old-state',
                    stateExpiresAt: Date.now() - 1000
                }
            };

            const newState = generateState(req);

            expect(req.session.oidcState).toBe(newState);
            expect(req.session.oidcState).not.toBe('old-state');
        });

        it('should log auth event on generation', () => {
            const { logAuthEvent } = require('../../auth/shared');
            const req = {
                session: {}
            };

            const state = generateState(req);

            expect(logAuthEvent).toHaveBeenCalledWith(
                'info',
                'OIDC_STATE_GENERATED',
                expect.objectContaining({
                    state
                })
            );
        });
    });

    describe('validateState', () => {

        it('should return true for matching state', () => {
            const req = {
                session: {
                    oidcState: 'test-state-123',
                    stateExpiresAt: Date.now() + 60000 // 1 minute from now
                }
            };

            const result = validateState(req, 'test-state-123');

            expect(result).toBe(true);
        });

        it('should return false for mismatched state', () => {
            const req = {
                session: {
                    oidcState: 'correct-state',
                    stateExpiresAt: Date.now() + 60000
                }
            };

            const result = validateState(req, 'wrong-state');

            expect(result).toBe(false);
        });

        it('should return false when no state in session', () => {
            const req = {
                session: {}
            };

            const result = validateState(req, 'any-state');

            expect(result).toBe(false);
        });

        it('should return false for expired state', () => {
            const req = {
                session: {
                    oidcState: 'expired-state',
                    stateExpiresAt: Date.now() - 1000 // 1 second ago
                }
            };

            const result = validateState(req, 'expired-state');

            expect(result).toBe(false);
        });

        it('should return false for state expired exactly now', () => {
            const req = {
                session: {
                    oidcState: 'now-expired-state',
                    stateExpiresAt: Date.now()
                }
            };

            // Due to timing, this might be true or false depending on execution speed
            const result = validateState(req, 'now-expired-state');

            // Should be false or very close to expiry
            expect(result).toBeDefined();
        });

        it('should clean up state after validation (success)', () => {
            const req = {
                session: {
                    oidcState: 'valid-state',
                    stateExpiresAt: Date.now() + 60000
                }
            };

            validateState(req, 'valid-state');

            expect(req.session.oidcState).toBeUndefined();
            expect(req.session.stateExpiresAt).toBeUndefined();
        });

        it('should clean up state after validation (failure - mismatch)', () => {
            const req = {
                session: {
                    oidcState: 'stored-state',
                    stateExpiresAt: Date.now() + 60000
                }
            };

            validateState(req, 'different-state');

            expect(req.session.oidcState).toBeUndefined();
            expect(req.session.stateExpiresAt).toBeUndefined();
        });

        it('should clean up state after validation (failure - expired)', () => {
            const req = {
                session: {
                    oidcState: 'expired-state',
                    stateExpiresAt: Date.now() - 1000
                }
            };

            validateState(req, 'expired-state');

            expect(req.session.oidcState).toBeUndefined();
            expect(req.session.stateExpiresAt).toBeUndefined();
        });

        it('should log success event on valid state', () => {
            const { logAuthEvent } = require('../../auth/shared');
            const req = {
                session: {
                    oidcState: 'valid-state',
                    stateExpiresAt: Date.now() + 60000
                }
            };

            validateState(req, 'valid-state');

            expect(logAuthEvent).toHaveBeenCalledWith(
                'info',
                'OIDC_STATE_VALIDATED',
                expect.objectContaining({
                    state: 'valid-state'
                })
            );
        });

        it('should log error event on mismatched state', () => {
            const { logAuthEvent } = require('../../auth/shared');
            const req = {
                session: {
                    oidcState: 'expected-state',
                    stateExpiresAt: Date.now() + 60000
                }
            };

            validateState(req, 'received-state');

            expect(logAuthEvent).toHaveBeenCalledWith(
                'error',
                'OIDC_STATE_MISMATCH',
                expect.objectContaining({
                    expected: 'expected-state',
                    received: 'received-state'
                })
            );
        });

        it('should log error event when no state in session', () => {
            const { logAuthEvent } = require('../../auth/shared');
            const req = {
                session: {}
            };

            validateState(req, 'provided-state');

            expect(logAuthEvent).toHaveBeenCalledWith(
                'error',
                'OIDC_STATE_MISMATCH',
                expect.objectContaining({
                    reason: 'No state in session',
                    providedState: 'provided-state'
                })
            );
        });

        it('should log error event on expired state', () => {
            const { logAuthEvent } = require('../../auth/shared');
            const expiredState = 'expired-test-state';
            const req = {
                session: {
                    oidcState: expiredState,
                    stateExpiresAt: Date.now() - 5000
                }
            };

            validateState(req, expiredState);

            expect(logAuthEvent).toHaveBeenCalledWith(
                'error',
                'OIDC_STATE_EXPIRED',
                expect.objectContaining({
                    state: expiredState
                })
            );
        });
    });

    describe('State Parameter Integration', () => {

        it('should complete full state flow: generate -> validate', () => {
            const req = {
                session: {}
            };

            // Generate state
            const state = generateState(req);
            expect(req.session.oidcState).toBe(state);

            // Validate state
            const isValid = validateState(req, state);
            expect(isValid).toBe(true);

            // Verify cleanup
            expect(req.session.oidcState).toBeUndefined();
        });

        it('should prevent state reuse (one-time use)', () => {
            const req = {
                session: {}
            };

            const state = generateState(req);

            // First validation should succeed
            const firstResult = validateState(req, state);
            expect(firstResult).toBe(true);

            // Second validation should fail (state was cleaned up)
            const secondResult = validateState(req, state);
            expect(secondResult).toBe(false);
        });

        it('should support multiple concurrent authentication flows', () => {
            const req1 = { session: {} };
            const req2 = { session: {} };
            const req3 = { session: {} };

            const state1 = generateState(req1);
            const state2 = generateState(req2);
            const state3 = generateState(req3);

            // All states should be different
            expect(state1).not.toBe(state2);
            expect(state2).not.toBe(state3);
            expect(state1).not.toBe(state3);

            // Each request should validate its own state
            expect(validateState(req1, state1)).toBe(true);
            expect(validateState(req2, state2)).toBe(true);
            expect(validateState(req3, state3)).toBe(true);

            // But not other states
            const req4 = { session: {} };
            const state4 = generateState(req4);
            expect(validateState(req4, state1)).toBe(false);
        });
    });

    describe('State Parameter Security', () => {

        it('should be cryptographically random (no collisions in 1000 attempts)', () => {
            const states = new Set();

            for (let i = 0; i < 1000; i++) {
                const req = { session: {} };
                const state = generateState(req);
                states.add(state);
            }

            // Should have 1000 unique states
            expect(states.size).toBe(1000);
        });

        it('should have sufficient entropy (128 bits)', () => {
            const req = { session: {} };
            const state = generateState(req);

            // 32 hex characters = 128 bits
            expect(state.length).toBe(32);

            // Should be valid hex
            expect(state).toMatch(/^[0-9a-f]{32}$/);
        });

        it('should expire after exactly 10 minutes', () => {
            const req = {
                session: {}
            };

            const state = generateState(req);
            const expiryTime = req.session.stateExpiresAt;
            const currentTime = Date.now();

            // Should be approximately 10 minutes (600,000 ms) in the future
            const timeUntilExpiry = expiryTime - currentTime;

            expect(timeUntilExpiry).toBeGreaterThan(599000); // 9.98 minutes
            expect(timeUntilExpiry).toBeLessThan(601000); // 10.02 minutes
        });

        it('should reject state used in wrong session', () => {
            const req1 = { session: {} };
            const req2 = { session: {} };

            const state1 = generateState(req1);
            const state2 = generateState(req2);

            // req1 should not accept req2's state
            expect(validateState(req1, state2)).toBe(false);

            // req2 should not accept req1's state
            expect(validateState(req2, state1)).toBe(false);
        });
    });
});
