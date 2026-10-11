import axios from 'axios';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';

import { GOODS_VALUES, HOUSING_TYPES, type Goods, type Offer } from './types/offer.type.js';
import type { City } from './types/city.type.js';
import { OFFERS_TSV_HEADER, offerToTsv } from './tsv-file-reader.js';
import { randomBoolean, randomFloat, randomInteger, randomItem } from './random.js';

const CITIES: City[] = [
  'Paris',
  'Cologne',
  'Brussels',
  'Amsterdam',
  'Hamburg',
  'Dusseldorf',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOfferTemplate(value: unknown): value is Offer {
  if (!isRecord(value) || !isRecord(value.author) || !isRecord(value.location)) {
    return false;
  }

  const author = value.author;
  const location = value.location;

  return typeof value.name === 'string'
    && typeof value.description === 'string'
    && typeof value.publicationDate === 'string'
    && !Number.isNaN(Date.parse(value.publicationDate))
    && CITIES.includes(value.city as City)
    && typeof value.previewImage === 'string'
    && Array.isArray(value.photos)
    && value.photos.length === 6
    && value.photos.every((photo) => typeof photo === 'string')
    && typeof value.isPremium === 'boolean'
    && typeof value.isFavorite === 'boolean'
    && typeof value.rating === 'number'
    && value.rating >= 1
    && value.rating <= 5
    && HOUSING_TYPES.includes(value.housingType as Offer['housingType'])
    && typeof value.bedrooms === 'number'
    && value.bedrooms >= 1
    && value.bedrooms <= 8
    && typeof value.maxAdults === 'number'
    && value.maxAdults >= 1
    && value.maxAdults <= 10
    && typeof value.price === 'number'
    && value.price >= 100
    && value.price <= 100000
    && Array.isArray(value.goods)
    && value.goods.every((good) => GOODS_VALUES.includes(good as Goods))
    && typeof author.name === 'string'
    && typeof author.email === 'string'
    && typeof author.avatarUrl === 'string'
    && (author.type === 'pro' || author.type === 'regular')
    && typeof value.commentsCount === 'number'
    && value.commentsCount >= 0
    && typeof location.latitude === 'number'
    && Number.isFinite(location.latitude)
    && typeof location.longitude === 'number'
    && Number.isFinite(location.longitude);
}

function randomGoods(): Goods[] {
  const selected = new Set<Goods>();
  const count = randomInteger(1, GOODS_VALUES.length);

  while (selected.size < count) {
    selected.add(randomItem(GOODS_VALUES));
  }

  return [...selected];
}

function createRandomOffer(template: Offer): Offer {
  return {
    ...template,
    photos: [...template.photos],
    isPremium: randomBoolean(),
    isFavorite: randomBoolean(),
    rating: randomFloat(1, 5),
    bedrooms: randomInteger(1, 8),
    maxAdults: randomInteger(1, 10),
    price: randomInteger(100, 100000),
    goods: randomGoods(),
    author: { ...template.author },
    commentsCount: randomInteger(0, 100),
    publicationDate: new Date(
      Date.now() - randomInteger(0, 31536000000),
    ).toISOString(),
    location: { ...template.location },
  };
}

async function fetchTemplates(url: string): Promise<Offer[]> {
  let responseData: unknown;

  try {
    const response = await axios.get<unknown>(url, { timeout: 10000 });
    responseData = response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response ? ` (HTTP ${error.response.status})` : '';
      throw new Error(
        `Не удалось получить шаблоны с ${url}${status}: ${error.message}`,
      );
    }

    throw error;
  }

  if (!Array.isArray(responseData) || responseData.length === 0) {
    throw new Error(
      'Ответ сервера должен содержать непустой массив предложений.',
    );
  }

  if (!responseData.every(isOfferTemplate)) {
    throw new Error(
      'Ответ сервера содержит предложение с некорректными данными.',
    );
  }

  return responseData;
}

async function* createTsvRows(
  count: number,
  templates: Offer[],
): AsyncGenerator<string> {
  yield `${OFFERS_TSV_HEADER}\n`;

  for (let index = 0; index < count; index += 1) {
    const template = randomItem(templates);
    yield `${offerToTsv(createRandomOffer(template))}\n`;
  }
}

export async function generateOffersFile(
  countArgument: string,
  filePath: string,
  url: string,
): Promise<number> {
  if (!/^\d+$/.test(countArgument)) {
    throw new Error(
      'Количество предложений должно быть положительным целым числом.',
    );
  }

  const count = Number(countArgument);

  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new Error(
      'Количество предложений должно быть положительным целым числом.',
    );
  }

  const templates = await fetchTemplates(url);

  try {
    await pipeline(
      Readable.from(createTsvRows(count, templates)),
      createWriteStream(resolve(filePath), { encoding: 'utf-8' }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'неизвестная ошибка';
    throw new Error(
      `Не удалось записать TSV-файл ${filePath}: ${message}`,
    );
  }

  return count;
}
