import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, CreateAxiosDefaults } from 'axios';
import { Repository } from 'typeorm';
import { AprSample } from '../entities/apr-sample.entity';
import { CoinGeckoService, MAX_PRICE_STALENESS_MS } from './coingecko.service';

const API_KEY = 'CG-secret-key';

function priceResponse(eth: number, ssv: number) {
  return { data: { ethereum: { usd: eth }, 'ssv-network': { usd: ssv } } };
}

function forbidden(headers: Record<string, string> = {}, status = 403) {
  const error = new axios.AxiosError(
    `Request failed with status code ${status}`,
    'ERR_BAD_REQUEST'
  );
  error.config = {
    method: 'get',
    baseURL: 'https://api.coingecko.com/api/v3',
    url: '/simple/price',
    headers
  } as never;
  error.response = { status, statusText: 'Forbidden', data: '' } as never;
  return error;
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createService(
  env: Record<string, string | undefined> = {},
  samples: Partial<AprSample>[] = []
) {
  const get = jest.fn();
  const keylessGet = jest.fn();
  const createSpy = jest
    .spyOn(axios, 'create')
    .mockReturnValueOnce({ get } as unknown as AxiosInstance)
    .mockReturnValueOnce({ get: keylessGet } as unknown as AxiosInstance);
  const find = jest.fn().mockResolvedValue(samples);
  const config = { get: (key: string) => env[key] } as ConfigService;
  const repository = { find } as unknown as Repository<AprSample>;
  const service = new CoinGeckoService(config, repository);
  const createConfig = createSpy.mock.calls[0][0] as CreateAxiosDefaults;
  return { service, get, keylessGet, find, headers: createConfig.headers };
}

describe('CoinGeckoService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('API key', () => {
    it('sends no key header when COINGECKO_API_KEY is unset', () => {
      const { headers } = createService();
      expect(headers).toEqual({});
    });

    it('sends the trimmed demo key header for the public API', () => {
      const { headers } = createService({ COINGECKO_API_KEY: ` ${API_KEY}\n` });
      expect(headers).toEqual({ 'x-cg-demo-api-key': API_KEY });
    });

    it('sends the pro key header for the pro API', () => {
      const { headers } = createService({
        COINGECKO_API_KEY: API_KEY,
        COINGECKO_API_URL: 'https://pro-api.coingecko.com/api/v3'
      });
      expect(headers).toEqual({ 'x-cg-pro-api-key': API_KEY });
    });

    it('never logs the key when a request fails', async () => {
      const logged: unknown[] = [];
      for (const level of ['log', 'warn', 'error', 'debug'] as const) {
        jest
          .spyOn(Logger.prototype, level)
          .mockImplementation((...args: unknown[]) => {
            logged.push(...args);
          });
      }
      const { service, get } = createService({ COINGECKO_API_KEY: API_KEY });
      get.mockRejectedValue(forbidden({ 'x-cg-demo-api-key': API_KEY }));

      await expect(service.getPrices()).rejects.toThrow('403');

      expect(logged.length).toBeGreaterThan(0);
      expect(JSON.stringify(logged)).not.toContain(API_KEY);
    });

    it('switches to the keyless API when CoinGecko rejects the key', async () => {
      const { service, get, keylessGet } = createService({
        COINGECKO_API_KEY: API_KEY,
        COINGECKO_CACHE_TTL_MS: '1000'
      });
      get.mockRejectedValue(forbidden({}, 401));
      keylessGet.mockResolvedValue(priceResponse(3000, 5));

      await expect(service.getPrices()).resolves.toMatchObject({
        ethPrice: 3000
      });

      jest.advanceTimersByTime(2000);
      await service.getPricesFresh();

      expect(get).toHaveBeenCalledTimes(1);
      expect(keylessGet).toHaveBeenCalledTimes(2);
    });

    it('keeps the key when the keyless API also fails', async () => {
      const { service, get, keylessGet } = createService({
        COINGECKO_API_KEY: API_KEY
      });
      get.mockRejectedValueOnce(forbidden({}, 401));
      keylessGet.mockRejectedValue(forbidden());

      await expect(service.getPricesFresh()).rejects.toThrow('403');

      get.mockResolvedValueOnce(priceResponse(3000, 5));
      await expect(service.getPricesFresh()).resolves.toMatchObject({
        ethPrice: 3000
      });
      expect(get).toHaveBeenCalledTimes(2);
      expect(keylessGet).toHaveBeenCalledTimes(1);
    });

    it('does not drop the key on a 403 (IP block)', async () => {
      const { service, get, keylessGet } = createService({
        COINGECKO_API_KEY: API_KEY
      });
      get.mockRejectedValue(forbidden());

      await expect(service.getPricesFresh()).rejects.toThrow('403');
      expect(keylessGet).not.toHaveBeenCalled();
    });
  });

  describe('getPrices', () => {
    it('throws when CoinGecko fails and there is no cached or stored price', async () => {
      const { service, get } = createService();
      get.mockRejectedValue(forbidden());

      await expect(service.getPrices()).rejects.toThrow('403');
    });

    it('does not call CoinGecko again until the TTL passes after a cold failure', async () => {
      const { service, get } = createService({
        COINGECKO_CACHE_TTL_MS: '1000'
      });
      get.mockRejectedValue(forbidden());

      await expect(service.getPrices()).rejects.toThrow('403');
      await expect(service.getPrices()).rejects.toThrow('403');
      expect(get).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(2000);
      get.mockResolvedValueOnce(priceResponse(3000, 5));
      await expect(service.getPrices()).resolves.toMatchObject({
        ethPrice: 3000
      });
      expect(get).toHaveBeenCalledTimes(2);
    });

    it('lets concurrent cold callers share the seed lookup', async () => {
      const sampledAt = new Date(Date.now() - 60 * 60 * 1000);
      const { service, get, find } = createService();
      let resolveFind: (rows: Partial<AprSample>[]) => void = () => undefined;
      find.mockReturnValue(
        new Promise((resolve) => {
          resolveFind = resolve;
        })
      );
      get.mockRejectedValue(forbidden());

      const first = service.getPrices();
      const second = service.getPrices();
      await flushPromises();
      resolveFind([{ timestamp: sampledAt, ethPrice: '2500', ssvPrice: '4' }]);

      const seeded = {
        ethPrice: 2500,
        ssvPrice: 4,
        fetchedAt: sampledAt.getTime()
      };
      await expect(first).resolves.toEqual(seeded);
      await expect(second).resolves.toEqual(seeded);
      expect(find).toHaveBeenCalledTimes(1);
    });

    it('retries the seed lookup after a DB error', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const sampledAt = new Date(Date.now() - 60 * 60 * 1000);
      const { service, get, find } = createService();
      find
        .mockRejectedValueOnce(new Error('db not ready'))
        .mockResolvedValue([
          { timestamp: sampledAt, ethPrice: '2500', ssvPrice: '4' }
        ]);
      get.mockRejectedValue(forbidden());

      await expect(service.getPrices()).rejects.toThrow('403');
      await expect(service.getPrices()).resolves.toMatchObject({
        ethPrice: 2500
      });
      expect(find).toHaveBeenCalledTimes(2);
    });

    it('shares one CoinGecko request between concurrent cold callers', async () => {
      const { service, get } = createService();
      get.mockResolvedValue(priceResponse(3000, 5));

      await Promise.all([
        service.getPrices(),
        service.getPrices(),
        service.getPrices()
      ]);

      expect(get).toHaveBeenCalledTimes(1);
    });

    it('seeds a cold cache from the latest stored sample when CoinGecko fails', async () => {
      const sampledAt = new Date(Date.now() - 60 * 60 * 1000);
      const { service, get } = createService({}, [
        { timestamp: sampledAt, ethPrice: '2500.5', ssvPrice: '4.25' }
      ]);
      get.mockRejectedValue(forbidden());

      await expect(service.getPrices()).resolves.toEqual({
        ethPrice: 2500.5,
        ssvPrice: 4.25,
        fetchedAt: sampledAt.getTime()
      });
      await flushPromises();
      expect(get).toHaveBeenCalledTimes(1);
    });

    it('serves stale prices immediately after the TTL and refreshes in the background', async () => {
      const { service, get } = createService({
        COINGECKO_CACHE_TTL_MS: '1000'
      });
      get.mockResolvedValueOnce(priceResponse(3000, 5));
      await service.getPrices();

      jest.advanceTimersByTime(2000);
      get.mockResolvedValueOnce(priceResponse(3100, 6));

      await expect(service.getPrices()).resolves.toMatchObject({
        ethPrice: 3000,
        ssvPrice: 5
      });
      await flushPromises();
      await expect(service.getPrices()).resolves.toMatchObject({
        ethPrice: 3100,
        ssvPrice: 6
      });
    });

    it('does not call CoinGecko again until the TTL passes after a failure', async () => {
      const { service, get } = createService({
        COINGECKO_CACHE_TTL_MS: '1000'
      });
      get.mockResolvedValueOnce(priceResponse(3000, 5));
      await service.getPrices();

      jest.advanceTimersByTime(2000);
      get.mockRejectedValue(forbidden());
      await service.getPrices();
      await flushPromises();
      await service.getPrices();
      await service.getPrices();
      await flushPromises();

      expect(get).toHaveBeenCalledTimes(2);

      jest.advanceTimersByTime(2000);
      await service.getPrices();
      await flushPromises();

      expect(get).toHaveBeenCalledTimes(3);
    });

    it('stops serving cached prices older than the staleness cap', async () => {
      const { service, get } = createService();
      get.mockResolvedValueOnce(priceResponse(3000, 5));
      await service.getPrices();

      jest.advanceTimersByTime(MAX_PRICE_STALENESS_MS + 1);
      get.mockRejectedValue(forbidden());

      await expect(service.getPrices()).rejects.toThrow('403');
    });
  });

  describe('getPricesFresh', () => {
    it('throws on failure even when a cached price exists', async () => {
      const { service, get } = createService();
      get.mockResolvedValueOnce(priceResponse(3000, 5));
      await service.getPricesFresh();

      get.mockRejectedValue(forbidden());

      await expect(service.getPricesFresh()).rejects.toThrow('403');
    });
  });
});
