import { createDb, type DB } from "@10xconnect/db";
import { Global, Inject, Module, type OnModuleDestroy } from "@nestjs/common";
import type { Kysely } from "kysely";

/** DI token for the shared Kysely client. */
export const KYSELY_DB = "KYSELY_DB";

@Global()
@Module({
  providers: [{ provide: KYSELY_DB, useFactory: () => createDb() }],
  exports: [KYSELY_DB],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<DB>) {}

  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }
}
