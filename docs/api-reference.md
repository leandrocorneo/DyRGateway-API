# Referência da API

Base local: `http://localhost:9000/api`.

## Autenticação

- `POST /login` com `{ "email": string, "password": string }` define o cookie HTTP-only `access_token`.
- `POST /logout` limpa o cookie e exige sessão válida.
- Endpoints administrativos retornam `401` sem cookie válido.

## Health

- `GET /health/live`: público; retorna `{ server, timestamp, uptimeSeconds }`.
- `GET /health/ready`: autenticado; retorna server, database, redis e latências. Pode retornar `503` com payload válido de diagnóstico.
- `GET /health`: autenticado; snapshot completo com uptime e latências.

## Applications

- `GET /applications?skip&take`
- `GET /applications/:id`
- `POST /applications` com `{ name, slug, active? }`
- `PUT /applications/:id` com `{ name?, slug?, active? }`
- `DELETE /applications/:id`

## Domains

- `GET /domains?skip&take`
- `GET /domains/host/:host`
- `POST /domains` com `{ host, applicationId }`
- `PUT /domains/:id` com `{ host?, applicationId? }`
- `DELETE /domains/:id`

## Services

- `GET /services?skip&take`
- `GET /services/:id`
- `GET /routing/overview`
- `PUT /routing/preferences/:serviceId` com `{ "containerId": string | null }`
- `POST /services` com `{ applicationId, serviceTypeId, path, targetHost, targetPort, active? }`
- `PUT /services/:id` com os mesmos campos opcionais.
- `DELETE /services/:id`

Não existe endpoint de listagem de `ServiceType`. O ID HTTP seedado é `00000000-0000-0000-0000-000000000001`.

## Users

- `POST /users` com `{ email, password, active? }`, autenticado.

Não existem listagem, edição, exclusão ou recuperação de senha.

## Visão de roteamento

- `GET /routing/overview`: autenticado; retorna domínio, aplicação, serviço, target, container sugerido por `targetHost/targetPort`, preferência visual salva, portas Docker e diagnóstico TLS para hosts sob `bellaflor.site`.
- `PUT /routing/preferences/:serviceId`: autenticado; salva `{ "containerId": string }` como preferência visual ou remove com `{ "containerId": null }`. Não altera o roteamento real do gateway.

## Resolução do gateway

- `GET /gateway/resolve-host/:host`: público; retorna domínio, aplicação e serviços ativos resolvidos.
- `GET /gateway/resolve?host&path`: público; usa o header `Host` e `/` como fallbacks.

Essas rotas fazem parte do mecanismo do gateway. Não adicione autenticação sem revisar o proxy e seus consumidores.

## Monitoramento

Todos os endpoints abaixo são autenticados:

- `GET /monitoring/overview`
- `GET /monitoring/api`
- `GET /monitoring/api/endpoints`
- `GET /monitoring/redis`
- `GET /monitoring/database`
- `GET /monitoring/containers`
- `GET /monitoring/containers/:id`
- `GET /monitoring/container-groups`
- `POST /monitoring/container-groups/:id/start`
- `POST /monitoring/container-groups/:id/stop`
- `POST /monitoring/container-groups/:id/restart`
- `POST /monitoring/container-groups/:id/rebuild`
- `POST /monitoring/container-groups/:id/redeploy`
- `GET /monitoring/compose-projects`
- `POST /monitoring/compose-projects`
- `PUT /monitoring/compose-projects/:id`
- `DELETE /monitoring/compose-projects/:id`
- `POST /monitoring/containers/:id/start`
- `POST /monitoring/containers/:id/stop`
- `POST /monitoring/containers/:id/restart`

Os endpoints de API, Redis e banco mantêm o contrato comum com `meta`, `current`, `summary`, `series` e `breakdown`. Ranges aceitos: `15m`, `1h`, `6h`, `24h`, `7d` e `15d`; o default é `1h`.

### Catálogo global de containers

`GET /monitoring/containers` lista containers existentes no Docker daemon:

- `state`: `running`, `stopped` ou `all`; default `running`.
- `project`: filtro exato pelo projeto Compose.
- `search`: busca por nome, imagem, projeto ou serviço, com até 100 caracteres.
- `skip`: inteiro não negativo; default `0`.
- `take`: inteiro de 1 a 100; default `25`.

A resposta contém `meta.generatedAt`, filtros, paginação, `summary` e `items`. Cada item expõe somente identidade, metadados Compose permitidos, portas Docker normalizadas, estado, última amostra e `orchestration` com `protected`, `canStart`, `canStop`, `canRestart`, `canRebuild`, `canRedeploy` e `reason`. Labels, comandos, variáveis e configurações completas do Docker não são retornados.

`stopped` agrupa todo container existente cujo estado não seja `running`. Containers removidos deixam o catálogo. O parâmetro legado `container` não é aceito.

### Catálogo agrupado e ações de projeto

`GET /monitoring/container-groups` pagina projetos Compose e containers standalone como itens de primeiro nível. Aceita `state=all|running|stopped`, `search`, `skip` e `take` até 50. Projetos retornam resumo agregado, permissões e todos os containers existentes.

`POST /monitoring/container-groups/:id/start` e `POST /monitoring/container-groups/:id/stop` não aceitam body. As ações operam todos os containers existentes do projeto, continuam após falhas individuais e retornam `partial` e um resultado por container. Não criam serviços removidos nem executam `docker compose up`.

Projetos protegidos retornam `403`; grupos removidos retornam `404`; ações concorrentes retornam `409`. Falhas individuais permanecem no payload `200` da ação coletiva.

### Histórico de um container

`GET /monitoring/containers/:id` consulta uma identidade lógica retornada pelo catálogo:

- `range`: range de monitoramento; default `1h`.
- `skip`: inteiro não negativo; default `0`.
- `take`: inteiro de 1 a 240; default `120`.

A resposta contém `container`, `current`, `summary`, `series` e `meta.pagination`. A primeira página contém os pontos mais recentes, apresentados em ordem cronológica. Cada ponto inclui `instanceId`; mudanças desse valor indicam recriação e reset potencial de contadores acumulados.

Containers removidos retornam `404`. O objeto `container` também inclui as permissões atuais em `orchestration`. Valores não observáveis permanecem `null` e lacunas não são interpoladas.

### Orquestração de containers

`POST /monitoring/containers/:id/start` inicia containers externos nos estados `created` ou `exited`. `POST /monitoring/containers/:id/stop` para containers externos em `running` com timeout gracioso configurado no servidor. `POST /monitoring/containers/:id/restart` reinicia containers externos em `running`. As duas rotas não aceitam body e resolvem o UUID lógico diretamente no daemon antes da ação.

Containers da stack DyRGateway retornam `403`. Containers removidos retornam `404`; estado incompatível ou ação concorrente retorna `409`; falha do Docker retorna `502`; timeout retorna `504`. A resposta `200` contém `action`, `changed`, `completedAt`, estado anterior/atual, `instanceId` e permissões atualizadas.

Consulte `docs/features/container-orchestration.md` para regras de segurança, idempotência e evolução futura.

### Semântica das métricas

- Latência contém `averageMs`, `p50Ms`, `p95Ms`, `p99Ms`, `minMs` e `maxMs`.
- Valores não observáveis são `null`, `unknown` ou `unsupported`.
- `/monitoring/api/endpoints` retorna breakdown agregado e `series: []`.
- RX/TX, block I/O e camada gravável são contadores acumulados, não throughput.
- `/monitoring/overview` inclui somente probes de API, Redis e PostgreSQL; containers são consultados pelas rotas dedicadas.
