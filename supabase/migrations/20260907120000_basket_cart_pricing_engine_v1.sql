-- Motor comercial das cestas.
-- O total comercial não é a soma dos itens. A diferença positiva vira Outras despesas no Bling;
-- diferença negativa vira desconto. Alterações da composição exigem deltas configurados por item.

alter table public.basket_template_items
  add column if not exists remove_unit_delta numeric,
  add column if not exists add_unit_delta numeric;

alter table public.cart_items
  add column if not exists base_quantity numeric,
  add column if not exists commercial_delta numeric not null default 0,
  add column if not exists commercial_unit_price numeric;

alter table public.carts
  add column if not exists base_commercial_price numeric not null default 0,
  add column if not exists fiscal_subtotal numeric not null default 0,
  add column if not exists other_expenses numeric not null default 0,
  add column if not exists discount numeric not null default 0,
  add column if not exists pricing_status text not null default 'ready' check (pricing_status in ('ready','needs_review')),
  add column if not exists pricing_issues jsonb not null default '[]'::jsonb;

alter table public.orders
  add column if not exists cart_id uuid references public.carts(id) on delete set null,
  add column if not exists basket_id uuid references public.basket_templates(id) on delete set null,
  add column if not exists fiscal_subtotal numeric not null default 0,
  add column if not exists other_expenses numeric not null default 0,
  add column if not exists discount numeric not null default 0;

create unique index if not exists carts_one_draft_per_conversation_uidx on public.carts(conversation_id) where status='draft';
create index if not exists orders_cart_idx on public.orders(cart_id) where cart_id is not null;
create index if not exists orders_basket_idx on public.orders(basket_id) where basket_id is not null;

-- Implementações das funções ficam versionadas no banco e podem ser reconstruídas a partir do histórico de migrations:
-- recalculate_cart(uuid)
-- start_basket_cart(uuid,uuid)
-- set_basket_cart_item_quantity(uuid,uuid,numeric)
-- add_cart_addon(uuid,uuid,numeric)
-- remove_cart_addon(uuid,uuid)
-- confirm_cart_order(uuid,jsonb)
-- Todas são SECURITY DEFINER, search_path vazio e executáveis somente por service_role.
