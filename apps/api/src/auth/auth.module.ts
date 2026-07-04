import { Global, Module } from "@nestjs/common";

import { ApiKeyAuthService } from "./api-key-auth.service";

/**
 * Global so the APP_GUARD SupabaseAuthGuard (instantiated in AppModule) and
 * feature modules (e.g. MCP) can inject ApiKeyAuthService without imports.
 */
@Global()
@Module({
  providers: [ApiKeyAuthService],
  exports: [ApiKeyAuthService],
})
export class AuthModule {}
