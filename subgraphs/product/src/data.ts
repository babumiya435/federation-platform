import { encodeGlobalId } from "@federation-platform/global-id";

export interface ProductRecord {
  /** Global id, also the federation key. */
  id: string;
  localId: string;
  name: string;
  price: number;
  internalCost: number;
}

export const productId = (localId: string) => encodeGlobalId("Product", localId);

const SEED_PRODUCTS: Omit<ProductRecord, "id">[] = [
  { localId: "trail-backpack", name: "Trail Backpack", price: 89.0, internalCost: 41.5 },
  { localId: "insulated-bottle", name: "Insulated Bottle", price: 24.5, internalCost: 9.2 },
  { localId: "camp-stove", name: "Camp Stove", price: 59.99, internalCost: 27.0 },
  { localId: "headlamp", name: "Headlamp", price: 34.0, internalCost: 12.75 },
  { localId: "merino-socks", name: "Merino Socks", price: 18.0, internalCost: 6.1 },
];

/** In-memory store. Persistence is out of scope for this exercise. */
export class ProductStore {
  private readonly products: ProductRecord[] = SEED_PRODUCTS.map((product) => ({
    ...product,
    id: productId(product.localId),
  }));

  all(): ProductRecord[] {
    return this.products;
  }

  find(localId: string): ProductRecord | undefined {
    return this.products.find((product) => product.localId === localId);
  }
}
