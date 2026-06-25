/**
 * bankingApi — operator surface over the per-bank TBD (tokenized bank
 * deposit) tokens.
 *
 * Mirrors the `banking` tag in services/nb-bond-api/openapi.json. Each TBD is
 * addressed by its contract address; writes are signed server-side by the
 * token's owning bank.
 *
 * Sandbox-only — see SandboxOnlyBanner on BankingPage.
 */
import { HttpClient } from './httpClient.js';

const tbdPath = (address) => `/v1/banking/tbd/${encodeURIComponent(address)}`;

async function listBanks() {
  return HttpClient.get('/v1/banking/banks');
}

async function listTbd() {
  return HttpClient.get('/v1/banking/tbd');
}

async function getTbd(address) {
  return HttpClient.get(tbdPath(address));
}

async function addToAllowlist(address, holder) {
  return HttpClient.put(`${tbdPath(address)}/allowlist/${encodeURIComponent(holder)}`);
}

async function removeFromAllowlist(address, holder) {
  return HttpClient.del(`${tbdPath(address)}/allowlist/${encodeURIComponent(holder)}`);
}

async function mint(address, { address: to, amount }) {
  return HttpClient.post(`${tbdPath(address)}/mint`, { address: to, amount });
}

async function burn(address, { address: from, amount }) {
  return HttpClient.post(`${tbdPath(address)}/burn`, { address: from, amount });
}

async function transfer(address, { to, amount }) {
  return HttpClient.post(`${tbdPath(address)}/transfer`, { to, amount });
}

export const BankingApi = {
  listBanks,
  listTbd,
  getTbd,
  addToAllowlist,
  removeFromAllowlist,
  mint,
  burn,
  transfer,
};
