import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

/**
 * Ajusta somente arquivos locais já gerados.
 * Não acessa nem grava no Firebase.
 */

const OUTPUT_DIR = path.resolve(
  process.cwd(),
  process.env.OUTPUT_DIR || 'site-do-zero/generated'
);
const PUBLIC_BASE_URL = String(
  process.env.PUBLIC_BASE_URL || 'https://donaantonia.com.br'
).replace(/\/$/, '');

async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesRecursively(location));
    else files.push(location);
  }
  return files;
}

function safeReturnPolicy() {
  return {
    '@type': 'MerchantReturnPolicy',
    applicableCountry: 'BR',
    returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow',
    merchantReturnDays: 7,
    merchantReturnLink: `${PUBLIC_BASE_URL}/politica-de-troca.html`
  };
}

function adjustSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;

  if (Array.isArray(schema)) return schema.map(adjustSchema);

  for (const [key, value] of Object.entries(schema)) {
    schema[key] = adjustSchema(value);
  }

  const type = Array.isArray(schema['@type']) ? schema['@type'] : [schema['@type']];
  if (type.includes('Offer')) {
    delete schema.shippingDetails;
    schema.hasMerchantReturnPolicy = safeReturnPolicy();
  }

  return schema;
}

async function adjustHtml(file) {
  const source = await readFile(file, 'utf8');
  const adjusted = source.replace(
    /<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi,
    (whole, jsonText) => {
      try {
        const schema = JSON.parse(jsonText);
        return `<script type="application/ld+json">${JSON.stringify(adjustSchema(schema))}</script>`;
      } catch {
        return whole;
      }
    }
  );

  await writeFile(file, adjusted, 'utf8');
}

async function adjustSitemap() {
  const file = path.join(OUTPUT_DIR, 'sitemap.xml');
  let sitemap = await readFile(file, 'utf8');
  const faqUrl = `${PUBLIC_BASE_URL}/perguntas-frequentes.html`;

  if (!sitemap.includes(faqUrl)) {
    const today = new Date().toISOString().slice(0, 10);
    const entry = `  <url><loc>${faqUrl}</loc><lastmod>${today}</lastmod></url>\n`;
    sitemap = sitemap.replace('</urlset>', `${entry}</urlset>`);
  }

  if (/\/(?:kits|produto|produtos)\//i.test(sitemap)) {
    throw new Error('Sitemap contém rota de kit ou produto avulso.');
  }

  await writeFile(file, sitemap, 'utf8');
}

const basketDirectory = path.join(OUTPUT_DIR, 'cestas');
const htmlFiles = (await filesRecursively(basketDirectory)).filter(file => file.endsWith('.html'));

for (const file of htmlFiles) {
  await adjustHtml(file);
}
await adjustSitemap();

console.log(`Páginas ajustadas: ${htmlFiles.length}`);
console.log('Prazos de entrega não garantidos foram removidos dos dados estruturados.');
console.log('Política de devolução aponta para a página oficial, sem inventar método ou custo.');
console.log('FAQ adicionada ao sitemap.');
