import { Controller, Get } from '@nestjs/common';
import { CurrentUser, type AuthUser } from './common';
import { QuotaService } from './quota.service';

@Controller('usage')
export class UsageController {
  constructor(private quota: QuotaService) {}

  @Get()
  current(@CurrentUser() user: AuthUser) {
    return this.quota.currentUsage(user);
  }
}
