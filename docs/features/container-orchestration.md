# Orquestração de containers Docker

## Objetivo

Permitir que usuários autenticados iniciem ou parem containers externos existentes no Docker daemon, individualmente ou agrupados pelo projeto Docker Compose. Os projetos `dyrgatewayapi` e `dyrgateway`, além dos nomes de fallback configurados, permanecem protegidos.

A API opera somente containers existentes. Ela não executa `docker compose up`, não recria serviços removidos e não acessa arquivos Compose.

## Segurança

A API é o único canal de controle. O frontend nunca acessa o Docker Engine.

O socket usa dois proxies internos, ambos com mount somente leitura e sem portas publicadas:

- `docker-proxy`: `CONTAINERS=1` e `POST=0` para listagem, inspect, stats e System DF.
- `docker-control-proxy`: `CONTAINERS=0`, `POST=1`, `ALLOW_START=1` e `ALLOW_STOP=1`.
- Restart, kill, pause, unpause, exec, create e delete permanecem bloqueados.

O worker participa somente da rede de leitura. O gateway participa das redes de leitura e controle. Nunca combine `CONTAINERS=1` e `POST=1` no mesmo proxy.

## Configuração

Valores concretos pertencem ao `.env`; Compose apenas referencia `${VAR}`.

- `DOCKER_PROXY_IMAGE`
- `DOCKER_PROXY_URL`
- `DOCKER_CONTROL_PROXY_URL`
- `DOCKER_ACTION_TIMEOUT_MS=15000`
- `DOCKER_STOP_TIMEOUT_SECONDS=10`
- `DOCKER_GROUP_ACTION_CONCURRENCY=6`
- `DOCKER_PROTECTED_PROJECTS=dyrgatewayapi,dyrgateway`
- `DOCKER_PROTECTED_CONTAINERS`

## Catálogo agrupado

`GET /api/monitoring/container-groups`

Parâmetros:

- `state=all|running|stopped`, padrão `all`.
- `search`, máximo 100 caracteres.
- `skip`, padrão `0`.
- `take`, padrão `10`, máximo `50`.

A paginação conta itens de primeiro nível. Um projeto Compose é um item com todos os seus containers; cada container standalone é um item individual.

- `running` inclui projetos com ao menos um container executando.
- `stopped` inclui projetos com ao menos um container não executando.
- Um projeto parcialmente ativo pode aparecer nos dois filtros.
- A lista interna do projeto sempre contém todos os containers existentes.

Cada grupo retorna UUID determinístico, nome do projeto, resumo de estados/health, permissões agregadas e os contratos atuais de cada container.

## Ações individuais

- `POST /api/monitoring/containers/:id/start`
- `POST /api/monitoring/containers/:id/stop`

Sem body. O `:id` é o UUID lógico do container. Start aceita `created`/`exited`; stop aceita `running` e usa o timeout configurado.

## Ações de projeto

- `POST /api/monitoring/container-groups/:id/start`
- `POST /api/monitoring/container-groups/:id/stop`

Sem body. O `:id` é derivado do nome normalizado do projeto Compose. Antes da ação, a API lista o daemon, recalcula identidades e resolve todas as instâncias canônicas daquele projeto.

A ação continua após falhas individuais e retorna `200` com:

- `action`, `changed`, `partial` e `completedAt`.
- Resumo e permissões atualizadas do grupo.
- Resultado por container: `changed`, `unchanged` ou `failed`.
- Estado anterior/atual, health, instance ID, permissões e erro quando aplicável.

Containers já no estado desejado ficam `unchanged`. Estados `paused`, `restarting`, `removing` e `dead` ficam `failed`. Serviços removidos são ignorados porque não existem no daemon.

Erros globais:

- `401`: sessão ausente.
- `403`: projeto ou container protegido.
- `404`: identidade removida.
- `409`: ação concorrente.
- `502`: falha de comunicação com Docker.
- `504`: timeout de descoberta/operação individual.

## Proteção e concorrência

Um projeto inteiro é protegido se o nome estiver em `DOCKER_PROTECTED_PROJECTS` ou qualquer filho corresponder a `DOCKER_PROTECTED_CONTAINERS`.

Locks em memória são adquiridos atomicamente:

- Ação de projeto bloqueia todos os filhos.
- Ação individual é rejeitada enquanto seu projeto está em operação.
- Ação de projeto é rejeitada se algum filho já possui ação ativa.

As operações internas usam concorrência limitada. O sistema não reconstrói `depends_on` e não promete a mesma ordem do Docker Compose CLI.

## Testes

Os testes ficam em `tests/modules/orchestration/` e `tests/modules/monitoring/` e cobrem identidade, agrupamento, filtros, paginação, proteção, idempotência, falhas parciais, locks e separação dos proxies.

Validação real deve usar somente um projeto Compose descartável externo. Nunca execute start/stop reais contra `dyrgatewayapi` ou `dyrgateway`; valide apenas o retorno `403`.

## Evolução futura

Logs em tempo real serão especificados separadamente, provavelmente via SSE ou WebSocket com autenticação, limites, backpressure e redaction. Esta feature não habilita logs, attach ou exec.