# Testes

A árvore de `tests/` espelha os módulos de produção sem misturar testes e código executável.

- `tests/monitoring/core/`: helpers puros de métricas, histogramas e identidade.
- `tests/monitoring/collectors/`: coletores e integrações de infraestrutura.
- `tests/modules/<modulo>/`: contratos HTTP, serviços e validações do módulo.

Use o sufixo `*.test.ts`. Novos módulos devem criar sua própria pasta em `tests/modules/` ou repetir a hierarquia correspondente de `src/`.
