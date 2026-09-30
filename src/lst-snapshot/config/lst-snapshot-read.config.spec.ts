import { ConfigService } from '@nestjs/config';
import { LstSnapshotReadConfigService } from './lst-snapshot-read.config';

const buildConfig = (campaignBlock?: string) =>
  new LstSnapshotReadConfigService(
    new ConfigService({ LST_SNAPSHOT_CAMPAIGN_BLOCK: campaignBlock })
  );

describe('LstSnapshotReadConfigService', () => {
  it('parses the pinned campaign block', () => {
    expect(buildConfig('25251631').campaignBlock).toBe(25251631);
  });

  it('returns null when no block is pinned', () => {
    expect(buildConfig().campaignBlock).toBeNull();
  });

  it.each(['0', '007x', '-1', '1.5'])('rejects %s', (value) => {
    expect(() => buildConfig(value)).toThrow(
      'LST_SNAPSHOT_CAMPAIGN_BLOCK must be a positive integer'
    );
  });
});
