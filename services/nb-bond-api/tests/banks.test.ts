/**
 * Created-banks module tests.
 *
 * Like the Central Bank and banking-tbd suites, the chain side is not
 * exercised here — `createBank` takes an injectable `CreateBankChainOps`,
 * so these tests drive the orchestration (validation, uniqueness, ordering
 * of deploy → register → allowlist → persist) against fakes. Round-trip
 * deploys against a real chain are covered by live verification, not jest.
 *
 * CENTRAL_BANK_PK gates the flow and is read at module load, so each test
 * group resets the module registry with the env it needs — the same
 * pattern as central-bank.test.ts.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getAddress } from 'ethers';

import type { CreateBankChainOps } from '../src/banks';
import { deriveBidderAddress, generateBidderPrivateKey } from '../src/bidders';
import { type IngestionDatabase, insertBankRow, openDatabase } from '../src/ingestion-db';

type ClosableIngestionDatabase = IngestionDatabase & { close: () => void };

const FAKE_WNOK = getAddress(`0x${'aa'.repeat(20)}`);
const FAKE_DVP = getAddress(`0x${'bb'.repeat(20)}`);
const FAKE_TBD = getAddress(`0x${'cc'.repeat(20)}`);

function fakeOps(overrides: Partial<CreateBankChainOps> = {}): CreateBankChainOps {
  return {
    isRegistryNameTaken: jest.fn().mockResolvedValue(false),
    resolveWnok: jest.fn().mockResolvedValue(FAKE_WNOK),
    resolveDvp: jest.fn().mockResolvedValue(FAKE_DVP),
    deployTbd: jest.fn().mockResolvedValue(FAKE_TBD),
    registerContract: jest.fn().mockResolvedValue(undefined),
    addBankToWnokAllowlist: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('banks', () => {
  const originalKey = process.env.CENTRAL_BANK_PK;
  let tmpDir: string;
  let db: ClosableIngestionDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nb-bond-api-banks-'));
    db = openDatabase({
      dbPath: path.join(tmpDir, 'ingestion.sqlite'),
    }) as ClosableIngestionDatabase;
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (originalKey === undefined) {
      delete process.env.CENTRAL_BANK_PK;
    } else {
      process.env.CENTRAL_BANK_PK = originalKey;
    }
    jest.resetModules();
  });

  async function loadBanksWithCbKey() {
    process.env.CENTRAL_BANK_PK = `0x${'1'.repeat(63)}2`;
    jest.resetModules();
    return import('../src/banks');
  }

  describe('createBank', () => {
    it('generates a fresh keypair, deploys, registers, allowlists, and persists', async () => {
      const { createBank, listCreatedBanks } = await loadBanksWithCbKey();
      const ops = fakeOps();

      const record = await createBank(db, { name: 'Testbanken' }, ops);

      expect(record.name).toBe('Testbanken');
      expect(record.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(record.privateKey).toMatch(/^0x[a-f0-9]{64}$/);
      expect(record.contractName).toBe('TBD Testbanken');
      expect(record.tbdAddress).toBe(FAKE_TBD);
      expect(record.address).toBe(deriveBidderAddress(record.privateKey));

      // Deploy is signed by the bank's own key with admin = bank = the new
      // address, and the derived registry name + symbol.
      expect(ops.deployTbd).toHaveBeenCalledWith({
        privateKey: record.privateKey,
        bank: record.address,
        wnok: FAKE_WNOK,
        dvp: FAKE_DVP,
        name: 'TBD Testbanken',
        symbol: 'TBDTESTBANK',
      });
      expect(ops.registerContract).toHaveBeenCalledWith('TBD Testbanken', FAKE_TBD);
      // enableWnokSettlement defaults to true.
      expect(ops.addBankToWnokAllowlist).toHaveBeenCalledWith(record.address);

      const created = listCreatedBanks(db);
      expect(created).toHaveLength(1);
      expect(created[0].tbdAddress).toBe(FAKE_TBD);
    });

    it('imports an existing private key and derives the right address', async () => {
      const { createBank } = await loadBanksWithCbKey();
      const pk = generateBidderPrivateKey();

      const record = await createBank(db, { name: 'Importbanken', privateKey: pk }, fakeOps());

      expect(record.address).toBe(deriveBidderAddress(pk));
      expect(record.privateKey).toBe(pk.toLowerCase());
    });

    it('skips the WNOK allowlist when enableWnokSettlement is false', async () => {
      const { createBank } = await loadBanksWithCbKey();
      const ops = fakeOps();

      await createBank(db, { name: 'Uallowlistet', enableWnokSettlement: false }, ops);

      expect(ops.addBankToWnokAllowlist).not.toHaveBeenCalled();
    });

    it('rejects a duplicate created-bank name with BankConflictError', async () => {
      const { BankConflictError, createBank } = await loadBanksWithCbKey();

      await createBank(db, { name: 'Dupbanken' }, fakeOps());
      await expect(createBank(db, { name: 'Dupbanken' }, fakeOps())).rejects.toBeInstanceOf(
        BankConflictError,
      );
    });

    it('rejects a configured-bank name with BankConflictError without touching the chain', async () => {
      const { BankConflictError, createBank } = await loadBanksWithCbKey();
      const ops = fakeOps();

      await expect(createBank(db, { name: 'Nordea Bank' }, ops)).rejects.toBeInstanceOf(
        BankConflictError,
      );
      expect(ops.deployTbd).not.toHaveBeenCalled();
    });

    it('rejects when "TBD <name>" is already registered in GlobalRegistry', async () => {
      const { BankConflictError, createBank } = await loadBanksWithCbKey();
      const ops = fakeOps({ isRegistryNameTaken: jest.fn().mockResolvedValue(true) });

      await expect(createBank(db, { name: 'Registrert' }, ops)).rejects.toBeInstanceOf(
        BankConflictError,
      );
      expect(ops.deployTbd).not.toHaveBeenCalled();
    });

    it('rejects a malformed private key with BankValidationError', async () => {
      const { BankValidationError, createBank } = await loadBanksWithCbKey();

      await expect(
        createBank(db, { name: 'Feilbanken', privateKey: '0x1234' }, fakeOps()),
      ).rejects.toBeInstanceOf(BankValidationError);
    });

    it('throws CentralBankNotConfiguredError (503 at the route) when CENTRAL_BANK_PK is unset', async () => {
      delete process.env.CENTRAL_BANK_PK;
      jest.resetModules();
      const { createBank } = await import('../src/banks');
      const { CentralBankNotConfiguredError } = await import('../src/central-bank');
      const ops = fakeOps();

      await expect(createBank(db, { name: 'Nokkelfri' }, ops)).rejects.toBeInstanceOf(
        CentralBankNotConfiguredError,
      );
      expect(ops.deployTbd).not.toHaveBeenCalled();
    });
  });

  describe('deriveTbdSymbol', () => {
    it('strips non-alphanumerics, upper-cases, and truncates to 8 chars after the TBD prefix', async () => {
      const { deriveTbdSymbol } = await loadBanksWithCbKey();
      expect(deriveTbdSymbol('SR-Bank 1')).toBe('TBDSRBANK1');
      expect(deriveTbdSymbol('Sparebanken Norge')).toBe('TBDSPAREBAN');
      expect(deriveTbdSymbol('!!!')).toBe('TBDBANK');
    });
  });

  describe('listBanks merge', () => {
    it('merges configured banks with created banks once the DB is injected', async () => {
      jest.resetModules();
      const bankingTbd = await import('../src/banking-tbd');

      const pk = generateBidderPrivateKey();
      insertBankRow(db, {
        address: deriveBidderAddress(pk),
        name: 'Testbanken',
        private_key: pk,
        contract_name: 'TBD Testbanken',
        tbd_address: FAKE_TBD,
        created_at: Date.now(),
      });

      const banks = bankingTbd.createBankingService(db).listBanks();

      expect(banks.map((b) => b.name)).toEqual(['Nordea Bank', 'DNB Bank', 'Testbanken']);
      expect(banks[2].address).toBe(deriveBidderAddress(pk));
      for (const bank of banks) {
        expect(bank).not.toHaveProperty('privateKey');
      }
    });
  });
});
