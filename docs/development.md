# Desenvolvimento e validação

## Ambiente

- Workspace WSL: `/home/leandro/DyRGatewayAPI`
- API: `DyRGateway`
- PostgreSQL: `DyRGateway-Postgres`
- Redis: `DyRGateway-Redis`
- Worker: `DyRGateway-Metrics`
- Docker read proxy: `DyRGateway-DockerProxy`
- Docker control proxy: `DyRGateway-DockerControlProxy`

Execute Docker Compose no WSL. Execute Node, npm, Prisma e testes dentro do container `DyRGateway`.

## Comandos usuais

```bash
docker compose ps
docker compose logs -f gateway metrics-worker
docker exec DyRGateway npm run build
docker exec DyRGateway npm test
docker exec DyRGateway npm run prisma:generate
docker exec DyRGateway npx prisma migrate deploy
```

Para uma migration de desenvolvimento:

```bash
docker exec DyRGateway npx prisma migrate dev --name descricao_curta
```

Não recrie containers por alterações apenas em TypeScript com volume montado. Recrie quando Compose, imagem, dependências, limites ou configuração de PostgreSQL/Redis mudarem.

## Variáveis principais

Valores concretos devem ser definidos somente no `.env`. Os arquivos `docker-compose*.yml` devem usar referências `${VAR}` e não podem duplicar valores, defaults ou segredos inline.


- `PORT`, `NODE_ENV`, `JWT_SECRET`, `CORS_ORIGIN`, `DATABASE_URL`
- `REDIS_HOST`, `REDIS_PORT`
- `METRICS_INTERVAL_SECONDS`, `METRICS_RETENTION_DAYS`, `METRICS_SPOOL_PATH`
- `PROXY_TIMEOUT_MS`, `SLOW_DATABASE_MS`, `SLOW_REDIS_MS`, `SLOW_UPSTREAM_MS`
- `DOCKER_PROXY_IMAGE`, `DOCKER_PROXY_URL`, `DOCKER_CONTROL_PROXY_URL`, `API_PROBE_URL`
- `DOCKER_METRICS_CONCURRENCY`, `DOCKER_METRICS_TIMEOUT_MS`, `DOCKER_ACTION_TIMEOUT_MS`, `DOCKER_STOP_TIMEOUT_SECONDS`
- `DOCKER_PROTECTED_PROJECTS`, `DOCKER_PROTECTED_CONTAINERS`
- `DOCKER_PROXY_POST=0` para leitura e `DOCKER_CONTROL_PROXY_ALLOW_START`/`DOCKER_CONTROL_PROXY_ALLOW_STOP` para controle
- `GATEWAY_MEMORY_LIMIT`, `METRICS_WORKER_MEMORY_LIMIT`, `POSTGRES_MEMORY_LIMIT`, `REDIS_MEMORY_LIMIT`, `REDIS_MAXMEMORY`

Segredos devem ficar em `.env`/infraestrutura e nunca em documentação, commits ou fixtures.

## Estratégia de testes

Todos os testes ficam em `tests/`, organizados na mesma hierarquia dos módulos em `src/`. Arquivos `*.test.ts` dentro de `src/` não são permitidos.

- Unitários: histogramas, deltas, resets, CPU Docker, hit rate, rollups e lacunas.
- Integração: autenticação, ranges, contratos, status codes e readiness 503.
- Proxy: 2xx/4xx/5xx, timeout 504, upstream lento e concorrência.
- Worker: indisponibilidade individual de API/Redis/PostgreSQL e replay do spool.

Antes de concluir uma mudança:

1. Rode os checks relevantes no container.
2. Revise `git diff` e `git status`.
3. Confirme que migrations e contratos estão versionados.
4. Verifique que nenhum segredo ou dado sensível foi adicionado.
5. Atualize `docs/` quando arquitetura, comandos ou API mudarem.

## Git

- Preserve alterações locais não relacionadas.
- Commits devem ser semânticos, em inglês e com descrição curta.
- Separe commits por responsabilidade.
- Não faça push sem pedido explícito.

