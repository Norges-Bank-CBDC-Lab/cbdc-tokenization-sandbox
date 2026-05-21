/**
 * centralBankApi — Norges Bank operator surface against WNOK.
 *
 * Mirrors the `central-bank` tag in services/nb-bond-api/openapi.json.
 * Dispatches to MockClient or HttpClient based on AppConfig.USE_MOCK.
 *
 * Sandbox-only — see SandboxOnlyBanner on CentralBankPage.
 */
import { AppConfig } from '../config.js';
import { HttpClient } from './httpClient.js';
import { MockClient } from './mockClient.js';

const isMockMode = () => AppConfig.USE_MOCK;

async function getCentralBank() {
  if (isMockMode()) return MockClient.getCentralBank();
  return HttpClient.get('/v1/central-bank');
}

async function listAllowlist() {
  if (isMockMode()) return MockClient.listWnokAllowlist();
  return HttpClient.get('/v1/central-bank/allowlist');
}

async function addToAllowlist(address) {
  if (isMockMode()) return MockClient.addToWnokAllowlist(address);
  return HttpClient.put(`/v1/central-bank/allowlist/${encodeURIComponent(address)}`);
}

async function removeFromAllowlist(address) {
  if (isMockMode()) return MockClient.removeFromWnokAllowlist(address);
  return HttpClient.del(`/v1/central-bank/allowlist/${encodeURIComponent(address)}`);
}

async function mintWnok({ address, amount }) {
  const body = { address, amount };
  if (isMockMode()) return MockClient.mintWnok(body);
  return HttpClient.post('/v1/central-bank/wnok/mint', body);
}

async function burnWnok({ address, amount }) {
  const body = { address, amount };
  if (isMockMode()) return MockClient.burnWnok(body);
  return HttpClient.post('/v1/central-bank/wnok/burn', body);
}

async function transferWnok({ to, amount }) {
  const body = { to, amount };
  if (isMockMode()) return MockClient.transferWnok(body);
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
