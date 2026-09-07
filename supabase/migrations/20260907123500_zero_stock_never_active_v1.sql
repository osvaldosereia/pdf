-- Estoque físico igual a zero nunca deixa o produto ativo no catálogo operacional.
-- A regra vale para qualquer atualização futura de `products.stock`.

create or replace function public.enforce_zero_stock_inactive()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.stock is not null and new.stock <= 0 then
    new.is_active := false;
    new.is_whatsapp_active := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_products_zero_stock_inactive on public.products;
create trigger trg_products_zero_stock_inactive
before insert or update of stock on public.products
for each row execute function public.enforce_zero_stock_inactive();

revoke all on function public.enforce_zero_stock_inactive() from public, anon, authenticated;
