# Phone Smart

ERP especializado pra **lojas de celular** — vendas com controle de IMEI/Serial, OS de assistência técnica, fiscal, financeiro, relatórios e CRM. Forkado do SmartERP (genérico) com features específicas pro mercado de celular.

## Roadmap MVP

- ✅ Sprint 0 — Setup base (clone do SmartERP, branding, cor azul `#3B82F6`)
- ⏳ Sprint 1 — IMEI/Serial tracking em produtos + busca no PDV
- ⏳ Sprint 2 — Etiquetas (código de barras pra produtos e OS)
- ⏳ Sprint 3 — Consulta IMEI / CPF / CNPJ (APIs externas)
- ⏳ Sprint 4 — IA pós-venda (msg WhatsApp X dias após venda)

## Stack

- Next.js 16 (App Router) + TypeScript
- Supabase (Auth + DB + Storage)
- Asaas (billing)
- Resend (email transacional)
- Focus NFe (fiscal)
- @react-pdf/renderer (PDFs)
- Tailwind v4

## Setup local

```bash
npm install
cp .env.example .env.local   # preencher com credenciais
npm run dev
```

App em http://localhost:3000

## Banco de dados

Migrations em `infra/supabase/migrations/`. Rodar pelo SQL Editor do Supabase em ordem numérica.

Bancado **separado** do SmartERP — esse projeto tem seu próprio Supabase.
