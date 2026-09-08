create or replace function public.save_fast_inventory_batch_v1(
  p_user_id uuid,
  p_mode text,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := lower(trim(coalesce(p_mode,'')));
  v_count_id uuid;
  v_item jsonb;
  v_source jsonb;
  v_qty numeric;
  v_gtin text;
  v_firebase_key text;
  v_existing_id uuid;
  v_prev_stock numeric;
  v_final_stock numeric;
  v_result jsonb;
  v_successes jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_success_count integer := 0;
  v_error_count integer := 0;
  v_validity date;
  v_gondola text;
  v_shelf text;
  v_count_item_id uuid;
  v_command_id uuid;
begin
  if p_user_id is null then raise exception 'user_required'; end if;
  if v_mode not in ('add','balance') then raise exception 'invalid_fast_stock_mode'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'items_array_required'; end if;
  if jsonb_array_length(p_items) > 1000 then raise exception 'too_many_items'; end if;

  v_count_id := public.start_inventory_count(
    p_user_id,
    case when v_mode = 'add' then 'Leitor Rapido - ADICIONAR' else 'Leitor Rapido - BALANCO' end
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_source := coalesce(v_item->'source','{}'::jsonb);
      v_qty := replace(coalesce(v_item->>'quantity','0'),',','.')::numeric;
      if v_qty <= 0 then raise exception 'quantity_must_be_positive'; end if;

      v_gtin := regexp_replace(
        coalesce(nullif(v_item->>'code',''), nullif(v_source->>'gtin',''), nullif(v_source->>'ean',''), ''),
        '\D','','g'
      );
      if v_gtin = '' then raise exception 'gtin_required'; end if;

      v_firebase_key := nullif(trim(coalesce(v_item->>'firebase_key', v_source->>'firebaseKey', v_source->>'firebase_key', '')), '');
      v_existing_id := null;
      v_prev_stock := null;

      select p.id, p.stock
        into v_existing_id, v_prev_stock
      from public.products p
      where (v_firebase_key is not null and p.firebase_key = v_firebase_key)
         or (p.gtin is not null and p.gtin = v_gtin)
      order by case when v_firebase_key is not null and p.firebase_key = v_firebase_key then 0 else 1 end
      limit 1
      for update;

      if v_mode = 'add' and v_existing_id is null then
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code', v_gtin,
          'quantity', v_qty,
          'error', 'product_not_registered_for_add'
        ));
        v_error_count := v_error_count + 1;
        continue;
      end if;

      v_final_stock := case
        when v_mode = 'add' then coalesce(v_prev_stock,0) + v_qty
        else v_qty
      end;

      if v_mode = 'balance' and v_existing_id is null
         and coalesce(nullif(trim(v_source->>'nome'),''), nullif(trim(v_source->>'name'),'')) is null then
        raise exception 'source_required_for_new_balance';
      end if;

      begin
        v_validity := nullif(coalesce(v_item->>'validity_date', v_source->>'validade', ''),'')::date;
      exception when others then
        v_validity := null;
      end;
      v_gondola := nullif(trim(coalesce(v_item->>'gondola', v_source->>'gondola', '')), '');
      v_shelf := nullif(trim(coalesce(v_item->>'shelf', v_source->>'prateleira', '')), '');

      v_source := v_source || jsonb_build_object(
        'gtin', v_gtin,
        'ean', v_gtin,
        '_fast_stock_operation', v_mode,
        '_scanned_quantity', v_qty,
        '_stock_before', v_prev_stock,
        '_stock_after', v_final_stock
      );

      v_result := public.save_verified_inventory_count(
        v_count_id,
        p_user_id,
        v_firebase_key,
        v_source,
        v_final_stock,
        v_validity,
        v_gondola,
        v_shelf
      );

      v_count_item_id := nullif(v_result->>'count_item_id','')::uuid;
      v_command_id := nullif(v_result->>'bling_command_id','')::uuid;

      if v_count_item_id is not null then
        update public.inventory_count_items
           set source_snapshot = coalesce(source_snapshot,'{}'::jsonb) || jsonb_build_object(
             'fast_stock_operation', v_mode,
             'scanned_quantity', v_qty,
             'stock_before', v_prev_stock,
             'stock_after', v_final_stock
           )
         where id = v_count_item_id;
      end if;

      if v_command_id is not null then
        update public.bling_commands
           set payload = coalesce(payload,'{}'::jsonb) || jsonb_build_object(
             'inventory_operation', v_mode,
             'scanned_quantity', v_qty,
             'stock_before', v_prev_stock,
             'stock_after', v_final_stock
           )
         where id = v_command_id;
      end if;

      v_successes := v_successes || jsonb_build_array(jsonb_build_object(
        'code', v_gtin,
        'product_id', v_result->>'product_id',
        'quantity', v_qty,
        'stock_before', v_prev_stock,
        'stock_after', v_final_stock,
        'count_item_id', v_result->>'count_item_id'
      ));
      v_success_count := v_success_count + 1;
    exception when others then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code', coalesce(v_gtin, regexp_replace(coalesce(v_item->>'code',''),'\D','','g')),
        'quantity', coalesce(v_qty,0),
        'error', sqlerrm
      ));
      v_error_count := v_error_count + 1;
    end;
  end loop;

  perform public.close_inventory_count(v_count_id, p_user_id);

  return jsonb_build_object(
    'inventory_count_id', v_count_id,
    'mode', v_mode,
    'success_count', v_success_count,
    'error_count', v_error_count,
    'successes', v_successes,
    'errors', v_errors
  );
end;
$$;

revoke all on function public.save_fast_inventory_batch_v1(uuid,text,jsonb) from public, anon, authenticated;
grant execute on function public.save_fast_inventory_batch_v1(uuid,text,jsonb) to service_role;
