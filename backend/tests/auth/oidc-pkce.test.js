// backend/tests/auth/oidc-pkce.test.js
/**
 * Tests for PKCE (Proof Key for Code Exchange) implementation
 * Tests code verifier and challenge generation for OIDC security
 *
 * PKCE prevents authorization code interception attacks
 */

const {
    generateCodeVerifier,
    generateCodeChallenge,
    validateCodeChallenge
} = require('../../auth/oidc/index.js');

// Mock the shared auth module for logging
jest.mock('../../auth/shared', () => ({
    logAuthEvent: jest.fn()
}));

describe('PKCE Implementation', () => {

    describe('generateCodeVerifier', () => {

        it('should generate a 43-character base64url string', () => {
            const verifier = generateCodeVerifier();

            expect(verifier).toBeDefined();
            expect(typeof verifier).toBe('string');
            expect(verifier.length).toBe(43);
        });

        it('should generate different values on each call', () => {
            const verifier1 = generateCodeVerifier();
            const verifier2 = generateCodeVerifier();

            expect(verifier1).not.toBe(verifier2);
        });

        it('should only contain base64url-safe characters', () => {
            const verifier = generateCodeVerifier();

            // base64url uses A-Z, a-z, 0-9, -, and _
            expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
        });

        it('should generate a cryptographically random string', () => {
            const verifiers = new Set();

            // Generate 100 verifiers and check for duplicates
            for (let i = 0; i < 100; i++) {
                verifiers.add(generateCodeVerifier());
            }

            // Should have 100 unique values (no collisions)
            expect(verifiers.size).toBe(100);
        });

        it('should be reproducible for testing (mock verification)', () => {
            // This test verifies the function is deterministic in its randomness
            const verifier = generateCodeVerifier();

            expect(verifier).toBeTruthy();
            expect(verifier.length).toBeGreaterThan(0);
        });
    });

    describe('generateCodeChallenge', () => {

        it('should generate a challenge from a verifier', () => {
            const verifier = generateCodeVerifier();
            const challenge = generateCodeChallenge(verifier);

            expect(challenge).toBeDefined();
            expect(typeof challenge).toBe('string');
        });

        it('should generate a 43-character base64url challenge', () => {
            const verifier = generateCodeVerifier();
            const challenge = generateCodeChallenge(verifier);

            expect(challenge.length).toBe(43);
            expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
        });

        it('should generate the same challenge for the same verifier', () => {
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

        it('should produce a SHA256 hash of the verifier', () => {
            const crypto = require('crypto');
            const verifier = generateCodeVerifier();
            const challenge = generateCodeChallenge(verifier);

            // Verify the challenge is the SHA256 hash in base64url format
            const expectedHash = crypto.createHash('sha256')
                .update(verifier)
                .digest('base64url');

            expect(challenge).toBe(expectedHash);
        });
    });

    describe('validateCodeChallenge', () => {

        it('should return null when codeVerifier is null', () => {
            const result = validateCodeChallenge(null);

            expect(result).toBeNull();
        });

        it('should return null when codeVerifier is undefined', () => {
            const result = validateCodeChallenge(undefined);

            expect(result).toBeNull();
        });

        it('should return null when codeVerifier is empty string', () => {
            const result = validateCodeChallenge('');

            expect(result).toBeNull();
        });

        it('should generate a valid challenge from a code verifier', () => {
            const verifier = generateCodeVerifier();
            const result = validateCodeChallenge(verifier);

            expect(result).toBeDefined();
            expect(typeof result).toBe('string');
            expect(result.length).toBe(43);
        });

        it('should generate a challenge that matches direct generation', () => {
            const verifier = generateCodeVerifier();
            const validatedChallenge = validateCodeChallenge(verifier);
            const directChallenge = generateCodeChallenge(verifier);

            expect(validatedChallenge).toBe(directChallenge);
        });

        it('should log auth event on successful validation', () => {
            const { logAuthEvent } = require('../../auth/shared');
            const verifier = generateCodeVerifier();

            validateCodeChallenge(verifier);

            expect(logAuthEvent).toHaveBeenCalledWith(
                'info',
                'OIDC_PKCE_CHALLENGE_GENERATED',
                expect.objectContaining({
                    verifierLength: verifier.length,
                    challengeLength: 43
                })
            );
        });

        it('should log auth event on missing verifier', () => {
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

        it('should handle long verifiers correctly', () => {
            // Generate a verifier (should be 43 chars)
            const verifier = generateCodeVerifier();
            const result = validateCodeChallenge(verifier);

            expect(result).toBeDefined();
            expect(result.length).toBe(43);
        });
    });

    describe('PKCE Integration', () => {

        it('should complete full PKCE flow: verifier -> challenge -> validate', () => {
            // Step 1: Generate code verifier
            const verifier = generateCodeVerifier();
            expect(verifier).toBeDefined();
            expect(verifier.length).toBe(43);

            // Step 2: Generate code challenge
            const challenge = generateCodeChallenge(verifier);
            expect(challenge).toBeDefined();
            expect(challenge.length).toBe(43);

            // Step 3: Validate code challenge
            const validatedChallenge = validateCodeChallenge(verifier);
            expect(validatedChallenge).toBe(challenge);
        });

        it('should support multiple concurrent PKCE flows', () => {
            const flows = [];

            // Simulate 10 concurrent authentication flows
            for (let i = 0; i < 10; i++) {
                const verifier = generateCodeVerifier();
                const challenge = generateCodeChallenge(verifier);
                const validatedChallenge = validateCodeChallenge(verifier);

                flows.push({
                    verifier,
                    challenge,
                    validatedChallenge
                });
            }

            // Verify all flows are unique
            const verifiers = new Set(flows.map(f => f.verifier));
            const challenges = new Set(flows.map(f => f.challenge));

            expect(verifiers.size).toBe(10);
            expect(challenges.size).toBe(10);

            // Verify all validations match
            flows.forEach(flow => {
                expect(flow.validatedChallenge).toBe(flow.challenge);
            });
        });
    });
});
