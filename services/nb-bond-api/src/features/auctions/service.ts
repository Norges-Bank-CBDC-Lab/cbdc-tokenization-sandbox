import { Interface, keccak256, toUtf8Bytes } from 'ethers';

import { tbdAbi } from '../../abi';
import { computeBuybackAllocation, computeUniformAllocation } from '../../allocation';
import { DependencyUnavailableError, type MutationResource } from '../../application-errors';
import { normalizeSealedBid, unsealBid } from '../../bid';
import {
  decodeCustomError,
  getBondAuction,
  getBondManager,
  getBondToken,
  sendWithManagedNonce,
} from '../../chain';
import { composeAuction, composeBond } from '../../compose';
import { envVariables } from '../../env-vars';
import { badRequest, conflict, notFound } from '../../http';
import type { IngestionDatabase } from '../../ingestion-db';
import { withOperationRecording } from '../../operations';
import { parseBigInt } from '../../parsing';
import type { Auction, Bond, CreateAuctionBody, FinaliseBody } from '../../schemas';
import { AuctionType } from '../../types';

export interface AuctionServiceDependencies {
  historyDb: IngestionDatabase;
  operationsDb: IngestionDatabase;
  sealingPublicKey: string;
  nowSeconds?: () => bigint;
  awaitProjection?: (
    sent: { tx: { hash: string }; receipt: { blockNumber: number } | null },
    resource: MutationResource,
  ) => Promise<void>;
}

export function createAuctionService(dependencies: AuctionServiceDependencies) {
  const nowSeconds = dependencies.nowSeconds ?? (() => BigInt(Math.floor(Date.now() / 1000)));
  const awaitProjection = async (
    sent: { tx: { hash: string }; receipt: { blockNumber: number } | null },
    resource: MutationResource,
  ) => {
    if (dependencies.awaitProjection) {
      await dependencies.awaitProjection(sent, resource);
    }
  };

  async function create(isin: string, body: CreateAuctionBody): Promise<Bond> {
    const auctionType = body.type;

    let endSeconds: bigint;
    try {
      endSeconds = parseBigInt(body.end, 'end');
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    if (endSeconds <= nowSeconds()) throw badRequest('end must be in the future');

    let sizeUnits: bigint;
    try {
      sizeUnits = parseBigInt(body.size, 'size');
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    if (sizeUnits <= 0n) throw badRequest('size must be positive');

    let maturitySeconds: bigint | undefined;
    if (body.maturityDuration !== null && body.maturityDuration !== undefined) {
      try {
        maturitySeconds = parseBigInt(body.maturityDuration, 'maturityDuration');
      } catch (err) {
        throw badRequest((err as Error).message);
      }
      if (maturitySeconds <= 0n) throw badRequest('maturityDuration must be positive');
    }

    const bondAuction = await getBondAuction();
    const auctionCount = await bondAuction.isinToAuctionCount(isin);
    if (auctionCount === 0n && auctionType !== 'RATE') {
      throw badRequest('first auction for ISIN must be RATE');
    }
    if (auctionCount > 0n && auctionType === 'RATE') {
      throw badRequest('subsequent auctions cannot be RATE');
    }

    const bondManager = await getBondManager();
    let bondAlreadyStaged = false;
    if (auctionType === 'RATE') {
      try {
        const bondToken = await getBondToken();
        const partition = keccak256(toUtf8Bytes(isin));
        bondAlreadyStaged = await bondToken.activePartitions(partition);
      } catch (err) {
        throw new DependencyUnavailableError('chain', `bond staging state ${isin}`, err);
      }
    }

    if (auctionType === 'RATE' && !bondAlreadyStaged && maturitySeconds === undefined) {
      throw badRequest('maturityDuration is required for RATE on a new bond');
    }

    const auctionTypeEnum = auctionType === 'RATE' ? 0 : auctionType === 'PRICE' ? 1 : 2;
    const sent = await withOperationRecording(
      {
        db: dependencies.operationsDb,
        opType: 'AUCTION_CREATE',
        target: isin,
        detail: { auctionType, size: String(sizeUnits) },
        interfaces: [bondManager.interface],
        txHashOf: (sent) => sent.tx.hash,
      },
      async () => {
        if (auctionType === 'RATE' && !bondAlreadyStaged) {
          await bondManager.deployBondWithAuction.staticCall(
            isin,
            endSeconds,
            dependencies.sealingPublicKey,
            sizeUnits,
            maturitySeconds!,
          );
        } else {
          await bondManager.deployAuctionForBond.staticCall(
            isin,
            endSeconds,
            dependencies.sealingPublicKey,
            sizeUnits,
            auctionTypeEnum,
          );
        }

        return sendWithManagedNonce(async (nonce) => {
          if (auctionType === 'RATE' && !bondAlreadyStaged) {
            return bondManager.deployBondWithAuction(
              isin,
              endSeconds,
              dependencies.sealingPublicKey,
              sizeUnits,
              maturitySeconds!,
              { nonce },
            );
          }
          return bondManager.deployAuctionForBond(
            isin,
            endSeconds,
            dependencies.sealingPublicKey,
            sizeUnits,
            auctionTypeEnum,
            { nonce },
          );
        });
      },
    );
    await awaitProjection(sent, { type: 'bond', id: isin });

    const bond = await composeBond(dependencies.historyDb, isin);
    if (!bond) throw notFound(`bond ${isin} not found after auction creation`);
    return bond;
  }

  async function cancel(auctionId: string): Promise<Auction> {
    const bondAuction = await getBondAuction();
    const metadata = await bondAuction.getAuction(auctionId);
    const isin = metadata.isin as string;
    if (!isin) throw notFound(`auction ${auctionId} not found`);

    const currentStatus = Number(await bondAuction.getAuctionStatus(auctionId));
    if (currentStatus === 3) throw conflict('auction already finalised');
    if (currentStatus === 4) throw conflict('auction already cancelled');

    const sent = await withOperationRecording(
      {
        db: dependencies.operationsDb,
        opType: 'AUCTION_CANCEL',
        target: auctionId,
        detail: { isin },
        interfaces: [bondAuction.interface],
        txHashOf: (sent) => sent.tx.hash,
      },
      () =>
        sendWithManagedNonce(async (nonce) => {
          const bondManager = await getBondManager();
          return bondManager.cancelAuction(isin, { nonce });
        }),
    );
    await awaitProjection(sent, { type: 'auction', id: auctionId });

    const auction = await composeAuction(dependencies.historyDb, auctionId);
    if (!auction) throw notFound(`auction ${auctionId} not found after cancel`);
    return auction;
  }

  async function close(auctionId: string, testMode = false): Promise<Auction> {
    const bondAuction = await getBondAuction();
    const metadata = await bondAuction.getAuction(auctionId);
    const isin = metadata.isin as string;
    if (!isin) throw notFound(`auction ${auctionId} not found`);

    const currentStatus = Number(await bondAuction.getAuctionStatus(auctionId));
    if (currentStatus === 2) throw conflict('auction already closed');
    if (currentStatus === 3) throw conflict('auction already finalised');
    if (currentStatus === 4) throw conflict('auction cancelled');

    const endSeconds = BigInt(metadata.end?.toString?.() ?? '0');
    const currentTime = nowSeconds();
    if (!testMode && endSeconds > currentTime) {
      const secondsLeft = endSeconds - currentTime;
      throw conflict(
        `auction is still in BIDDING phase; the bidding window ends in ${secondsLeft.toString()}s` +
          ` (at unix ${endSeconds.toString()}). Close is only permitted after the end timestamp.` +
          ` Enable Test mode in the operator UI to attempt anyway — the on-chain contract will` +
          ` still revert with InBidPhase() until the window expires.`,
      );
    }

    const sendClose = (extra: Record<string, unknown> = {}) =>
      sendWithManagedNonce(async (nonce) => {
        const manager = await getBondManager();
        return manager.closeAuction(isin, { nonce, ...extra });
      });

    const sent = await withOperationRecording(
      {
        db: dependencies.operationsDb,
        opType: 'AUCTION_CLOSE',
        target: auctionId,
        detail: { isin },
        interfaces: [bondAuction.interface],
        txHashOf: (sent) => sent.tx.hash,
      },
      async () => {
        try {
          return await sendClose();
        } catch (err) {
          const manager = await getBondManager();
          const errorName = decodeCustomError(err, [bondAuction.interface, manager.interface]);
          if (errorName === 'InBidPhase' && !testMode) {
            return sendClose({ gasLimit: envVariables.NB_BOND_API_CLOSE_GAS_LIMIT });
          }
          if (errorName === 'InBidPhase') {
            throw conflict(
              'auction is still in its on-chain bidding window (block timestamp has not passed the' +
                ' end timestamp). Wait for a later QBFT block or use an auction end in the past.',
            );
          }
          if (errorName) throw conflict(`cannot close auction: ${errorName}`);
          throw err;
        }
      },
    );
    await awaitProjection(sent, { type: 'auction', id: auctionId });

    const auction = await composeAuction(dependencies.historyDb, auctionId);
    if (!auction) throw notFound(`auction ${auctionId} not found after close`);
    return auction;
  }

  async function finalise(auctionId: string, body: FinaliseBody): Promise<Auction> {
    const { winningBidIndexes, expectedClearingRate } = body;
    const auction = await composeAuction(dependencies.historyDb, auctionId);
    if (!auction) throw notFound(`auction ${auctionId} not found`);
    if (auction.status === 'finalised') throw conflict('auction already finalised');
    if (auction.status === 'cancelled') throw conflict('auction cancelled');

    if (auction.status !== 'closed') throw conflict('auction must be closed to finalise');
    if (!auction.size) throw conflict('auction has no offering size');

    const offering = BigInt(auction.size);
    const isin = auction.isin;
    const bondManager = await getBondManager();
    const sealed = await bondManager.getSealedBids(isin);
    const sealedBids = (
      sealed as Array<{ bidder: string; ciphertext: string; plaintextHash: string }>
    ).map(normalizeSealedBid);
    const unsealedByIndex = new Map<number, ReturnType<typeof unsealBid>>();
    sealedBids.forEach((bid, index) => unsealedByIndex.set(index, unsealBid(isin, bid, index)));

    const seenIndexes = new Set<number>();
    const selectedBids = winningBidIndexes.map((index) => {
      const bid = unsealedByIndex.get(index);
      if (!bid) throw badRequest(`unknown winning bidIndex ${index}`);
      if (seenIndexes.has(index)) throw badRequest(`duplicate winning bidIndex ${index}`);
      seenIndexes.add(index);
      return bid;
    });

    const auctionType =
      auction.type === 'RATE'
        ? AuctionType.RATE
        : auction.type === 'PRICE'
          ? AuctionType.PRICE
          : AuctionType.BUYBACK;
    const result =
      auctionType === AuctionType.BUYBACK
        ? computeBuybackAllocation(isin, selectedBids, offering)
        : computeUniformAllocation(isin, auctionType, selectedBids, offering);

    if (result.clearingRate.toString() !== expectedClearingRate) {
      throw badRequest(
        `clearing-rate mismatch: server recomputed ${result.clearingRate.toString()} bps from the ` +
          `selected bids but the request expected ${expectedClearingRate} bps. No allocation was submitted.`,
      );
    }

    const allocations = result.allocations.map((allocation) => ({
      isin,
      bidder: allocation.bidder,
      units: allocation.units,
      rate: allocation.rate,
      auctionType: allocation.auctionType,
    }));
    const proofs = result.allocations.map((allocation) => {
      const bid = unsealedByIndex.get(allocation.bidIndex);
      if (!bid) throw conflict(`missing unsealed bid for bidIndex ${allocation.bidIndex}`);
      if (!bid.plaintext.bidderSig) throw conflict(`missing bidderSig for ${bid.bidder}`);
      return {
        bidIndex: BigInt(bid.bidIndex),
        bidderNonce: BigInt(bid.plaintext.bidderNonce),
        bidderSig: bid.plaintext.bidderSig,
      };
    });

    const sent = await withOperationRecording(
      {
        db: dependencies.operationsDb,
        opType: 'AUCTION_FINALISE',
        target: auctionId,
        detail: { isin, allocations: allocations.length },
        interfaces: [bondManager.interface, new Interface(tbdAbi)],
        txHashOf: (sent) => sent.tx.hash,
      },
      () =>
        sendWithManagedNonce(async (nonce) => {
          return bondManager.finaliseAuction(isin, allocations, proofs, { nonce });
        }),
    );
    await awaitProjection(sent, { type: 'auction', id: auctionId });

    const refreshed = await composeAuction(dependencies.historyDb, auctionId);
    if (!refreshed) throw notFound(`auction ${auctionId} not found after finalisation`);
    return refreshed;
  }

  return { create, close, cancel, finalise };
}
