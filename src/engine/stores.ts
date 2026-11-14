import { ProductGroupConfig, StoreConfig, StoreId } from '../types/domain';

export const STORES: StoreConfig[] = [
  {
    id: 'union_square',
    name: 'Union Square',
    baseDailySales: 9000,
    isEstablished: true,
    openedDate: '2021-03-15',
    hasOpeningRamp: false,
  },
  {
    id: 'palo_alto',
    name: 'Palo Alto',
    baseDailySales: 6500,
    isEstablished: true,
    openedDate: '2021-09-10',
    hasOpeningRamp: false,
  },
  {
    id: 'santana_row',
    name: 'Santana Row',
    baseDailySales: 5500,
    isEstablished: true,
    openedDate: '2022-04-01',
    hasOpeningRamp: false,
  },
  {
    id: 'walnut_creek',
    name: 'Walnut Creek',
    baseDailySales: 5000,
    isEstablished: true,
    openedDate: '2022-10-12',
    hasOpeningRamp: false,
  },
  {
    id: 'pasadena',
    name: 'Pasadena',
    baseDailySales: 4500,
    isEstablished: true,
    openedDate: '2023-02-20',
    hasOpeningRamp: false,
  },
  {
    id: 'sacramento',
    name: 'Sacramento',
    baseDailySales: 4000,
    isEstablished: true,
    openedDate: '2023-07-08',
    hasOpeningRamp: false,
  },
  {
    id: 'santa_barbara',
    name: 'Santa Barbara',
    baseDailySales: 3500,
    isEstablished: true,
    openedDate: '2024-01-18',
    hasOpeningRamp: false,
  },
  {
    id: 'rockridge',
    name: 'Rockridge',
    baseDailySales: 3000,
    isEstablished: true,
    openedDate: '2024-06-05',
    hasOpeningRamp: false,
  },
  {
    id: 'burlingame',
    name: 'Burlingame',
    baseDailySales: 4500,
    isEstablished: false,
    openedDate: '2026-06-01',
    hasOpeningRamp: true,
  },
  {
    id: 'napa',
    name: 'Napa',
    baseDailySales: 4000,
    isEstablished: false,
    openedDate: '2026-08-22',
    hasOpeningRamp: true,
  },
];

export const STORE_MAP: Record<StoreId, StoreConfig> = STORES.reduce(
  (acc, store) => {
    acc[store.id] = store;
    return acc;
  },
  {} as Record<StoreId, StoreConfig>,
);

export const ESTABLISHED_STORES = STORES.filter((s) => s.isEstablished);
export const NEW_STORES = STORES.filter((s) => !s.isEstablished);

export const PRODUCT_GROUPS: ProductGroupConfig[] = [
  {
    id: 'best_sellers',
    name: 'Best-sellers',
    share: 0.35,
    avgPrice: 120,
    stockLimited: true,
  },
  {
    id: 'knitwear',
    name: 'Knitwear',
    share: 0.15,
    avgPrice: 90,
    stockLimited: true,
  },
  {
    id: 'everything_else',
    name: 'Everything else',
    share: 0.50,
    avgPrice: null,
    stockLimited: false,
  },
];
