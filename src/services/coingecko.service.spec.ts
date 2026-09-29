import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { CoinGeckoService } from './coingecko.service';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return { ...actual, create: jest.fn() };
});

const mockedCreate = axios.create as jest.Mock;

function priceResponse(eth: number, ssv: number) {
  return { data: { ethereum: { usd: eth }, 'ssv-network': { usd: ssv } } };
}

function forbidden() {
  const error = new axios.AxiosError(
    'Request failed with status code 403',
    'ERR_BAD_REQUEST'
  );
  error.response = { status: 403, statusText: 'Forbidden', data: '' } as never;
  return error;
}

function createService(env: Record<string, string | undefined> = {}) {
  const get = jest.fn();
  mockedCreate.mockReturnValue({ get });
  const config = { get: (key: string) => env[key] } as ConfigService;
  return { service: new CoinGeckoService(config), get };
}

describe('CoinGeckoService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockedCreate.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('API key', () => {
    it('sends no key header when COINGECKO_API_KEY is unset', () => {
      createService();
      expect(mockedCreate.mock.calls[0][0].headers).toEqual({});
    });

    it('sends the demo key header for the public API', () => {
      createService({ COINGECKO_API_KEY: 'k' });
      expect(mockedCreate.mock.calls[0][0].headers).toEqual({
        'x-cg-demo-api-key': 'k'
      });
    });

    it('sends the pro key header for the pro API', () => {
      createService({
        COINGECKO_API_KEY: 'k',
        COINGECKO_API_URL: 'https://pro-api.coingecko.com/api/v3'
      });
      expect(mockedCreate.mock.calls[0][0].headers).toEqual({
        'x-cg-pro-api-key': 'k'
      });
    });
  });

  describe('getPrices', () => {
    it('throws when CoinGecko fails and nothing was ever fetched', async () => {
      const { service, get } = createService();
      get.mockRejectedValue(forbidden());

      await expect(service.getPrices()).rejects.toThrow('403');
    });

    it('serves the last good prices when CoinGecko fails after the TTL', async () => {
      const { service, get } = createService({
        COINGECKO_CACHE_TTL_MS: '1000'
      });
      get.mockResolvedValueOnce(priceResponse(3000, 5));
      await service.getPrices();

      jest.advanceTimersByTime(2000);
      get.mockRejectedValue(forbidden());

      await expect(service.getPrices()).resolves.toEqual({
        ethPrice: 3000,
        ssvPrice: 5
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
      await service.getPrices();

      expect(get).toHaveBeenCalledTimes(2);
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
