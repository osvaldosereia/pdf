// Admin V2 - organização da ficha de produto
// Módulo visual preparado para separar informações sem habilitar gravação.

export const productTabs = [
  {
    id: 'basic',
    label: 'Dados básicos',
    fields: ['nome','descricao','codigo','gtin']
  },
  {
    id: 'commercial',
    label: 'Preço e estoque',
    fields: ['preco','preco_custo','estoque','validade']
  },
  {
    id: 'classification',
    label: 'Classificação',
    fields: ['categoria','subcategoria','subsubcategoria','marca','fornecedor','embalagem','tags']
  },
  {
    id: 'location',
    label: 'Localização',
    fields: ['gondola','prateleira']
  },
  {
    id: 'image',
    label: 'Imagem',
    fields: ['url_imagem']
  },
  {
    id: 'history',
    label: 'Histórico',
    fields: []
  }
];

export function getProductTabs(){
  return productTabs;
}
