#!/bin/sh
set -eu
pnpm --filter @realm-labs/db migrate
exec pnpm --filter @realm-labs/api start
