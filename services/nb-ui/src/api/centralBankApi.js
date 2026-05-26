/**
 * centralBankApi — Norges Bank operator surface against WNOK.
 *
 * Mirrors the `central-bank` tag in services/nb-bond-api/openapi.json.
 *
 * Sandbox-only — see SandboxOnlyBanner on CentralBankPage.
 */
import { HttpClient } from './httpClient.js';

async function getCentralBank() {
  return HttpClient.get('/v1/central-bank');
}

async function listAllowlist() {
  return HttpClient.get('/v1/central-bank/allowlist');
}

async function addToAllowlist(address) {
  return HttpClient.put(`/v1/central-bank/allowlist/${encodeURIComponent(address)}`);
}

async function removeFromAllowlist(address) {
  return HttpClient.del(`/v1/central-bank/allowlist/${encodeURIComponent(address)}`);
}

async function mintWnok({ address, amount }) {
  const body = { address, amount };
  return HttpClient.post('/v1/central-bank/wnok/mint', body);
}

async function burnWnok({ address, amount }) {
  const body = { address, amount };
  return HttpClient.post('/v1/central-bank/wnok/burn', body);
}

async function transferWnok({ to, amount }) {
  const body = { to, amount };
  return HttpClient.post('/v1/central-bank/wnok/transfer', body);
}

export const CentralBankApi = {
  getCentralBank,
  listAllowlist,
  addToAllowlist,
  removeFromAllowlist,
  mintWnok,
  burnWnok,
  transferWnok,
};
