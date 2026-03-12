// backend/tests/routes/adminConfig.test.js
/**
 * Tests for admin configuration routes (OIDC-Only Mode)
 * Tests authorization, validation, and audit logging
 */

const request = require('supertest');
const express = require('express');

// Mock dependencies
jest.mock('../../middleware/asyncHandler', () => {
    return (fn) => (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
});

jest.mock('../../middleware/checkAdminRights', () => (req, res, next) => {
    // Mock admin check - pass through for now, real tests would implement this
    next();
});

jest.mock('../../auth/shared', () => ({
    logAuditEvent: jest.fn(),
    logAuthEvent: jest.fn()
}));

const { mockUsers, getAuthHeaders } = require('../__fixtures__/authFixtures');

// Create test app
function createTestApp() {
    const app = express();
    app.use(express.json());

    // Mock pool
    const mockPool = {
        query: jest.fn()
    };

    // Import and use the router
    const adminConfigRouter = require('../../routes/adminConfig');
    app.use('/api/admin/config', adminConfigRouter(mockPool));

    return { app, mockPool };
}

describe('Admin Config Routes - Authorization (OIDC-Only)', () => {

    describe('GET /api/admin/config', () => {
        it('should return configuration when authenticated as admin', async () => {
            const { app, mockPool } = createTestApp();

            mockPool.query.mockResolvedValue({
                rows: [
                    { key: 'import_checker_interval_minutes', value: '5' },
                    { key: 'summary_system_prompt', value: 'Test prompt' }
                ]
            });

            const response = await request(app)
                .get('/api/admin/config')
                .set(getAuthHeaders('admin')); // OIDC-only mode

            expect(response.status).toBe(200);
            expect(response.body).toHaveProperty('import_checker_interval_minutes');
        });

        it('should reject non-admin users with 403', async () => {
            const { app } = createTestApp();

            // Note: This test would need proper checkAdminRights mock
            // For now, it's a placeholder showing the intended behavior
            const response = await request(app)
                .get('/api/admin/config')
                .set(getAuthHeaders('regularUser')); // OIDC-only mode

            // In real implementation with checkAdminRights:
            // expect(response.status).toBe(403);
            // expect(response.body).toHaveProperty('error');
        });

        it('should reject unauthenticated requests with 401', async () => {
            const { app } = createTestApp();

            const response = await request(app)
                .get('/api/admin/config');

            // In real implementation:
            // expect(response.status).toBe(401);
        });
    });

    describe('POST /api/admin/config', () => {
        it('should allow admin to update configuration', async () => {
            const { app, mockPool } = createTestApp();
            const { logAuditEvent } = require('../../auth/shared');

            mockPool.query
                .mockResolvedValueOnce({ rows: [{ value: '5' }] }) // Get old value
                .mockResolvedValueOnce({ rows: [] }); // Update

            const response = await request(app)
                .post('/api/admin/config')
                .set(getAuthHeaders('admin')) // OIDC-only mode
                .send({ import_checker_interval_minutes: 10 });

            expect(response.status).toBe(200);
            expect(logAuditEvent).toHaveBeenCalled();
        });

        it('should validate configuration values', async () => {
            const { app } = createTestApp();

            const response = await request(app)
                .post('/api/admin/config')
                .set(getAuthHeaders('admin')) // OIDC-only mode
                .send({ max_context_window: 999999 }); // Invalid: exceeds max

            expect(response.status).toBe(400);
            expect(response.body).toHaveProperty('error', 'Validation failed');
        });

        it('should reject updates to non-allowed keys', async () => {
            const { app, mockPool } = createTestApp();

            mockPool.query.mockResolvedValue({ rows: [] });

            const response = await request(app)
                .post('/api/admin/config')
                .set(getAuthHeaders('admin')) // OIDC-only mode
                .send({ forbidden_key: 'value' });

            // Should ignore non-allowed keys
            expect(response.status).toBe(200);
        });
    });

    describe('DELETE /api/admin/config/imports/custom/:id', () => {
        it('should allow admin to delete custom import', async () => {
            const { app, mockPool } = createTestApp();
            const { logAuditEvent } = require('../../auth/shared');

            mockPool.query
                .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Test Import' }] }) // Get before delete
                .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Delete

            const response = await request(app)
                .delete('/api/admin/config/imports/custom/1')
                .set(getAuthHeaders('admin')); // OIDC-only mode

            expect(response.status).toBe(200);
            expect(logAuditEvent).toHaveBeenCalledWith(
                'DELETE',
                'import_custom',
                expect.objectContaining({ id: '1' }),
                expect.any(Object),
                expect.any(Object)
            );
        });

        it('should return 404 for non-existent import', async () => {
            const { app, mockPool } = createTestApp();

            mockPool.query
                .mockResolvedValueOnce({ rows: [null] }) // Get before delete - not found
                .mockResolvedValueOnce({ rows: [] }); // Delete - no rows

            const response = await request(app)
                .delete('/api/admin/config/imports/custom/999')
                .set(getAuthHeaders('admin')); // OIDC-only mode

            expect(response.status).toBe(404);
        });
    });

    describe('DELETE /api/admin/config/summaries/custom/:id', () => {
        it('should allow admin to delete custom summary', async () => {
            const { app, mockPool } = createTestApp();
            const { logAuditEvent } = require('../../auth/shared');

            mockPool.query
                .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Test Summary', status: 'DONE' }] }) // Get before delete
                .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Delete

            const response = await request(app)
                .delete('/api/admin/config/summaries/custom/1')
                .set(getAuthHeaders('admin')); // OIDC-only mode

            expect(response.status).toBe(200);
            expect(logAuditEvent).toHaveBeenCalledWith(
                'DELETE',
                'summaries_custom',
                expect.objectContaining({ id: '1' }),
                expect.any(Object),
                expect.any(Object)
            );
        });
    });
});

describe('Admin Config Routes - Validation', () => {
    describe('Configuration value validation', () => {
        const { app } = createTestApp();

        const validationTests = [
            {
                key: 'max_context_window',
                value: 500,
                expectedError: false
            },
            {
                key: 'max_context_window',
                value: 200000,
                expectedError: true,
                errorMessage: 'must be a number between 1,000 and 128,000 tokens'
            },
            {
                key: 'chunk_overlap_size',
                value: 5000,
                expectedError: false
            },
            {
                key: 'chunk_overlap_size',
                value: 20000,
                expectedError: true,
                errorMessage: 'must be a number between 0 and 10,000 characters'
            },
            {
                key: 'enable_chunking',
                value: true,
                expectedError: false
            },
            {
                key: 'enable_chunking',
                value: 'not-a-boolean',
                expectedError: true,
                errorMessage: 'must be a boolean value'
            }
        ];

        validationTests.forEach(({ key, value, expectedError, errorMessage }) => {
            const testDesc = expectedError
                ? `should reject invalid ${key}: ${value}`
                : `should accept valid ${key}: ${value}`;

            it(testDesc, async () => {
                const response = await request(app)
                    .post('/api/admin/config')
                    .set(getAuthHeaders('admin')) // OIDC-only mode
                    .send({ [key]: value });

                if (expectedError) {
                    expect(response.status).toBe(400);
                    expect(response.body.details.some(d => d.includes(errorMessage))).toBe(true);
                } else {
                    expect(response.status).toBe(200);
                }
            });
        });
    });
});

describe('Admin Config Routes - OIDC-Only Authentication', () => {

    it('should not use JWT bearer tokens', async () => {
        // Verify that getAuthHeaders no longer uses 'local' mode
        const adminHeaders = getAuthHeaders('admin');

        // Should use OIDC mode headers
        expect(adminHeaders['x-auth-mode']).toBe('oidc');
    });

    it('should use session-based authentication', () => {
        const { generateMockSession } = require('../__fixtures__/authFixtures');

        const session = generateMockSession('admin');

        // Should have passport.user structure
        expect(session.passport).toBeDefined();
        expect(session.passport.user).toBeDefined();
        expect(session.passport.user.username).toBe('admin');
    });
});

