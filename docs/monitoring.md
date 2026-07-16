# Monitoramento e métricas

## Visão geral

O monitoramento combina instrumentação dentro da API com um worker independente. A API registra tráfego e dependências; o worker continua coletando infraestrutura mesmo quando a API está indisponível.

Defaults atuais:

- Intervalo de coleta: 30 segundos.
- Retenção: 15 dias.
- Resoluções de consulta: 30s, 1m, 5m, 30m ou 1h conforme o range.
- Limite de resposta: 720 pontos nas séries legadas e 240 pontos por página no histórico de containers.
- Spool: `/var/lib/dyr-metrics`, com replay idempotente após recuperação do banco.

## Instrumentação da aplicação

Os hooks Fastify registram rota parametrizada, método, duração, status 2xx/4xx/5xx, erros, timeouts e concorrência. O proxy registra duração total, TTFB e falhas do upstream após `reply.hijack()`.

Prisma e ioredis registram somente operação/comando normalizado, duração, erro e classificação de lento. Nunca persistir SQL completo, argumentos, chaves ou payloads.

Limites default:

- `PROXY_TIMEOUT_MS=30000`
- `SLOW_DATABASE_MS=500`
- `SLOW_REDIS_MS=100`
- `SLOW_UPSTREAM_MS=1000`

## Worker de infraestrutura

O worker coleta:

- API: estado, status HTTP e latência do probe.
- Redis: memória, limite, hits/misses, hit rate, evictions, clientes, operações e erros.
- PostgreSQL: QPS/TPS, conexões, deadlocks, cache hit, tamanho, I/O e slow queries.
- Docker: estado/health, uptime, reinícios, CPU, memória, PIDs, rede, block I/O, camada gravável e volumes.

### Escopo global de containers

O coletor consulta `/containers/json?all=1&size=1` sem filtro por label. Isso inclui componentes DyRGateway, frontend, worker, socket proxy e projetos externos no mesmo Docker daemon.

Identidade e ciclo de vida:

- Compose usa `project + service + container-number` como identidade lógica.
- Containers externos usam o nome normalizado.
- Recriações mantêm o UUID lógico e alteram o `instanceId`.
- Substituições simultâneas escolhem a instância em execução mais recente.
- Containers parados continuam amostrados enquanto existirem, com métricas não observáveis em `null`.
- Containers removidos deixam o catálogo e não recebem amostra terminal.

A coleta usa concorrência limitada por `DOCKER_METRICS_CONCURRENCY`, default 6, e timeout `DOCKER_METRICS_TIMEOUT_MS`, default 3000 ms. Stats é chamado somente para containers em execução; System DF é chamado uma vez por ciclo. Uma falha de listagem nunca marca todos os registros como ausentes.

O catálogo persistente fica em `MonitoredContainer`. Amostras referenciam o UUID lógico e guardam o ID da instância para identificar resets de contadores. Metadados sensíveis do inspect não são persistidos.

### Visão agrupada

`/monitoring/container-groups` organiza o inventário por projeto Compose e pagina projetos/standalone como itens de primeiro nível. O filtro de estado seleciona grupos relevantes, mas cada grupo sempre inclui todos os seus containers para manter a visão operacional completa.

As permissões do grupo são agregadas dos filhos. Projetos parcialmente ativos podem oferecer start e stop simultaneamente. Métricas continuam pertencendo aos containers individuais; o grupo agrega somente contagens de estado e health.

## Histogramas e agregação

Faixas fixas de latência são acumuladas e mescladas antes do cálculo de percentis. Nunca obtenha percentis por média de percentis parciais.

Contadores acumulados precisam considerar reset/recriação. Um delta negativo representa reset e não deve gerar taxa negativa. Lacunas de coleta permanecem lacunas; não interpolar.

## PostgreSQL e Redis

PostgreSQL depende de:

- `shared_preload_libraries=pg_stat_statements`
- `track_io_timing=on`
- `compute_query_id=on`
- extensão `pg_stat_statements` aplicada por migration.

Redis usa `maxmemory`, `allkeys-lru`, latency tracking e percentis configurados. Alterações nesses parâmetros exigem recriação do container correspondente.

## Privacidade e segurança

- Não armazenar tokens, cookies, query strings, bodies ou headers sensíveis.
- Não armazenar SQL, parâmetros Prisma ou chaves Redis.
- Não expor Docker Engine ou worker em portas públicas.
- Endpoints de monitoramento permanecem autenticados.
- Os dois socket proxies permanecem sem portas publicadas e usam redes internas separadas.
- `docker-proxy` usa `CONTAINERS=1` e `POST=0` para catálogo, inspect, stats e System DF.
- `docker-control-proxy` usa `CONTAINERS=0`, `POST=1` e allowlists somente para start/stop.
- Restart, kill, exec, create, delete, pause e unpause permanecem bloqueados; o worker não participa da rede de controle.
- A proteção da stack é calculada pela API, nunca pelo frontend.

