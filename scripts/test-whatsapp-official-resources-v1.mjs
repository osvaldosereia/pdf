import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/20260908211000_whatsapp_sales_official_resources_homologation_v1.sql',import.meta.url),'utf8');
for(const needle of [
  'whatsapp_live_canary_percent>1',
  'bling_must_remain_off_during_whatsapp_homologation',
  'whatsapp_sales_images_enabled=true',
  'whatsapp_sales_interactive_enabled=true',
  'use_media_only_when_helpful',
  'interactive_when_reduces_steps',
  'Nunca use carrossel neste MVP'
]) assert.ok(sql.includes(needle),`faltou ${needle}`);
console.log('PASS: imagem/lista/botões são liberados só no canary autorizado e com Bling OFF.');