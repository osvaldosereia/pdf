const text = value => String(value ?? '').trim();
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;

export function createOrder(raw = {}, fallbackId = '') {
  const id = text(raw.id || raw.numero_pedido || raw.numero || fallbackId);
  const items = Array.isArray(raw.itens) ? raw.itens : [];

  return Object.freeze({
    id,
    numero: text(raw.numero_pedido || raw.numero || id),
    origem: text(raw.origem || 'site'),
    status: text(raw.status || 'novo'),
    statusSeparacao: text(raw.status_separacao || raw.separacao_status),
    criadoEm: text(raw.criado_em || raw.createdAt),
    atualizadoEm: text(raw.atualizado_em || raw.updatedAt),
    cliente: Object.freeze({
      nome: text(raw.cliente?.nome || raw.nome_cliente),
      telefone: text(raw.cliente?.telefone || raw.telefone),
      cpf: text(raw.cliente?.cpf || raw.cpf),
      email: text(raw.cliente?.email || raw.email)
    }),
    entrega: Object.freeze({
      endereco: text(raw.entrega?.endereco || raw.endereco),
      numero: text(raw.entrega?.numero || raw.numero_endereco),
      complemento: text(raw.entrega?.complemento || raw.complemento),
      bairro: text(raw.entrega?.bairro || raw.bairro),
      cidade: text(raw.entrega?.cidade || raw.cidade),
      agendamento: text(raw.entrega?.agendamento || raw.agendamento)
    }),
    itens: items.map(item => Object.freeze({
      produtoId: text(item.produtoId || item.firebaseKey || item.id),
      codigo: text(item.codigo || item.sku),
      nome: text(item.nome),
      quantidade: number(item.quantidade ?? item.qtd),
      preco: number(item.preco ?? item.price)
    })),
    total: number(raw.total)
  });
}

export function validateOrder(order = {}) {
  const errors = [];
  if (!text(order.id)) errors.push('Pedido sem identificador.');
  if (!text(order.cliente?.nome)) errors.push('Cliente sem nome.');
  if (!text(order.cliente?.telefone)) errors.push('Cliente sem telefone.');
  if (!Array.isArray(order.itens) || order.itens.length === 0) errors.push('Pedido sem itens.');
  return Object.freeze({ valid: errors.length === 0, errors });
}
