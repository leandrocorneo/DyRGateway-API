# Documentação do DyRGatewayAPI

Esta pasta é a fonte de contexto técnico para pessoas e agentes de IA. Antes de implementar, confira o código; a documentação descreve o estado esperado, mas o código e as migrations são a fonte final para contratos ativos.

## Índice

- [Arquitetura](architecture.md): componentes, fluxo de requisição e limites dos módulos.
- [Referência da API](api-reference.md): endpoints existentes, autenticação e payloads aceitos.
- [Monitoramento](monitoring.md): instrumentação, coleta, persistência e semântica das métricas.
- [Desenvolvimento](development.md): ambiente Docker, comandos, migrations e validação.
- [Roadmap](roadmap.md): funcionalidades desejadas que ainda não estão completas.

## Princípios do projeto

- A API é a única fonte de verdade para o painel administrativo.
- O gateway resolve `host + path` dinamicamente usando PostgreSQL e Redis.
- O proxy deve continuar funcionando mesmo com a instrumentação habilitada.
- Métricas devem ser observadas, agregáveis e seguras; dados ausentes não são zeros.
- Funcionalidades sem endpoint real devem permanecer no roadmap, não em respostas simuladas.

## Repositório relacionado

O frontend Next.js está em `/home/leandro/DyRGateway/dyrgateway`. Mudanças de contrato exigem atualização coordenada de `docs/api-contracts.md` e dos tipos do frontend.

