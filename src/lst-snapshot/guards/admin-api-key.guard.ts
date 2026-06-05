import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable
} from '@nestjs/common';
import { Request } from 'express';
import { LstSnapshotConfigService } from '../config/lst-snapshot.config';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
  constructor(private readonly config: LstSnapshotConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.adminApiKey) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-admin-key'];

    if (provided !== this.config.adminApiKey) {
      throw new ForbiddenException('Invalid or missing X-Admin-Key header');
    }

    return true;
  }
}
