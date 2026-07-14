import { openApiDocument } from '../src/schemas';

type JsonObject = Record<string, unknown>;

function visit(value: unknown, fn: (value: JsonObject) => void): void {
  if (!value || typeof value !== 'object') return;
  if (!Array.isArray(value)) fn(value as JsonObject);
  for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child, fn);
}

describe('generated OpenAPI integrity', () => {
  const document = openApiDocument as unknown as JsonObject;
  const paths = document.paths as Record<string, Record<string, JsonObject>>;

  it('uses unique operation IDs', () => {
    const ids: string[] = [];
    for (const path of Object.values(paths)) {
      for (const operation of Object.values(path)) {
        if (typeof operation?.operationId === 'string') ids.push(operation.operationId);
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('contains no dangling local component references', () => {
    const refs: string[] = [];
    visit(document, (value) => {
      if (typeof value.$ref === 'string' && value.$ref.startsWith('#/')) refs.push(value.$ref);
    });
    for (const ref of refs) {
      const target = ref
        .slice(2)
        .split('/')
        .reduce<unknown>((current, part) => (current as JsonObject)?.[part], document);
      if (target === undefined) throw new Error(`dangling OpenAPI reference: ${ref}`);
    }
  });

  it('documents checkpoint and pending responses on projection mutations', () => {
    const operations = [
      paths['/v1/bonds'].post,
      paths['/v1/bonds/{isin}/coupon-payments'].post,
      paths['/v1/bonds/{isin}/redemptions'].post,
      paths['/v1/bonds/{isin}/auctions'].post,
      paths['/v1/auctions/{auctionId}'].patch,
      paths['/v1/auctions/{auctionId}'].delete,
      paths['/v1/auctions/{auctionId}/finalisation'].put,
    ];
    for (const operation of operations) {
      const responses = operation.responses as JsonObject;
      expect(responses['202']).toBeDefined();
      const success = (responses['200'] ?? responses['201']) as JsonObject;
      expect((success.headers as JsonObject)['X-Projection-Block']).toBeDefined();
    }
  });

  it('advertises only durable lifecycle states', () => {
    const schemas = (document.components as JsonObject).schemas as Record<string, JsonObject>;
    expect(schemas.AuctionStatus.enum).toEqual(['open', 'closed', 'finalised', 'cancelled']);
    expect(schemas.BondStatus.enum).toEqual([
      'staged',
      'auctioning',
      'outstanding',
      'matured',
      'redeemed',
    ]);
    expect((schemas.FinaliseBody.properties as JsonObject).approve).toMatchObject({ const: true });
  });
});
