"use strict";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const loadEnvVars = () => require('../src/env-vars');
describe('env-vars', () => {
    const originalEnv = { ...process.env };
    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
    });
    afterEach(() => {
        process.env = { ...originalEnv };
    });
    it('requires RPC_URL', () => {
        process.env.RPC_URL = '';
        process.env.GLOBAL_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000001';
        process.env.BOND_ADMIN_PK = 'test';
        expect(() => loadEnvVars()).toThrow(/RPC_URL/);
    });
    it('treats a blank AUCTION_OWNER_SEAL_PK as undefined', () => {
        process.env.RPC_URL = 'http://localhost:8545';
        process.env.GLOBAL_REGISTRY_ADDRESS = '0x0000000000000000000000000000000000000001';
        process.env.BOND_ADMIN_PK = 'test';
        process.env.AUCTION_OWNER_SEAL_PK = '  ';
        const { envVariables } = loadEnvVars();
        expect(envVariables.AUCTION_OWNER_SEAL_PK).toBeUndefined();
    });
});
//# sourceMappingURL=env-vars.test.js.map
