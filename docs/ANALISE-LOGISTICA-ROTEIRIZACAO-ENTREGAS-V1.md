# Dona Antônia — Análise de Logística, Roteirização e Entregas V1

Data: 08/09/2026

Status: **PLANEJAMENTO APROVADO PARA EVOLUÇÃO FUTURA — NÃO ATIVAR AGORA**.

Fonte principal: pesquisa fornecida pelo proprietário em `Arquitetura de Pedidos, Roteirização e Entregas — Dona Antônia.pdf`.

Esta análise **não autoriza** alterar o canary WhatsApp `live=1%`, ativar Bling, iniciar rastreamento de entregadores, contratar Google Maps Platform ou criar rotas reais neste momento. O objetivo é preservar decisões arquiteturais para a fase logística.

---

# 1. Decisão arquitetural principal

A proposta do relatório é correta e deve ser incorporada ao roadmap, com alguns hardenings.

Princípio oficial:

> **Pedido é a verdade comercial. Entrega é a verdade logística. Rota é o plano. App do entregador é a execução. GPS é a posição real. ETA é a previsão. WhatsApp é a comunicação com o cliente.**

Não criar três sistemas independentes com cadastros duplicados. A operação continuará usando uma única base operacional no Supabase, com módulos e responsabilidades separados.

Arquitetura alvo:

```text
WhatsApp / Flow / Sala
        ↓
      Pedido
        ↓
Separação + conferência
        ↓
      READY
        ↓ evento idempotente
   delivery_job
        ↓
Gerenciador de Entregas
        ↓
Roteirização / publicação
        ↓
Rota + paradas
        ↓
App do Entregador
        ↓
GPS / ETA / ocorrências
        ↓
WhatsApp logístico
        ↓
Entrega concluída
        ↓
Pedido reflete DELIVERED
```

A OpenAI não deve comandar rota, GPS, ETA, cobrança, status ou cálculo logístico.

---

# 2. Pedido e entrega devem ser entidades diferentes

Adotar esta separação.

`orders` representa a venda.

Uma entidade logística futura — nome técnico a decidir, conceitualmente `delivery_jobs` — representa a execução física daquela venda.

Isso permite, sem deformar o pedido original:

- segunda tentativa de entrega;
- reentrega;
- troca;
- mais de uma viagem para o mesmo pedido;
- mudança de entregador;
- reprogramação de rota;
- suspensão temporária;
- ocorrência operacional.

Regra importante:

```text
1 order
→ 1..N execuções logísticas ao longo do ciclo de vida
```

Não duplicar o pedido inteiro dentro da logística. A entrega referencia o pedido e mantém somente snapshots operacionais necessários.

---

# 3. READY será a fronteira entre comercial e logística

Quando a etapa de separação/conferência estiver formalmente homologada, o status equivalente a `READY` deve ser o evento que torna o pedido elegível para logística.

Antes de aceitar `READY`, validar deterministicamente, no mínimo:

- pedido existente e confirmado;
- itens/quantidades conferidos;
- quantidade de volumes;
- endereço operacional completo;
- coordenadas válidas ou estado explícito `geocode_required`;
- referência de entrega quando existente;
- regra de pagamento na entrega;
- valor a receber;
- prioridade;
- janela de entrega, quando houver;
- observações necessárias ao entregador;
- instante `ready_at`.

O evento `ORDER_READY` deve criar a execução logística **idempotentemente**. Reprocessar o mesmo evento não pode criar duas entregas.

---

# 4. Compatibilidade com o projeto atual

O projeto atual já preserva `delivery_address` dentro do próprio pedido confirmado. Isso é a direção correta e deve ser mantida.

Na fase logística, evoluir o snapshot para não depender do cadastro atual do cliente depois que o pedido estiver pronto.

Snapshot logístico recomendado:

```text
order_id
customer_id / nome operacional
telefone necessário para comunicação
endereço textual usado naquela entrega
latitude
longitude
coordinate_source
coordinate_confidence
coordinate_confirmed_at
referência
volumes
valor a receber
forma de recebimento na entrega
prioridade
janela de entrega
observações operacionais
ready_at
```

`coordinate_source` deve distinguir, por exemplo:

- `customer_pin`;
- `geocoded`;
- `admin_confirmed`;
- `driver_corrected`.

Não recalcular silenciosamente coordenadas históricas quando o cliente alterar o cadastro depois.

---

# 5. Coordenadas são dado crítico, não detalhe de endereço

A pesquisa acerta ao priorizar latitude/longitude.

O roteador deve trabalhar com coordenadas e não apenas texto de rua.

Mas adicionar proteção de qualidade:

- coordenada deve ter origem conhecida;
- geocoding de baixa confiança não deve entrar automaticamente em rota real;
- permitir confirmação de pin pelo cliente/Admin quando necessário;
- correção feita pelo entregador deve virar evento auditável, não sobrescrever histórico silenciosamente;
- guardar a coordenada efetivamente utilizada naquela execução logística.

Uma coordenada incorreta pode ser mais prejudicial do que uma rota menos otimizada.

---

# 6. Gerenciador de Entregas deve ser predominantemente determinístico

Responsabilidade futura:

- capturar pedidos `READY`;
- manter fila de entregas aguardando rota;
- conhecer entregadores e veículos disponíveis;
- conhecer capacidade/horário;
- formar rotas;
- publicar rotas;
- controlar paradas;
- receber posição do entregador;
- calcular ETA da próxima parada;
- disparar notificações logísticas;
- tratar ocorrências;
- reotimizar o restante quando permitido;
- gerar métricas.

IA pode interpretar linguagem humana, mas o backend decide efeitos logísticos.

---

# 7. Abstração de provedor de mapas/roteirização

A pesquisa recomenda Google Route Optimization API e Routes API. A escolha é tecnicamente coerente, mas **não acoplar o domínio da Dona Antônia diretamente ao Google**.

Criar futuramente uma camada conceitual:

```text
RoutingProvider
  optimizeRoutes(input)
  computeEta(origin,destination,departureTime)
  geocode(address)
```

Primeiro provider provável: Google Maps Platform.

Benefícios:

- trocar fornecedor no futuro sem reescrever logística;
- testar custo/qualidade;
- usar fallback simples/manual em contingência;
- mockar o provider em testes;
- separar regras de negócio da API externa.

---

# 8. Route Optimization e ETA são problemas diferentes

Adotar a separação proposta na pesquisa.

## Route Optimization

Usar para:

- atribuir entregas a veículos/entregadores;
- ordenar paradas;
- considerar capacidade;
- horários de trabalho;
- janelas de entrega;
- prioridades/restrições;
- custo/tempo da rota;
- reotimização controlada.

## Routes / ETA

Usar para:

- posição atual do entregador → próxima parada;
- estimativa de chegada;
- tráfego quando necessário.

Não chamar o otimizador inteiro toda vez que o GPS mudar.

---

# 9. Roteirização por janelas, não por ansiedade de cada novo pedido

A pesquisa acerta ao separar:

- rotas em formação;
- rotas publicadas;
- rotas ativas.

Novo pedido `READY` no meio de uma rota ativa não deve destruir automaticamente a sequência atual.

Estratégia futura:

```text
READY
→ fila de roteirização
→ rodada/batch de formação
→ rota proposta
→ revisão humana opcional
→ publicação
→ rota ativa
```

Inserção dinâmica em rota ativa só com política específica e benefício real.

---

# 10. Regra de bloqueio da próxima parada — ADOTAR

Esta é uma das melhores ideias da pesquisa.

Depois que o cliente receber “você é a próxima entrega”, aquela parada passa a ter compromisso operacional.

Estados conceituais:

```text
current_stop = locked
next_notified_stop = locked
remaining_stops = reoptimizable
```

Não trocar a próxima pessoa silenciosamente depois de avisá-la.

Exceção somente por motivo operacional real, com:

- override explícito;
- motivo;
- usuário/sistema que alterou;
- timestamp;
- eventual mensagem corretiva ao cliente.

---

# 11. Avisos de entrega devem ser determinísticos e idempotentes

Não usar LLM para mensagens logísticas padronizadas.

Eventos iniciais recomendados:

```text
DELIVERY_SCHEDULED / READY_FOR_ROUTE
NEXT_STOP_ACTIVATED
APPROACHING
DELIVERED
DELIVERY_EXCEPTION
```

Cada parada deve manter recibos próprios, por exemplo:

```text
scheduled_notification_sent_at
next_notification_sent_at
approaching_notification_sent_at
delivered_notification_sent_at
provider_message_id
status
```

Idempotência obrigatória: retry, refresh ou reconexão nunca pode enviar o mesmo aviso várias vezes.

Reaproveitar os princípios já homologados no outbound WhatsApp atual: receipt, estado externo incerto e **sem retry cego**.

---

# 12. “3 minutos” deve ser configuração, não número mágico

A ideia de aviso próximo à chegada é excelente, mas não hardcodar `180 segundos` no domínio.

Criar futuramente uma política, por exemplo:

```text
approaching_eta_threshold_seconds
minimum_gps_freshness_seconds
minimum_eta_confidence
notification_cooldown
```

O piloto pode usar ~3 minutos, mas o Admin deve poder evoluir a regra com métricas.

Não enviar “estamos chegando” se:

- GPS estiver antigo;
- rota/ETA estiver indisponível;
- próxima parada tiver mudado por emergência;
- notificação já tiver sido enviada.

---

# 13. ETA, não distância em linha reta

Adotar integralmente.

O gatilho de aproximação usa duração estimada de rota.

Não usar simplesmente:

```text
distance(driver,destination) < X metros
```

Semáforos, sentido de via, retornos e trânsito tornam distância geográfica insuficiente.

Geofence pode ser auxiliar para sugerir “parece que você chegou”, mas **não deve marcar entrega automaticamente**.

---

# 14. Controle de custo de mapas

O projeto prioriza custo baixo, portanto a logística deve nascer instrumentada.

Não consultar ETA a cada alteração mínima de GPS.

Estratégia inicial:

- calcular ETA apenas da próxima parada;
- recalcular em intervalo adaptativo;
- recalcular por movimento relevante/evento de rota;
- reduzir frequência se ETA estiver distante;
- aumentar moderadamente perto do destino;
- suspender cálculo se GPS estiver stale/offline;
- contabilizar chamadas e custo por rota/entrega.

Métricas futuras:

```text
optimization_calls
routes_eta_calls
geocoding_calls
map_cost_per_route
map_cost_per_delivery
```

---

# 15. Supabase Realtime — direção aprovada

Para Central ↔ App do Entregador, preferir arquitetura orientada a eventos.

Usar futuramente canais privados e autorização por papel/rota.

Exemplos de eventos:

```text
ORDER_READY
DELIVERY_WAITING_ROUTE
ROUTE_PUBLISHED
ROUTE_UPDATED
ROUTE_STARTED
STOP_ACTIVATED
STOP_ARRIVED
STOP_DELIVERED
STOP_FAILED
NEXT_STOP_ACTIVATED
ROUTE_FINISHED
```

Evitar robôs consultando tabelas continuamente.

O banco continua sendo a fonte durável; Realtime é o mecanismo de entrega imediata da mudança para clientes conectados.

---

# 16. App do Entregador deve ser operacional, não um mini-Admin

A pesquisa está correta.

O entregador precisa ver somente o necessário:

- sua rota;
- próxima entrega;
- sequência restante;
- endereço;
- coordenadas;
- referência;
- quantidade de volumes;
- cobrança necessária;
- forma de recebimento na entrega;
- ações de contato permitidas;
- ocorrências estruturadas.

Ações principais:

```text
COMEÇAR ROTA
ABRIR NAVEGAÇÃO
CHEGUEI
ENTREGUEI
NÃO CONSEGUI ENTREGAR
REGISTRAR OCORRÊNCIA
PRÓXIMA
```

Não expor:

- histórico completo do cliente;
- pedidos de outros entregadores;
- relatórios comerciais;
- conversas internas;
- dados administrativos;
- informações não necessárias para entrega.

---

# 17. PWA/offline deve fazer parte da primeira arquitetura

Não tratar offline como melhoria tardia.

O app deve manter localmente, de forma segura, apenas os dados mínimos da rota atual:

- sequência;
- endereços;
- coordenadas;
- referências;
- volumes;
- instruções operacionais necessárias.

Se perder internet:

- navegação básica continua disponível;
- ações ficam em fila local idempotente;
- sincronizam depois;
- conflitos são resolvidos server-side;
- não emitir ETA/notificação automática usando localização antiga.

Ações offline precisam de identificador idempotente próprio.

---

# 18. GPS e privacidade do entregador

Adotar a regra da pesquisa:

```text
rota iniciada → tracking ativo
rota finalizada → tracking encerrado
```

Não rastrear entregador durante todo o dia.

Requisitos futuros:

- interface deixa claro que tracking está ativo;
- coletar somente frequência necessária à operação;
- retenção definida;
- posição recente separada do histórico analítico quando possível;
- acesso do gerente auditado;
- papel `driver` isolado por RLS/auth.

---

# 19. Estrutura lógica aprovada como referência

Entidades conceituais futuras:

```text
orders                 verdade comercial
delivery_jobs          execução logística do pedido
drivers                entregadores
vehicles               veículos/capacidade
delivery_routes        plano publicado/ativo
delivery_stops         sequência de paradas
delivery_events        trilha operacional imutável/append-oriented
driver_locations       posição recente / tracking
delivery_notifications controle idempotente de comunicação
```

Possíveis complementos que considero necessários:

```text
delivery_attempts      tentativas/reentregas, se não forem modeladas em delivery_jobs
delivery_incidents     ocorrências estruturadas
delivery_route_versions histórico de reotimizações/publicações
routing_provider_calls auditoria/custo externo
```

Os nomes técnicos finais podem mudar. A separação de responsabilidades não deve mudar.

---

# 20. Estados devem formar uma máquina explícita

Não usar strings livres alteradas por qualquer tela.

Exemplo conceitual de `delivery_job`:

```text
waiting_route
planned
assigned
out_for_delivery
delivered
failed
suspended
reschedule_required
cancelled
```

Exemplo de rota:

```text
draft
optimized
published
active
completed
cancelled
```

Exemplo de parada:

```text
planned
locked_next
active
arrived
delivered
failed
skipped
rescheduled
```

Transições críticas devem ser RPC/backend-only, idempotentes e auditáveis.

---

# 21. Intervenção humana é permitida, mas sempre auditada

A Central deve poder futuramente:

- trocar entregador;
- mover parada;
- alterar prioridade;
- suspender;
- reprogramar;
- marcar urgência;
- cancelar rota;
- pedir recálculo.

Cada intervenção grava:

```text
actor
before
after
reason
created_at
route_version
```

Se atingir parada já avisada, exigir confirmação de alto atrito e tratar comunicação ao cliente.

---

# 22. OpenAI somente para exceções humanas

Adotar a proposta.

Exemplos:

```text
“vou demorar dez minutos”
“não tem ninguém em casa”
“pode entregar para minha vizinha”
“o endereço está errado”
```

A IA pode produzir saída estruturada:

```json
{
  "intent": "customer_requests_delay",
  "minutes": 10,
  "confidence": 0.94
}
```

Mas **não executa diretamente** a mudança de rota.

Backend decide:

- aceitar espera;
- reprogramar;
- abrir ocorrência;
- pedir confirmação;
- encaminhar humano.

Baixa confiança ou mudança sensível → humano.

---

# 23. Pagamento — adaptar à regra real da Dona Antônia

O relatório usa exemplos de Pix/dinheiro/cartão.

Isso **não altera** a decisão comercial atual:

> pagamento acontece somente na entrega.

As formas aceitas na entrega devem vir de configuração oficial do Admin/backend quando essa fase for implementada.

O app do entregador nunca inventa forma de pagamento e nunca recebe dados de cartão sensíveis.

Registrar apenas informação operacional necessária à cobrança/recebimento.

---

# 24. WhatsApp logístico deve reutilizar a infraestrutura existente

Não criar um segundo sistema de envio.

Quando a logística chegar:

```text
delivery event
→ cria outbound_job especializado
→ mesmo protocolo event-driven/receipt já homologado
→ Make/Meta bridge
→ receipt provider
```

Templates utilitários específicos de entrega devem ser validados na documentação vigente da Meta antes do piloto.

Não assumir eternamente nome/categoria/formato de template citado por um relatório externo.

---

# 25. Central de Logística no Admin

Futura área `LOGÍSTICA` deve ser operacional, não apenas relatório.

Primeira visão:

```text
Aguardando rota
Planejadas
Em rota
Entregues
Problemas
```

Por entregador:

- progresso X/Y;
- próxima parada;
- ETA;
- rota restante;
- previsão de conclusão;
- última localização válida;
- status online/offline/stale.

Mapa em tempo real entra depois que a operação básica estiver comprovada.

---

# 26. Métricas obrigatórias

Desde a primeira versão:

- pedidos READY por período;
- tempo READY → rota publicada;
- tempo READY → saída;
- entregas/rota;
- km estimado vs realizado quando disponível;
- tempo por parada;
- atraso;
- sucesso na primeira tentativa;
- falhas por motivo;
- falhas por endereço;
- cliente ausente;
- custo aproximado por entrega;
- custo de APIs de mapas;
- notificações enviadas/falhas/duplicidades evitadas;
- precisão do ETA;
- intervenções manuais;
- reotimizações;
- entregas por bairro/região;
- produtividade por rota/entregador sem criar incentivo inseguro.

---

# 27. Ajustes importantes em relação ao relatório

A pesquisa é boa, mas estes ajustes passam a fazer parte da decisão oficial:

1. **Não hardcodar Google no domínio:** usar adapter de provider.
2. **Não hardcodar 3 minutos:** threshold configurável e dependente de GPS fresco.
3. **Não confiar cegamente em geocoding:** guardar origem/confiança da coordenada.
4. **Não marcar chegada/entrega só por geofence:** entregador confirma.
5. **Não reotimizar toda a frota a cada GPS/READY:** usar eventos e janelas.
6. **Não mover próxima parada já avisada sem override auditado.**
7. **Não enviar aviso com GPS/ETA stale.**
8. **Não expor Admin/CRM ao entregador.**
9. **Não rastrear fora de rota ativa.**
10. **Não deixar IA alterar rota diretamente.**
11. **Não criar um segundo outbound WhatsApp:** reutilizar o bridge idempotente atual.
12. **Não misturar primeira ativação logística com primeira homologação Bling.**

---

# 28. Sequência recomendada de implementação futura

## L0 — Fundação dormente

- feature flag logística global `off`;
- schemas de drivers/vehicles/delivery jobs/routes/stops/events/notifications;
- máquina de estados;
- RLS/papel driver;
- auditoria;
- testes sintéticos.

Nenhum mapa/WhatsApp real.

## L1 — READY → delivery_job

- snapshot operacional;
- coordenadas/origem/confiança;
- fila `waiting_route`;
- idempotência;
- Central somente leitura.

## L2 — Entregadores e veículos

- disponibilidade;
- capacidade;
- horários;
- associação segura;
- app mobile/PWA autenticado;
- offline básico.

## L3 — Roteirização controlada

- provider adapter;
- Google Route Optimization como primeiro candidato;
- rotas draft;
- ajuste humano;
- publicação;
- versionamento;
- ainda sem clientes reais no piloto inicial.

## L4 — Execução da rota

- Realtime privado;
- start route;
- GPS durante rota;
- open navigation;
- arrived/delivered/failed;
- sync offline;
- next stop automático.

## L5 — Comunicação logística

- templates utilitários homologados;
- next stop;
- ETA approaching;
- delivered;
- receipts/idempotência;
- bloqueio da próxima parada avisada.

## L6 — Exceções conversacionais

- IA interpreta respostas do cliente;
- backend/humano decide efeito;
- sem ação logística direta por LLM.

## L7 — Otimização e inteligência operacional

- reotimização controlada;
- janelas de entrega;
- capacidade avançada;
- mapa Central;
- métricas/custos;
- tentativas/reentregas;
- melhorias de ETA.

---

# 29. Relação com o roadmap atual

Não antecipar logística enquanto estas fases atuais ainda estiverem sendo homologadas:

1. canary WhatsApp real de atendimento;
2. orquestrador/Flow dormente e homologado;
3. primeiro pedido real controlado no Bling;
4. fluxo de separação/conferência consistente;
5. somente então iniciar L0/L1 logístico.

A roteirização deve ser considerada **parte do núcleo da primeira versão logística**, e não uma melhoria distante. Porém a logística não deve ser ligada antes da verdade do pedido/READY estar estável.

---

# 30. Verificações externas realizadas em 08/09/2026

Documentação oficial consultada para validar a direção técnica:

- Google Route Optimization API: modela shipments + vehicles e permite otimização com restrições como horários de trabalho, capacidade e time windows;
- Google Routes API: possui modos de roteamento sensíveis ao tráfego para estimativa de rota/tempo;
- Supabase Realtime: Broadcast é a opção recomendada para escalabilidade/segurança ao propagar mudanças de banco, com canais privados e RLS.

Antes de implementação real, repetir pesquisa de documentação/custos/quotas vigentes, principalmente:

- Google Maps Platform pricing/quotas;
- formato atual do Route Optimization API;
- política de localização/rastreamento;
- WhatsApp Utility templates e regras de janela/conversa;
- requisitos LGPD e retenção de localização.

---

# 31. Resumo executivo

A pesquisa deve ser adotada como direção futura.

Arquitetura oficial para lembrar:

```text
ORDER READY
→ delivery_job idempotente
→ rota em formação
→ otimização
→ publicação
→ app recebe por realtime
→ rota inicia / tracking ativo
→ current + next protegidos
→ cliente NEXT recebe WhatsApp
→ ETA calculado somente para próxima
→ APPROACHING com GPS fresco
→ entregador confirma chegada/entrega
→ evento durável
→ próxima parada automaticamente
→ rota finaliza
→ tracking encerra
```

A inteligência aqui deve vir principalmente de **eventos + regras + geografia**, não de LLM.

A OpenAI entra apenas onde linguagem humana é ambígua e uma intenção precisa ser extraída com segurança.
