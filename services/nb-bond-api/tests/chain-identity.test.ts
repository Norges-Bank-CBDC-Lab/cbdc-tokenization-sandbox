import { bindChainIdentity, ChainIdentityMismatchError, openDatabase } from '../src/ingestion-db';

const GENESIS_A = `0x${'a'.repeat(64)}`;
const GENESIS_B = `0x${'b'.repeat(64)}`;

describe('ingestion database chain identity', () => {
  it('records a fresh database and accepts the same identity again', () => {
    const db = openDatabase({ dbPath: ':memory:' });

    bindChainIdentity(db, { chainId: '2018', genesisHash: GENESIS_A });
    expect(() =>
      bindChainIdentity(db, { chainId: '2018', genesisHash: GENESIS_A.toUpperCase() }),
    ).not.toThrow();
  });

  it('rejects the same chain ID with a different genesis', () => {
    const db = openDatabase({ dbPath: ':memory:' });
    bindChainIdentity(db, { chainId: '2018', genesisHash: GENESIS_A });

    expect(() => bindChainIdentity(db, { chainId: '2018', genesisHash: GENESIS_B })).toThrow(
      ChainIdentityMismatchError,
    );
  });

  it('rejects a legacy checkpoint whose genesis was never recorded', () => {
    const db = openDatabase({ dbPath: ':memory:' });
    db.prepare(
      `INSERT INTO ingestion_state(contract, last_block, last_tx_index, block_timestamp)
       VALUES ('bond-manager', 42, 0, 1)`,
    ).run();

    expect(() => bindChainIdentity(db, { chainId: '2018', genesisHash: GENESIS_A })).toThrow(
      /unbound legacy checkpoint/,
    );
  });
});
