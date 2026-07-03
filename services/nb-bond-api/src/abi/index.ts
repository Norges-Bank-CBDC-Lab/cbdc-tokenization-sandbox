import bondManagerArtifact from './BondManager.json';
import bondAuctionArtifact from './BondAuction.json';
import bondTokenArtifact from './BondToken.json';
import globalRegistryArtifact from './GlobalRegistry.json';
import wnokArtifact from './Wnok.json';
import tbdArtifact from './Tbd.json';
import tbdBytecodeArtifact from './TbdBytecode.json';

// Foundry-generated ABI slices
export const bondManagerAbi = bondManagerArtifact.abi;
export const bondAuctionAbi = bondAuctionArtifact.abi;
export const bondTokenAbi = bondTokenArtifact.abi;
export const globalRegistryAbi = globalRegistryArtifact.abi;
export const wnokAbi = wnokArtifact.abi;
export const tbdAbi = tbdArtifact.abi;

// Foundry-generated creation bytecode for Tbd — used by the create-bank
// flow (banks.ts) to deploy a fresh TBD per created bank.
export const tbdBytecode = tbdBytecodeArtifact.bytecode;
