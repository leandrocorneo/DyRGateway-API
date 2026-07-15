# AGENTS.md

Este arquivo contém instruções duráveis para agentes que trabalham no DyRGatewayAPI. Leia `docs/README.md` antes de alterar o código.

## Objetivo do repositório

API, motor de proxy reverso e coleta de métricas do DyRGateway. O frontend vive em outro repositório e não deve ser implementado aqui.

## Mapa rápido

- `src/app/server.ts`: composição do Fastify e registro de plugins.
- `src/modules/`: módulos de domínio, rotas, serviços, repositórios e DTOs.
- `src/modules/gateway/`: resolução e proxy HTTP/WebSocket.
- `src/monitoring/`: instrumentação, worker, coletores, histogramas e persistência.
- `src/database/` e `src/cache/`: Prisma e Redis.
- `prisma/`: schema e migrations.
- `tests/`: testes organizados na mesma hierarquia dos módulos de produção.
- `docs/`: arquitetura, contratos, monitoramento, desenvolvimento e roadmap.

## Fluxo de trabalho esperado

1. Leia a documentação do subsistema e os arquivos de implementação envolvidos.
2. Em tarefas complexas ou ambíguas, produza um plano e confirme decisões de produto antes de editar.
3. Faça alterações pequenas, alinhadas aos módulos existentes e sem refatorações paralelas.
4. Atualize testes e documentação quando contratos ou comportamento mudarem.
5. Revise o diff e valide dentro dos containers antes de considerar a tarefa concluída.

## Comandos e ambiente

- O projeto roda em WSL Ubuntu, mas comandos Node, Prisma e testes devem ser executados no container `DyRGateway`.
- Build: `docker exec DyRGateway npm run build`
- Testes: `docker exec DyRGateway npm test`
- Prisma generate: `docker exec DyRGateway npm run prisma:generate`
- Migration de desenvolvimento: `docker exec DyRGateway npx prisma migrate dev --name <nome>`
- Migration deploy: `docker exec DyRGateway npx prisma migrate deploy`
- Logs: `docker compose logs -f gateway metrics-worker`
- Execute Docker Compose a partir de `/home/leandro/DyRGatewayAPI` no WSL.
- Não execute push sem solicitação explícita.

## Regras de engenharia

- Não invente endpoints, payloads, tabelas ou métricas. Confirme no código e em `docs/api-reference.md`.
- Preserve autenticação por cookie HTTP-only e o prefixo `/api`.
- Alterações em `prisma/schema.prisma` exigem migration versionada.
- Testes devem ficar exclusivamente em `tests/`, espelhando o módulo de produção; nunca coloque `*.test.ts` dentro de `src/`.
- Não armazene URLs completas, query strings, tokens, payloads, parâmetros SQL, chaves Redis ou segredos em métricas/logs.
- Percentis devem vir de histogramas agregados; nunca calcule p95/p99 pela média de percentis.
- Ausência de amostra é `unknown`/`null`; não interpole nem transforme em zero.
- O proxy HTTP e WebSocket é uma superfície crítica. Preserve roteamento, timeout, hijack e encerramento gracioso.
- O Docker socket só pode ser acessado pelos proxies internos com mount somente leitura: `docker-proxy` aceita apenas consultas e `docker-control-proxy` aceita somente start/stop. Nunca combine `CONTAINERS=1` e `POST=1` no mesmo proxy.
- Valores concretos de ambiente devem existir somente no `.env`; arquivos Compose devem apenas referenciar `${VAR}`, sem duplicar valores, defaults ou segredos inline.
- Trabalhe com alterações locais existentes. Não reverta arquivos que não pertencem à tarefa.

## Definição de pronto

- Contratos e autenticação permanecem compatíveis ou têm mudança documentada.
- Build e testes relevantes passam no container.
- Migrations foram geradas e verificadas quando necessárias.
- Casos de erro, timeout, indisponibilidade e valores nulos foram considerados.
- Documentação correspondente em `docs/` foi atualizada.
- O diff não contém segredos, mocks acidentais, dados sensíveis ou mudanças não relacionadas.

