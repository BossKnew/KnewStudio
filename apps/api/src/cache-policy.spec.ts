import { noStoreByDefault } from './cache-policy';

describe('noStoreByDefault', () => {
  it('marks API responses no-store before a controller can opt into private caching', () => {
    const response = { setHeader: jest.fn() };
    const next = jest.fn();
    noStoreByDefault({} as any, response as any, next);
    expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(next).toHaveBeenCalledTimes(1);
  });
});
