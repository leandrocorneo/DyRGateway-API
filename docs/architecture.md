# Arquitetura da API

## Responsabilidades

O DyRGatewayAPI combina quatro responsabilidades relacionadas:

1. CRUD das configurações de roteamento.
2. Resolução de domínio, aplicação e serviço.
3. Proxy reverso HTTP e WebSocket.
4. Health checks e observabilidade histórica.

O painel administrativo é um consumidor separado e não pertence a este repositório.

## Componentes de runtime

- `gateway`: Fastify na porta 9000, Prisma, Redis, proxy e instrumentação da aplicação.
- `postgres`: configurações de roteamento, usuários e séries históricas.
- `redis`: cache de resolução e métricas operacionais do cache.
- `metrics-worker`: coleta independente a cada 30 segundos, retenção e rollups.
- `docker-proxy`: acesso somente leitura a containers, stats, volumes e informações do Docker Engine.
- `docker-control-proxy`: acesso isolado somente a start/stop, sem listagem genérica de containers.

## Fluxo de roteamento

1. O host recebido é normalizado e procurado em `Domain`.
2. O domínio aponta para uma `Application` ativa.
3. O path é comparado com os `Service` ativos da aplicação.
4. O serviço define `targetHost`, `targetPort` e tipo de transporte.
5. O gateway encaminha HTTP ou WebSocket ao upstream selecionado.
6. Redis reduz consultas repetidas; alterações de configuração devem invalidar o cache correspondente.

Rotas de diagnóstico reutilizam a mesma resolução. O proxy real é registrado sem prefixo `/api` para receber tráfego destinado aos hosts configurados.

## Organização do código

Cada módulo em `src/modules` deve preservar a separação existente:

- `*.route.ts`/`*.routes.ts`: contrato HTTP, autenticação e status code.
- `*.service.ts`: regras de negócio e coordenação.
- `*.repository.ts`: persistência quando o módulo possuir repositório dedicado.
- `*.types.ts`: DTOs e parâmetros públicos do módulo.

Serviços compartilhados vivem em `src/database`, `src/cache`, `src/shared` e `src/monitoring`. Evite dependências diretas entre módulos quando a mesma regra puder permanecer no serviço proprietário.

## Persistência

Entidades de configuração:

- `Application`: agrupador lógico ativo/inativo.
- `Domain`: host único vinculado a uma aplicação.
- `Service`: path e destino vinculados a aplicação e `ServiceType`.
- `ServiceType`: tipo seedado; HTTP usa `00000000-0000-0000-0000-000000000001`.
- `User`: credenciais administrativas com senha hash.

Entidades de monitoramento:

- `InfrastructureMetricSample`: amostra de componente/container.
- `ApiMetricBucket`: tráfego HTTP agregado por rota parametrizada.
- `DependencyMetricBucket`: operações Prisma, Redis e upstream agregadas.
- `MetricRollup`: rollups de 5 minutos e 1 hora.

Toda mudança de schema exige migration em `prisma/migrations`.

## Orquestração agrupada

O catálogo agrupado usa o inventário persistido para métricas e paginação, mas ações de projeto resolvem os containers novamente no daemon. A identidade do grupo deriva do nome normalizado do projeto Compose. Locks compartilhados impedem concorrência entre ações coletivas e individuais.

## Segurança e compatibilidade

- O JWT é transportado no cookie HTTP-only `access_token`.
- CORS deve manter `credentials: true` e origem explícita.
- `/api/health/live` e as rotas de resolução são públicas; administração, readiness e monitoramento exigem autenticação.
- Nunca exponha os Docker proxies, Redis, PostgreSQL ou worker como APIs públicas.
- Nunca habilite `CONTAINERS=1` e `POST=1` no mesmo socket proxy; a ACL genérica de containers ampliaria os verbos permitidos.
- Mudanças no proxy, cache ou autenticação exigem testes de regressão e análise de compatibilidade com o frontend.

