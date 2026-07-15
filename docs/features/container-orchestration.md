# Orquestração de containers Docker

## Objetivo

Permitir que usuários autenticados iniciem ou parem containers externos existentes no Docker daemon. Os projetos Compose `dyrgatewayapi` e `dyrgateway`, além dos nomes de fallback configurados, são protegidos para impedir a interrupção da própria plataforma.

Esta especificação é a fonte canônica da feature. Não ampliar as ações sem nova decisão de produto e revisão de segurança.

## Escopo atual

Incluído:

- Start de containers nos estados `created` ou `exited`.
- Stop gracioso de containers no estado `running`.
- Idempotência quando o container já está no estado desejado.
- Lock em memória por UUID lógico.
- Resolução do alvo diretamente no Docker daemon.
- Atualização best-effort do catálogo persistido.
- Controles no catálogo e no detalhe do frontend.

Fora do escopo:

- Restart, kill, pause, unpause, create, delete e exec.
- Ações em lote.
- Operação de containers da stack DyRGateway.
- RBAC e auditoria adicional.
- Logs em tempo real.

## Segurança

A API é o único canal de controle. O frontend nunca acessa o Docker Engine.

O socket é montado como somente leitura em dois proxies sem portas publicadas:

- `docker-proxy` fica na rede `docker-monitoring`, usa `CONTAINERS=1` e `POST=0` e atende listagem/inspect/stats.
- `docker-control-proxy` fica na rede `docker-control`, usa `CONTAINERS=0`, `POST=1`, `ALLOW_START=1` e `ALLOW_STOP=1`.
- `ALLOW_RESTARTS`, `ALLOW_PAUSE`, `ALLOW_UNPAUSE` e `EXEC` permanecem em `0`.

O gateway participa das duas redes. O worker participa somente de `docker-monitoring`. Essa separação é obrigatória: no proxy Tecnativa, combinar `CONTAINERS=1` e `POST=1` faria a ACL genérica aceitar outras operações da seção de containers.

A proteção é calculada no backend por projeto Compose e por nomes de fallback. O cliente não mantém uma lista própria.

## Configuração

Valores concretos pertencem ao `.env`. Os arquivos Compose apenas interpolam variáveis.

- `DOCKER_PROXY_IMAGE`
- `DOCKER_PROXY_URL`
- `DOCKER_CONTROL_PROXY_URL`
- `DOCKER_ACTION_TIMEOUT_MS=15000`
- `DOCKER_STOP_TIMEOUT_SECONDS=10`
- `DOCKER_PROTECTED_PROJECTS=dyrgatewayapi,dyrgateway`
- `DOCKER_PROTECTED_CONTAINERS`
- `DOCKER_PROXY_POST`
- `DOCKER_PROXY_ALLOW_START`
- `DOCKER_PROXY_ALLOW_STOP`

## Contratos

### Permissões de consulta

Cada item do catálogo e o objeto `container` do detalhe incluem:

```json
{
  "orchestration": {
    "protected": false,
    "canStart": false,
    "canStop": true,
    "reason": "already-running"
  }
}
```

`reason` aceita `protected`, `already-running`, `already-stopped`, `unsupported-state` ou `null`.

### Iniciar

`POST /api/monitoring/containers/:id/start`

Sem body. O `:id` é o UUID lógico do catálogo.

### Parar

`POST /api/monitoring/containers/:id/stop`

Sem body. A API usa o timeout configurado e não aceita timeout do cliente.

### Sucesso

```json
{
  "action": "stop",
  "changed": true,
  "completedAt": "2026-07-15T12:00:00.000Z",
  "container": {
    "id": "uuid-logico",
    "name": "container-externo",
    "instanceId": "docker-container-id",
    "previousState": "running",
    "state": "exited",
    "health": null
  },
  "orchestration": {
    "protected": false,
    "canStart": true,
    "canStop": false,
    "reason": "already-stopped"
  }
}
```

Erros: `401` sem sessão, `403` protegido, `404` removido, `409` estado incompatível ou ação concorrente, `502` falha do daemon/proxy e `504` timeout.

## Resolução e concorrência

Antes de cada ação a API lista todos os containers, recalcula as identidades lógicas e escolhe a instância canônica. O PostgreSQL não é usado para localizar o alvo. Isso evita agir em um container antigo após recriação.

Um lock por UUID lógico impede duas ações simultâneas dentro do processo da API. Mudanças concorrentes externas ao processo são detectadas pelas respostas do Docker e retornam `409` quando incompatíveis.

## Testes

Os testes ficam em `tests/modules/orchestration/` e cobrem:

- proteção por projeto e por nome;
- resolução por UUID lógico;
- start, stop e timeout gracioso;
- idempotência;
- estados incompatíveis;
- lock concorrente;
- falhas `403`, `404`, `409`, `502` e `504`;
- persistência best-effort;
- rejeição de body.

Na validação real, use somente um container descartável externo à stack. Nunca teste stop nos containers protegidos.

## Evolução futura: logs

Logs em tempo real serão especificados separadamente. A direção provável é SSE ou WebSocket com autenticação, limites de retenção, backpressure, redaction e seleção explícita de container. Esta entrega não habilita `/logs`, attach ou exec no socket proxy.
