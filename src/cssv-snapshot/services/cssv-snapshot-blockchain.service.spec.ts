import { ethers } from 'ethers';
import { CSSV_TOKEN_MINIMAL_ABI } from '../abis/cssv-token.abi';
import { CSSV_SNAPSHOT_VIEWS_MINIMAL_ABI } from '../abis/ssv-views.abi';
import { CssvSnapshotBlockchainService } from './cssv-snapshot-blockchain.service';

describe('CssvSnapshotBlockchainService', () => {
  const config = {
    rpcUrl: 'http://localhost:8545',
    chainId: 1,
    viewsContractAddress: '0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4',
    stakingContractAddress: '0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1',
    cssvTokenAddress: '0xe018D31F120A637828F46aFD6c64EC099d960546',
    cssvSnapshotStartBlock: 24_920_727,
    expectedBlocksPerDay: 7_200,
    logChunkSizeBlocks: 2_400
  };
  const previewInterface = new ethers.Interface(CSSV_SNAPSHOT_VIEWS_MINIMAL_ABI);
  const tokenInterface = new ethers.Interface(CSSV_TOKEN_MINIMAL_ABI);

  let service: CssvSnapshotBlockchainService;
  let provider: {
    call: jest.Mock;
    getBlock: jest.Mock;
    getBlockNumber: jest.Mock;
    getNetwork: jest.Mock;
  };
  let sleepMock: jest.Mock;

  beforeEach(() => {
    service = new CssvSnapshotBlockchainService(config as any);
    provider = {
      call: jest.fn(),
      getBlock: jest.fn(),
      getBlockNumber: jest.fn(),
      getNetwork: jest.fn()
    };
    sleepMock = jest.fn().mockResolvedValue(undefined);

    (service as any).provider = provider;
    (service as any).sleep = sleepMock;
    (service as any).logger = {
      warn: jest.fn(),
      log: jest.fn(),
      debug: jest.fn(),
      error: jest.fn()
    };
  });

  it('retries only failed preview requests within a wallet batch', async () => {
    const walletA = '0x1111111111111111111111111111111111111111';
    const walletB = '0x2222222222222222222222222222222222222222';
    const walletC = '0x3333333333333333333333333333333333333333';
    const attemptsByWallet = new Map<string, number>();
    const calledWallets: string[] = [];

    provider.call.mockImplementation(async (request: {
      to: string;
      data: string;
      blockTag: number;
    }) => {
      expect(request.to).toBe(config.viewsContractAddress);
      expect(request.blockTag).toBe(123);

      const [walletAddress] = previewInterface.decodeFunctionData(
        'previewClaimableEth',
        request.data
      );
      const normalizedWalletAddress = ethers.getAddress(walletAddress as string);
      const attempt = (attemptsByWallet.get(normalizedWalletAddress) ?? 0) + 1;

      attemptsByWallet.set(normalizedWalletAddress, attempt);
      calledWallets.push(normalizedWalletAddress);

      if (normalizedWalletAddress === ethers.getAddress(walletB) && attempt === 1) {
        throw new Error('Too Many Requests');
      }

      return previewInterface.encodeFunctionResult('previewClaimableEth', [
        BigInt(attempt * 100)
      ]);
    });

    const result = await service.previewClaimableEthBatchAtBlock(
      [walletA, walletB, walletC],
      123
    );

    expect(calledWallets).toEqual([
      ethers.getAddress(walletA),
      ethers.getAddress(walletB),
      ethers.getAddress(walletC),
      ethers.getAddress(walletB)
    ]);
    expect(result.get(ethers.getAddress(walletA))).toBe(100n);
    expect(result.get(ethers.getAddress(walletB))).toBe(200n);
    expect(result.get(ethers.getAddress(walletC))).toBe(100n);
    expect(provider.call).toHaveBeenCalledTimes(4);
    expect(sleepMock).toHaveBeenCalledTimes(1);
  });

  it('retries a transient totalStaked failure before succeeding', async () => {
    provider.call
      .mockRejectedValueOnce(new Error('Too Many Requests'))
      .mockResolvedValueOnce(
        previewInterface.encodeFunctionResult('totalStaked', [123n])
      );

    const result = await service.totalStakedAtBlock(456);

    expect(result).toBe(123n);
    expect(provider.call).toHaveBeenCalledTimes(2);
    expect(provider.call.mock.calls[0][0]).toMatchObject({
      to: config.viewsContractAddress,
      blockTag: 456
    });
    expect(sleepMock).toHaveBeenCalledTimes(1);
  });

  it('retries only failed token balance requests within a wallet batch', async () => {
    const walletA = '0x4444444444444444444444444444444444444444';
    const walletB = '0x5555555555555555555555555555555555555555';
    const attemptsByWallet = new Map<string, number>();
    const calledWallets: string[] = [];

    provider.call.mockImplementation(async (request: {
      to: string;
      data: string;
      blockTag: number;
    }) => {
      expect(request.to).toBe(config.cssvTokenAddress);
      expect(request.blockTag).toBe(789);

      const [walletAddress] = tokenInterface.decodeFunctionData(
        'balanceOf',
        request.data
      );
      const normalizedWalletAddress = ethers.getAddress(walletAddress as string);
      const attempt = (attemptsByWallet.get(normalizedWalletAddress) ?? 0) + 1;

      attemptsByWallet.set(normalizedWalletAddress, attempt);
      calledWallets.push(normalizedWalletAddress);

      if (normalizedWalletAddress === ethers.getAddress(walletA) && attempt === 1) {
        throw new Error('missing response for request');
      }

      return tokenInterface.encodeFunctionResult('balanceOf', [
        BigInt(attempt * 10)
      ]);
    });

    const result = await service.balanceWeiSsvBatchAtBlock([walletA, walletB], 789);

    expect(calledWallets).toEqual([
      ethers.getAddress(walletA),
      ethers.getAddress(walletB),
      ethers.getAddress(walletA)
    ]);
    expect(result.get(ethers.getAddress(walletA))).toBe(20n);
    expect(result.get(ethers.getAddress(walletB))).toBe(10n);
    expect(provider.call).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenCalledTimes(1);
  });
});
