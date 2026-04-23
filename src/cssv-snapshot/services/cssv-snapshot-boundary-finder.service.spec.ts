import { CssvSnapshotRun } from '../../entities/cssv-snapshot-run.entity';
import {
  HOODI_CHAIN_ID,
  HOODI_GENESIS_TIMESTAMP
} from '../constants/cssv-snapshot.constants';
import { CssvSnapshotBoundaryFinderService } from './cssv-snapshot-boundary-finder.service';

describe('CssvSnapshotBoundaryFinderService', () => {
  it('finds the next daily window from the previous snapshot using binary search', async () => {
    const targetTimestamp = Math.floor(
      Date.parse('2026-04-16T12:00:00.000Z') / 1000
    );
    const blockchainService = {
      getLatestBlockHeader: jest.fn().mockResolvedValue({
        number: 9_000,
        timestamp: targetTimestamp + 3_600
      }),
      getBlockHeader: jest.fn(async (blockNumber: number) => ({
        number: blockNumber,
        timestamp: targetTimestamp - 60 + (blockNumber - 7_700) * 12
      }))
    };
    const configService = {
      cssvDeploymentBlock: 1_000,
      expectedBlocksPerDay: 7_200,
      chainId: HOODI_CHAIN_ID
    };
    const service = new CssvSnapshotBoundaryFinderService(
      configService as any,
      blockchainService as any
    );
    const previousSnapshotRun = {
      snapshotDate: '2026-04-15',
      toBlockExclusive: '500'
    } as CssvSnapshotRun;

    await expect(service.findNextWindow(previousSnapshotRun)).resolves.toEqual({
      snapshotDate: '2026-04-16',
      fromBlockInclusive: 500,
      toBlockExclusive: 7_706,
      snapshotStateBlock: 7_705
    });
  });

  it('derives the first eligible snapshot window from deployment block and genesis math', async () => {
    const deploymentBlock = 1_000;
    const latestBlockNumber = 20_000;
    const blockchainService = {
      getLatestBlockHeader: jest.fn().mockResolvedValue({
        number: latestBlockNumber,
        timestamp: HOODI_GENESIS_TIMESTAMP + latestBlockNumber * 12
      }),
      getBlockHeader: jest.fn(async (blockNumber: number) => ({
        number: blockNumber,
        timestamp: HOODI_GENESIS_TIMESTAMP + blockNumber * 12
      }))
    };
    const configService = {
      cssvDeploymentBlock: deploymentBlock,
      expectedBlocksPerDay: 7_200,
      chainId: HOODI_CHAIN_ID
    };
    const service = new CssvSnapshotBoundaryFinderService(
      configService as any,
      blockchainService as any
    );
    const deploymentTimestamp = HOODI_GENESIS_TIMESTAMP + deploymentBlock * 12;
    const deploymentDate = new Date(deploymentTimestamp * 1000);
    const sameDaySnapshotDate = deploymentDate.toISOString().slice(0, 10);
    const sameDayNoonTimestamp = Math.floor(
      Date.parse(`${sameDaySnapshotDate}T12:00:00.000Z`) / 1000
    );
    const expectedSnapshotDate =
      deploymentTimestamp <= sameDayNoonTimestamp
        ? sameDaySnapshotDate
        : new Date(
            Date.parse(`${sameDaySnapshotDate}T00:00:00.000Z`) + 86_400_000
          )
            .toISOString()
            .slice(0, 10);
    const expectedNoonTimestamp = Math.floor(
      Date.parse(`${expectedSnapshotDate}T12:00:00.000Z`) / 1000
    );
    const expectedToBlockExclusive =
      Math.floor((expectedNoonTimestamp - HOODI_GENESIS_TIMESTAMP) / 12) + 1;

    await expect(service.findNextWindow(null)).resolves.toEqual({
      snapshotDate: expectedSnapshotDate,
      fromBlockInclusive: deploymentBlock,
      toBlockExclusive: expectedToBlockExclusive,
      snapshotStateBlock: expectedToBlockExclusive - 1
    });
  });

  it('returns null when the next noon boundary is not yet stable enough to process', async () => {
    const targetTimestamp = Math.floor(
      Date.parse('2026-04-16T12:00:00.000Z') / 1000
    );
    const blockchainService = {
      getLatestBlockHeader: jest.fn().mockResolvedValue({
        number: 9_000,
        timestamp: targetTimestamp
      }),
      getBlockHeader: jest.fn()
    };
    const configService = {
      cssvDeploymentBlock: 1_000,
      expectedBlocksPerDay: 7_200,
      chainId: HOODI_CHAIN_ID
    };
    const service = new CssvSnapshotBoundaryFinderService(
      configService as any,
      blockchainService as any
    );
    const previousSnapshotRun = {
      snapshotDate: '2026-04-15',
      toBlockExclusive: '500'
    } as CssvSnapshotRun;

    await expect(service.findNextWindow(previousSnapshotRun)).resolves.toBeNull();
  });
});
